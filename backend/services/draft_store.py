"""Versioned JSON workspaces with content-addressed resource copies."""
import datetime
import hashlib
import json
import os
import re
import time
import uuid
from pathlib import Path
from backend.services.atomic_files import atomic_json, workspace_lock
from backend.services.file_settings import get_file_settings
from backend.services.draft_resources import capture_resources, verify_resources

_reservations: dict[str, tuple[str, str, float]] = {}
JOURNAL_FORMAT = "drop-journal-v1"


def reserve_snapshot(workspace_id: str, snapshot_id: str) -> str:
    read_snapshot(workspace_id, snapshot_id)
    token = uuid.uuid4().hex
    _reservations[token] = (workspace_id, snapshot_id, time.monotonic() + 120)
    return token


def release_snapshot(token: str) -> None:
    reserved = _reservations.pop(token, None)
    if reserved:
        _prune(reserved[0], get_file_settings()["retention_count"])


def acknowledge_revision(saved: dict, revision: int) -> None:
    saved["database_revision"] = revision
    atomic_json(board_folder(saved["workspace_id"]) / "snapshots" / f"{saved['snapshot_id']}.json", saved)


def board_folder(workspace_id: str) -> Path:
    if not re.fullmatch(r"[0-9a-f]{32}", workspace_id):
        raise ValueError("画板标识无效")
    return Path(get_file_settings()["temp_dir"]) / workspace_id


def journal_path(workspace_id: str) -> Path:
    return board_folder(workspace_id) / "journal.jsonl"


def _state_copy(state: dict) -> dict:
    """Keep recovery state limited to the persisted workspace fields."""
    return {
        "cards": list(state.get("cards", [])),
        "groups": list(state.get("groups", [])),
        "viewport": state.get("viewport"),
        "pins": list(state.get("pins", [])),
    }


def _objects_by_id(values: list) -> dict[str, dict]:
    return {item["id"]: item for item in values if isinstance(item, dict) and isinstance(item.get("id"), str)}


def _object_delta(previous: list, current: list) -> dict:
    before, after = _objects_by_id(previous), _objects_by_id(current)
    return {
        "upsert": [item for item_id, item in after.items() if before.get(item_id) != item],
        "delete": sorted(set(before) - set(after)),
    }


def _apply_object_delta(previous: list, delta: dict) -> list:
    values = _objects_by_id(previous)
    for item_id in delta.get("delete", []):
        values.pop(item_id, None)
    for item in delta.get("upsert", []):
        if isinstance(item, dict) and isinstance(item.get("id"), str):
            values[item["id"]] = item
    # Stable ordering preserves the user-visible stacking order carried by state.
    return list(values.values())


def _read_journal(workspace_id: str) -> list[dict]:
    path = journal_path(workspace_id)
    if not path.is_file():
        return []
    records: list[dict] = []
    # A crash may leave only the tail record incomplete. Earlier records remain valid.
    with path.open("rb") as stream:
        for raw in stream:
            try:
                record = json.loads(raw.decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError):
                break
            if record.get("format") != JOURNAL_FORMAT or record.get("workspace_id") != workspace_id:
                raise ValueError("暂存日志格式或画板身份无效")
            records.append(record)
    return records


def replay_journal(workspace_id: str, snapshot: dict | None = None, verify=True) -> dict | None:
    """Return the latest checkpoint with complete journal entries replayed."""
    snapshot = latest_snapshot(workspace_id, verify=verify) if snapshot is None else snapshot
    records = _read_journal(workspace_id)
    if snapshot is None and not records:
        return None
    state = _state_copy(snapshot["state"] if snapshot else {})
    resources = dict(snapshot.get("resources", {}) if snapshot else {})
    previous_revision = snapshot.get("client_revision", 0) if snapshot else 0
    database_revision = snapshot.get("database_revision", 0) if snapshot else 0
    source_path = snapshot.get("source_path") if snapshot else None
    for record in records:
        revision = record.get("client_revision")
        if not isinstance(revision, int) or revision <= previous_revision:
            raise ValueError("暂存日志修订号无效")
        state["cards"] = _apply_object_delta(state["cards"], record.get("cards", {}))
        state["groups"] = _apply_object_delta(state["groups"], record.get("groups", {}))
        if "viewport" in record:
            state["viewport"] = record["viewport"]
        if "pins" in record:
            state["pins"] = record["pins"]
        resources.update(record.get("resources", {}))
        previous_revision = revision
        database_revision = record.get("database_revision", database_revision)
        source_path = record.get("source_path", source_path)
    if resources and verify:
        verify_resources(resources, board_folder(workspace_id))
    return {
        "format": "drop-draft-replayed-v1", "workspace_id": workspace_id,
        "snapshot_id": snapshot.get("snapshot_id") if snapshot else None,
        "source_path": source_path, "database_revision": database_revision,
        "client_revision": previous_revision, "state": state, "resources": resources,
    }


