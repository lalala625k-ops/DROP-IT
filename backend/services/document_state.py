"""Formal document baselines and external-file conflict checks."""
import hashlib
import json
from pathlib import Path


def file_stamp(path: Path) -> dict | None:
    try:
        before = path.stat()
        with path.open("rb") as stream:
            digest = hashlib.file_digest(stream, "sha256").hexdigest()
        after = path.stat()
    except FileNotFoundError:
        return None
    if (before.st_mtime_ns, before.st_size) != (after.st_mtime_ns, after.st_size):
        raise OSError("文件正在被其他程序修改，请稍后重试")
    return {"mtime_ns": str(after.st_mtime_ns), "size": after.st_size, "sha256": digest}


def persisted_state(state: dict) -> dict:
    # Round-trip removes references to mutable request objects.
    return json.loads(json.dumps({key: state.get(key, [] if key != "viewport" else None)
                                  for key in ("cards", "groups", "viewport", "pins")}))


def saved_document(info: dict, path: Path, state: dict) -> dict:
    return {**info, "source_path": str(path.resolve()), "initialized": True,
            "document_stamp": file_stamp(path), "document_saved_state": persisted_state(state)}


def document_status(info: dict, include_state=False) -> dict:
    source = info.get("source_path")
    current = file_stamp(Path(source)) if source else None
    result = {"workspace_id": info["workspace_id"], "source_path": source,
              "external_changed": bool(source and info.get("document_stamp") != current),
              "missing": bool(source and current is None), "stamp": current}
    if include_state:
        result["saved_state"] = info.get("document_saved_state")
    return result
