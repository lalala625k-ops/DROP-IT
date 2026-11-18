"""Persistent, self-contained recovery jobs shared by independent backends."""
import copy
import hashlib
import json
import re
import uuid
from pathlib import Path
from backend.services.atomic_files import atomic_bytes, atomic_json, workspace_lock
from backend.services import data_paths
from backend.services.draft_resources import resource_target, restore_resources, TEXT_METADATA
from backend.services.draft_store import write_snapshot
from backend.services.recovery_inspection import read_external, resource_directory, resource_issues, source_path, validate_snapshot
from backend.services.storage import force_replace_all, load_data_from_disk
from backend.services.workspace_session import session_info, set_session
from backend.services.scoped_media import scope_media


def task_folder(task_id: str) -> Path:
    if not re.fullmatch(r"[0-9a-f]{32}", task_id):
        raise ValueError("恢复任务标识无效")
    return data_paths.CONFIG_DIR / "recovery-jobs" / task_id


def prepare_recovery(record_id: str, override: str | None, allow_missing: bool) -> dict:
    with workspace_lock:
        data = read_external(source_path(record_id))
        interrupted = data.get('interrupted_run_id')
        if not isinstance(interrupted, str) or not re.fullmatch(r'[0-9a-f]{32}', interrupted) or source_path(record_id) != (
                data_paths.CONFIG_DIR / 'startup-recovery' / interrupted / 'snapshot.json').resolve():
            interrupted = None
        issues, valid = resource_issues(data, resource_directory(source_path(record_id), override))
        if issues and not allow_missing:
            raise ValueError("存在缺失或损坏的图片，请先检查并确认部分恢复")
        state = copy.deepcopy(data["state"])
        invalid = {issue["url"]: issue for issue in issues}
        for card in state["cards"]:
            for field, detail in list((card.get("recoveryMedia") or {}).items()):
                if field not in ("image", "thumbnail", "favicon") or card.get(field) or not isinstance(detail, dict):
                    continue
                url = f"/api/{detail.get('category', 'assets')}/{detail.get('name')}"
                if url in valid:
                    card[field] = url
                    del card["recoveryMedia"][field]
            for field in ("image", "thumbnail", "favicon"):
                url = card.get(field)
                if isinstance(url, str) and url in invalid:
                    # Diagnostics are not live media URLs, so future autosave
                    # and .drop writers never try to read the missing resource.
                    card["recoveryMedia"] = card.get("recoveryMedia") or {}
                    card["recoveryMedia"][field] = {
                        "name": resource_target(url).name, "digest": invalid[url]["digest"],
                        "category": resource_target(url).parent.name,
                        "reason": invalid[url]["reason"]}
            if (card.get("recoveryMedia") or {}).get("image"):
                card["sizeLocked"] = True
        def remove_missing(value):
            if isinstance(value, dict):
                return {key: child if key in TEXT_METADATA else remove_missing(child) for key, child in value.items()}
            if isinstance(value, list):
                return [remove_missing(child) for child in value]
            return "" if isinstance(value, str) and value in invalid else value
        state = remove_missing(state)
        task_id = uuid.uuid4().hex
        folder = task_folder(task_id)
        # Publish the manifest last. A copy failure never exposes a usable job.
        for url, blob in valid.items():
            contents = blob.read_bytes()
            digest = data["resources"][url]
            if hashlib.sha256(contents).hexdigest() != digest:
                raise ValueError("恢复图片校验失败")
            atomic_bytes(folder / "resources" / digest, contents)
        job = {"format": "drop-recovery-job-v1", "task_id": task_id, "workspace_id": uuid.uuid4().hex,
               "state": state, "resources": {url: data["resources"][url] for url in valid},
               "origin": {"workspace_id": data["workspace_id"], "source_path": data.get("source_path"),
                          "interrupted_run_id": interrupted,
                          "saved_at": data.get("saved_at"), "snapshot_id": data.get("snapshot_id")},
               "issues": issues}
        atomic_json(folder / "job.json", job)
        return {"task_id": task_id}


def apply_recovery(task_id: str) -> dict:
    with workspace_lock:
        info = session_info()
        current = load_data_from_disk()
        if info.get("recovery_task_id") == task_id and info.get("recovery_complete"):
            return {**current, **info, "success": True}
        job = json.loads((task_folder(task_id) / "job.json").read_text(encoding="utf-8"))
        if job.get("format") != "drop-recovery-job-v1" or job.get("task_id") != task_id:
            raise ValueError("恢复任务损坏")
        validate_snapshot({**job, "format": "drop-draft-v1"})
        if info.get("recovery_task_id") != task_id and (current["cards"] or current["groups"] or current.get("pins") or info.get("source_path")):
            raise ValueError("请在空白的新画板中恢复")
        # Mark pending before writing the database: an interrupted operation
        # can retry in this board, without overwriting a different board.
        recovered = {"workspace_id": info["workspace_id"] if info.get("recovery_task_id") == task_id else uuid.uuid4().hex,
                     "source_path": None, "initialized": True,
                     "recovery_task_id": task_id, "recovery_complete": False, "recovery_origin": job["origin"]}
        restore_resources(job["resources"], task_folder(task_id))
        state = scope_media(job["state"])
        set_session(recovered)
        revision = force_replace_all(state)
        write_snapshot(recovered, state, revision, 0)
        # Per-board session controls saving. Do not change shared last-open or
        # file-path preferences belonging to the caller's still-open board.
        recovered["recovery_complete"] = True
        set_session(recovered)
        interrupted = job.get('origin', {}).get('interrupted_run_id')
        if interrupted:
            from backend.services.startup_sessions import finish_run
            finish_run(interrupted)
        return {"success": True, **state, **recovered, "revision": revision}