def append_journal(info: dict, state: dict, database_revision: int, client_revision: int) -> dict:
    """Append a fsynced object-level recovery record without replacing a checkpoint."""
    with workspace_lock:
        workspace_id = info["workspace_id"]
        # Journal appends are on the hot path for new-board/open transitions.
        # The previous snapshot was already validated when it was published;
        # full resource verification remains on checkpoint/recovery reads.
        previous = replay_journal(workspace_id, verify=False)
        previous_state = previous["state"] if previous else _state_copy({})
        previous_revision = previous.get("client_revision", 0) if previous else 0
        if client_revision <= previous_revision:
            return {"appended": False, "client_revision": previous_revision}
        directory = board_folder(workspace_id)
        protected, resources = capture_resources(_state_copy(state), directory,
                                                  previous.get("resources", {}) if previous else None)
        cards = _object_delta(previous_state["cards"], protected["cards"])
        groups = _object_delta(previous_state["groups"], protected["groups"])
        record = {
            "format": JOURNAL_FORMAT, "workspace_id": workspace_id,
            "client_revision": client_revision, "database_revision": database_revision,
            "source_path": info.get("source_path"), "saved_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "cards": cards, "groups": groups, "resources": resources,
        }
        if previous_state.get("viewport") != protected.get("viewport"):
            record["viewport"] = protected.get("viewport")
        if previous_state.get("pins") != protected.get("pins"):
            record["pins"] = protected.get("pins")
        changed = cards["upsert"] or cards["delete"] or groups["upsert"] or groups["delete"] or "viewport" in record or "pins" in record
        if not changed:
            return {"appended": False, "client_revision": client_revision}
        path = journal_path(workspace_id)
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("ab") as stream:
            stream.write(json.dumps(record, ensure_ascii=False, separators=(",", ":")).encode("utf-8") + b"\n")
            stream.flush()
            os.fsync(stream.fileno())
        return {"appended": True, "client_revision": client_revision}


def clear_journal(workspace_id: str) -> None:
    """Discard journal records only after a complete checkpoint is published."""
    journal_path(workspace_id).unlink(missing_ok=True)


def read_snapshot(workspace_id: str, snapshot_id: str, verify=True) -> dict:
    if not re.fullmatch(r"[0-9]{16,24}-[0-9a-f]{12}", snapshot_id):
        raise ValueError("恢复版本标识无效")
    directory = board_folder(workspace_id)
    data = json.loads((directory / "snapshots" / f"{snapshot_id}.json").read_text(encoding="utf-8"))
    if data.get("format") != "drop-draft-v1" or data.get("workspace_id") != workspace_id:
        raise ValueError("恢复记录格式或画板身份无效")
    state = data.get("state", {})
    if not all(isinstance(state.get(key), list) for key in ("cards", "groups", "pins")):
        raise ValueError("恢复记录缺少完整工作区")
    if verify:
        verify_resources(data.get("resources", {}), directory)
    return data


def snapshot_files(workspace_id: str) -> list[Path]:
    return sorted((board_folder(workspace_id) / "snapshots").glob("*.json"), reverse=True)


def latest_snapshot(workspace_id: str, verify=True) -> dict | None:
    for path in snapshot_files(workspace_id):
        try:
            return read_snapshot(workspace_id, path.stem, verify=verify)
        except (OSError, ValueError, KeyError, TypeError):
            continue
    return None


def write_snapshot(info: dict, state: dict, database_revision: int, client_revision: int) -> dict:
    with workspace_lock:
        directory = board_folder(info["workspace_id"])
        fingerprint = hashlib.sha256(json.dumps(state, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
        previous = latest_snapshot(info["workspace_id"])
        if previous and previous.get("fingerprint") == fingerprint and previous.get("source_path") == info.get("source_path"):
            previous.update(database_revision=database_revision, client_revision=client_revision)
            atomic_json(directory / "snapshots" / f"{previous['snapshot_id']}.json", previous)
            return previous
        protected, resources = capture_resources(state, directory)
        snapshot_id = f"{time.time_ns()}-{uuid.uuid4().hex[:12]}"
        data = {"format": "drop-draft-v1", "workspace_id": info["workspace_id"], "snapshot_id": snapshot_id,
                "source_path": info.get("source_path"), "saved_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                "database_revision": database_revision, "client_revision": client_revision,
                "fingerprint": fingerprint, "state": protected, "resources": resources}
        atomic_json(directory / "snapshots" / f"{snapshot_id}.json", data)
        _prune(info["workspace_id"], get_file_settings()["retention_count"])
        return data


def _prune(workspace_id: str, count: int) -> None:
    files = snapshot_files(workspace_id)
    retained = []
    corrupt = False
    protected = {snapshot for board, snapshot, expiry in _reservations.values()
                 if board == workspace_id and expiry > time.monotonic()}
    for path in files:
        try:
            data = read_snapshot(workspace_id, path.stem)
        except (OSError, ValueError, TypeError):
            corrupt = True
            continue
        if len(retained) < count or path.stem in protected:
            retained.append(data)
        else:
            path.unlink(missing_ok=True)
    if corrupt:
        return  # Do not discard resources that a damaged manifest may reference.
    referenced = {digest for data in retained for digest in data["resources"].values()}
    for blob in (board_folder(workspace_id) / "resources").glob("*"):
        if blob.is_file() and blob.name not in referenced:
            blob.unlink(missing_ok=True)


def recovery_records() -> list[dict]:
    from backend.services.recovery_inspection import scan_directory
    root = Path(get_file_settings()["temp_dir"])
    return sorted(scan_directory(root), key=lambda record: record["snapshot_id"], reverse=True)
