"""Native selection, read-only inspection and safe recovery into a new board."""
from pathlib import Path
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from backend.services.atomic_files import workspace_lock
from backend.services.file_settings import get_file_settings
from backend.services.folder_dialog import choose_folder
from backend.services.drop_file_dialog import choose_existing_drop_file
from backend.services.recovery_inspection import inspect_source, scan_directory, source_path
from backend.services.recovery_tasks import prepare_recovery, apply_recovery
from backend.services.workspace_session import workspace_scope

router = APIRouter(prefix="/api/workspace/recovery", tags=["recovery"], dependencies=[Depends(workspace_scope)])


class Selection(BaseModel):
    kind: Literal["file", "folder", "resources"]


class Inspection(BaseModel):
    record_id: str
    resource_dir: str | None = None


class Preparation(Inspection):
    allow_missing: bool = False


class Application(BaseModel):
    task_id: str


@router.post("/select")
def select_recovery(payload: Selection):
    try:
        initial = Path(get_file_settings()["temp_dir"])
        if payload.kind == "file":
            selected = choose_existing_drop_file(initial / "", extension="json", title="选择暂存文件")
        else:
            selected = choose_folder(initial)
        if selected is None:
            return {"cancelled": True}
        if payload.kind == "resources":
            return {"path": str(selected)}
        with workspace_lock:
            return {"records": [inspect_source(Path(selected), verify=False)] if payload.kind == "file" else scan_directory(Path(selected))}
    except (OSError, ValueError, RuntimeError) as error:
        raise HTTPException(400, str(error))


@router.post("/inspect")
def inspect_recovery(payload: Inspection):
    with workspace_lock:
        try:
            return inspect_source(source_path(payload.record_id), payload.resource_dir)
        except ValueError as error:
            raise HTTPException(400, str(error))


@router.post("/prepare")
def prepare(payload: Preparation):
    try:
        return prepare_recovery(payload.record_id, payload.resource_dir, payload.allow_missing)
    except (OSError, ValueError, KeyError, TypeError) as error:
        raise HTTPException(400, str(error))


@router.post("/apply")
def apply(payload: Application):
    try:
        return apply_recovery(payload.task_id)
    except (OSError, ValueError, KeyError, TypeError) as error:
        raise HTTPException(400, str(error))
