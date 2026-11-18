"""Read-only inspection of current and externally selected draft manifests."""
import hashlib
import json
import math
import os
import re
import datetime
from pathlib import Path
from backend.services.draft_resources import resource_target, TEXT_METADATA

_sources: dict[str, Path] = {}


def register_source(path: Path) -> str:
    path = path.resolve()
    key = hashlib.sha256(str(path).encode()).hexdigest()
    _sources[key] = path
    return key


def source_path(record_id: str) -> Path:
    if record_id not in _sources:
        raise ValueError("恢复记录已失效，请重新选择")
    return _sources[record_id]


def validate_snapshot(data: dict) -> None:
    if not isinstance(data, dict) or data.get("format") != "drop-draft-v1":
        raise ValueError("不是有效的暂存文件")
    if not re.fullmatch(r"[0-9a-f]{32}", str(data.get("workspace_id", ""))):
        raise ValueError("画板标识无效")
    if any(data.get(key) is not None and not isinstance(data[key], str) for key in ("source_path", "saved_at", "snapshot_id")):
        raise ValueError("暂存记录信息无效")
    state = data.get("state")
    if not isinstance(state, dict):
        raise ValueError("恢复记录缺少完整工作区")
    for key in ("cards", "groups", "pins"):
        objects = state.get(key)
        if not isinstance(objects, list):
            raise ValueError("恢复记录缺少完整工作区")
        identities = set()
        for item in objects:
            if not isinstance(item, dict) or not isinstance(item.get("id"), str) or not item["id"] or item["id"] in identities:
                raise ValueError("暂存对象标识无效或重复")
            identities.add(item["id"])
            for field in ("content", "title", "sourceTitleUrl", "headerTitle", "url", "image", "thumbnail", "description", "author", "favicon", "groupId", "bundleId"):
                if item.get(field) is not None and not isinstance(item[field], str):
                    raise ValueError("暂存记录信息无效")
            for field in ("tags", "parentIds"):
                if item.get(field) is not None and (not isinstance(item[field], list) or any(not isinstance(value, str) for value in item[field])):
                    raise ValueError("暂存记录信息无效")
            if key == "groups" and item.get("kind") not in (None, "parent", "bundle"):
                raise ValueError("暂存对象类型无效")
            if any(not isinstance(item.get(field), (int, float)) or isinstance(item[field], bool) for field in ("x", "y")):
                raise ValueError("暂存对象坐标或尺寸无效")
            if key == "cards" and item.get("type") not in ("text", "image", "web", "file"):
                raise ValueError("暂存对象类型无效")
            if key == "cards" and item.get("recoveryMedia") is not None and not isinstance(item["recoveryMedia"], dict):
                raise ValueError("暂存记录信息无效")
            for field in ("x", "y", "width", "height", "zoom", "zIndex", "contentScale"):
                if item.get(field) is not None and (not isinstance(item[field], (int, float)) or isinstance(item[field], bool) or not math.isfinite(item[field])):
                    raise ValueError("暂存对象坐标或尺寸无效")
            if key == "cards" and any(not isinstance(item.get(field), (int, float)) or item[field] <= 0 for field in ("width", "height")):
                raise ValueError("暂存对象坐标或尺寸无效")
            if key == "pins" and (not isinstance(item.get("index"), int) or isinstance(item["index"], bool) or not 1 <= item["index"] <= 8):
                raise ValueError("暂存图钉编号无效")
    viewport = state.get("viewport")
    if viewport is not None and (not isinstance(viewport, dict) or any(
        not isinstance(viewport.get(key), (int, float)) or isinstance(viewport[key], bool) or not math.isfinite(viewport[key])
        for key in ("x", "y", "zoom")) or viewport["zoom"] <= 0):
        raise ValueError("暂存视口无效")
    resources = data.get("resources")
    if not isinstance(resources, dict) or any(
        not isinstance(url, str) or resource_target(url) is None or not isinstance(digest, str)
        or not re.fullmatch(r"[0-9a-f]{64}", digest) for url, digest in resources.items()):
        raise ValueError("恢复记录的图片索引无效")


def read_external(path: Path) -> dict:
    if path.name.endswith(".local.json"):
        raise ValueError("不是有效的暂存文件")
    data = json.loads(path.read_text(encoding="utf-8-sig"))
    validate_snapshot(data)
    return data


def resource_directory(path: Path, override: str | None = None) -> Path:
    if override:
        folder = Path(override).expanduser().resolve()
        return folder / "resources" if (folder / "resources").is_dir() else folder
    return (path.parent.parent if path.parent.name == "snapshots" else path.parent) / "resources"


def resource_issues(data: dict, folder: Path) -> tuple[list[dict], dict[str, Path]]:
    issues, valid = [], {}
    references = dict(data["resources"])
    diagnosed = {}
    for card in data["state"]["cards"]:
        for field, detail in (card.get("recoveryMedia") or {}).items():
            if field not in ("image", "thumbnail", "favicon") or card.get(field) or not isinstance(detail, dict):
                continue
            category = detail.get("category", "assets")
            name, digest = detail.get("name"), detail.get("digest")
            if not isinstance(name, str) or not name:
                raise ValueError("暂存记录信息无效")
            url = f"/api/{category}/{name}"
            if category not in ("assets", "screenshots") or resource_target(url) is None:
                raise ValueError("暂存记录信息无效")
            if digest is not None and (not isinstance(digest, str) or not re.fullmatch(r"[0-9a-f]{64}", digest)):
                raise ValueError("恢复记录的图片索引无效")
            references.setdefault(url, digest)
            diagnosed[(card["id"], field)] = url
    def visit(value):
        if isinstance(value, dict):
            for key, child in value.items():
                if key not in TEXT_METADATA:
                    visit(child)
        elif isinstance(value, list):
            for child in value:
                visit(child)
        elif isinstance(value, str) and resource_target(value) is not None:
            references.setdefault(value, None)
    visit(data["state"])
    for url, digest in references.items():
        if digest is None:
            blob, reason = None, "图片资源未包含在暂存索引中"
        else:
            blob, reason = folder / digest, None
        if blob is not None:
            try:
                with blob.open("rb") as stream:
                    if hashlib.file_digest(stream, "sha256").hexdigest() != digest:
                        reason = "恢复图片校验失败"
            except OSError:
                reason = "图片资源缺失或无法读取"
        if reason:
            affected = [{"id": card["id"], "title": card.get("title") or card.get("headerTitle") or card["id"]}
                        for card in data["state"]["cards"] if url in (card.get("image"), card.get("thumbnail"), card.get("favicon"))
                        or any(diagnosed.get((card["id"], field)) == url for field in ("image", "thumbnail", "favicon"))]
            issues.append({"url": url, "digest": digest, "reason": reason, "objects": affected})
        else:
            valid[url] = blob
            data["resources"][url] = digest
    return issues, valid


def inspect_source(path: Path, override: str | None = None, verify=True) -> dict:
    try:
        file_time = datetime.datetime.fromtimestamp(path.stat().st_mtime, datetime.timezone.utc).isoformat()
    except OSError:
        file_time = None
    record = {"record_id": register_source(path), "workspace_id": path.parent.parent.name,
              "snapshot_id": path.stem, "name": path.name, "source_path": None,
              "draft_path": str(path.resolve()), "saved_at": file_time, "status": "unrecoverable",
              "card_count": 0, "group_count": 0, "origin_count": 0, "pin_count": 0, "issues": []}
    try:
        data = read_external(path)
        state, source = data["state"], data.get("source_path")
        record.update(workspace_id=data["workspace_id"], saved_at=data.get("saved_at") or file_time, source_path=source,
                      name=Path(source).name if isinstance(source, str) and source else f"未命名画板 {data['workspace_id'][:6]}",
                      card_count=len(state["cards"]), pin_count=len(state["pins"]),
                      group_count=sum(group.get("kind") == "bundle" for group in state["groups"]),
                      origin_count=sum(group.get("kind") != "bundle" for group in state["groups"]))
        record["resource_dir"] = str(resource_directory(path, override))
        record["issues"] = resource_issues(data, resource_directory(path, override))[0] if verify else []
        record["status"] = "partial" if record["issues"] else "complete" if verify else "unchecked"
    except (OSError, ValueError, KeyError, TypeError) as error:
        record["reason"] = str(error) if not isinstance(error, (OSError, json.JSONDecodeError)) else "暂存文件损坏或无法读取"
    return record


def scan_directory(root: Path) -> list[dict]:
    paths = _snapshot_paths(root)
    return [inspect_source(path, verify=False) for path in sorted(paths, reverse=True) if not path.name.endswith(".local.json")]


def _snapshot_paths(root: Path):
    if root.name == "snapshots":
        return root.glob("*.json")
    if (root / "snapshots").is_dir():
        return (root / "snapshots").glob("*.json")
    return root.glob("*/snapshots/*.json")


def matching_sources(root: Path, source: Path) -> list[dict]:
    """Read only snapshot headers while checking a selected .drop source.

    Opening a normal file should not validate every historical snapshot in the
    temporary directory. The full validator still runs for matching records;
    this pass only parses the small JSON header needed to identify them.
    """
    source_key = os.path.normcase(os.path.abspath(source))
    records = []
    for path in _snapshot_paths(root):
        if path.name.endswith(".local.json"):
            continue
        try:
            value = json.loads(path.read_text(encoding="utf-8"))
            candidate = value.get("source_path")
            if not isinstance(candidate, str) or os.path.normcase(os.path.abspath(candidate)) != source_key:
                continue
            records.append({"workspace_id": value.get("workspace_id"),
                            "source_path": candidate,
                            "saved_at": value.get("saved_at"),
                            "draft_path": str(path)})
        except (OSError, ValueError, TypeError):
            continue
    return records
