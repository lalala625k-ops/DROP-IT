import io
import os
import json
import io
import hashlib
import zipfile
import datetime
import threading
import shutil
import time
import uuid
from urllib.parse import unquote
from pathlib import Path
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, HTTPException, UploadFile, File, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from backend.services.data_paths import (
    get_data_dir, get_assets_dir, get_screenshots_dir, set_custom_data_dir,
    get_config, update_config,
)
from backend.services.drop_file_dialog import choose_drop_file, choose_existing_drop_file
from backend.services.template_paths import get_template_path
from backend.services.storage import load_data_from_disk, force_replace_all, get_revision
from backend.services.atomic_files import locked_workspace
from backend.services.workspace_session import workspace_scope, session_info, set_session, opened_session
from backend.services.file_settings import get_file_settings
from backend.services.draft_store import write_snapshot
from backend.services.document_state import document_status, file_stamp, saved_document

router = APIRouter(prefix="/api", tags=["settings_and_archive"], dependencies=[Depends(workspace_scope)])


class StoragePathUpdatePayload(BaseModel):
    new_path: str
    migrate_data: bool = True


class ArchiveExportPayload(BaseModel):
    viewport: Optional[Dict[str, Any]] = None
    pins: Optional[List[Dict[str, Any]]] = None
    cards: Optional[List[Dict[str, Any]]] = None
    groups: Optional[List[Dict[str, Any]]] = None


class DropSavePayload(ArchiveExportPayload):
    save_as: bool = False
    overwrite_stamp: Optional[Dict[str, Any]] = None


_drop_save_lock = threading.Lock()
_progressive_open_lock = threading.Lock()
_progressive_open_tasks: dict[str, dict[str, Any]] = {}


def _quick_file_stamp(path: Path) -> dict[str, Any] | None:
    try:
        info = path.stat()
    except OSError:
        return None
    return {'mtime_ns': str(info.st_mtime_ns), 'size': info.st_size}


def _progressive_media_state(meta: dict, manifest: dict[str, dict]) -> tuple[dict, list[dict]]:
    """Return metadata-first state and the image resources to hydrate later."""
    import copy
    from backend.services.draft_resources import resource_target
    from backend.services.scoped_media import scope_media

    state = {key: copy.deepcopy(meta.get(key, [] if key != 'viewport' else None))
             for key in ('cards', 'groups', 'pins', 'viewport')}
    state = scope_media(state)
    resources: list[dict] = []
    seen: set[str] = set()
    for card in state['cards']:
        if not isinstance(card, dict):
            continue
        for field in ('image', 'thumbnail', 'favicon'):
            value = card.get(field)
            target = resource_target(value) if isinstance(value, str) else None
            if target is None:
                continue
            url = value
            name = f'{target.parent.name}/{target.name}'
            if url not in seen:
                entry = manifest.get(name, {})
                resources.append({'url': url, 'target': str(target), 'name': name,
                                  'size': entry.get('size'), 'sha256': entry.get('sha256')})
                seen.add(url)
            card[field] = None
            recovery = dict(card.get('recoveryMedia') or {})
            detail = {'name': target.name, 'category': target.parent.name, 'reason': '图片正在加载'}
            entry = manifest.get(name, {})
            if isinstance(entry.get('sha256'), str):
                detail['digest'] = entry['sha256']
            recovery[field] = detail
            card['recoveryMedia'] = recovery
    return state, resources


def _progressive_task_update(task_id: str, **changes) -> None:
    with _progressive_open_lock:
        task = _progressive_open_tasks.get(task_id)
        if task is not None:
            task.update(changes)


def _run_progressive_open(task_id: str, source: Path, resources: list[dict]) -> None:
    from backend.services.atomic_files import atomic_bytes
    try:
        with _progressive_open_lock:
            expected_stamp = (_progressive_open_tasks.get(task_id) or {}).get('source_stamp')
        if expected_stamp is not None and _quick_file_stamp(source) != expected_stamp:
            raise ValueError('文件在读取期间发生变化，请重新选择')
        with zipfile.ZipFile(source) as archive:
            for resource in resources:
                if expected_stamp is not None and _quick_file_stamp(source) != expected_stamp:
                    raise ValueError('文件在读取期间发生变化，请重新选择')
                try:
                    contents = archive.read(resource['name'])
                    if isinstance(resource.get('size'), int) and len(contents) != resource['size']:
                        raise ValueError('资源大小校验失败')
                    digest = hashlib.sha256(contents).hexdigest()
                    if resource.get('sha256') and digest != resource['sha256']:
                        raise ValueError('资源校验失败')
                    atomic_bytes(Path(resource['target']), contents)
                    with _progressive_open_lock:
                        task = _progressive_open_tasks.get(task_id)
                        if task is not None:
                            task['updates'].append({'url': resource['url'], 'ready': True})
                            task['completed'] += 1
                except Exception as error:
                    with _progressive_open_lock:
                        task = _progressive_open_tasks.get(task_id)
                        if task is not None:
                            task['updates'].append({'url': resource['url'], 'ready': False,
                                                    'reason': str(error) or '图片读取失败'})
                            task['completed'] += 1
                            task['failed'] += 1
        _progressive_task_update(task_id, status='complete')
    except Exception as error:
        _progressive_task_update(task_id, status='failed', error=str(error) or '文件读取失败')


def _open_drop_file_progressive(payload: Optional[Dict[str, Any]]) -> dict:
    """Open package metadata immediately and hydrate resources in the background."""
    from backend.services.drop_archive import read_meta_fast
    from backend.services.file_selection import selected_file, forget_selection
    selection_id = payload.get('selection_id') if payload else None
    try:
        target = selected_file(selection_id) if selection_id else choose_existing_drop_file(_default_open_path())
        if target is None:
            return {'success': False, 'cancelled': True}
        if target.name.lower().endswith('.drop.bak'):
            target = target.with_suffix('')
        expected_stamp = _quick_file_stamp(target)
        meta, manifest = read_meta_fast(target)
        state, resources = _progressive_media_state(meta, manifest)
        source = None if target.resolve() == get_template_path().resolve() else target
        info = opened_session(source, get_data_dir())
        if source:
            import copy
            from backend.services.scoped_media import scope_media
            full_state = scope_media({key: copy.deepcopy(meta.get(key, [] if key != 'viewport' else None))
                                      for key in ('cards', 'groups', 'pins', 'viewport')})
            info = saved_document(info, target, full_state)
        write_snapshot(info, state, get_revision() + 1, 0)
        revision = force_replace_all(state)
        set_session(info, get_data_dir())
        changes = {'drop_open_storage_dir': str(get_data_dir().resolve()), 'drop_last_open_path': str(target)}
        if target.resolve() == get_template_path().resolve():
            changes.update(drop_file_path=None, drop_storage_dir=None)
        else:
            changes.update(drop_file_path=str(target), drop_storage_dir=str(get_data_dir().resolve()))
        update_config(changes)
        target.with_suffix(target.suffix + '.template').unlink(missing_ok=True)
        task_id = uuid.uuid4().hex
        with _progressive_open_lock:
            _progressive_open_tasks[task_id] = {'status': 'running', 'updates': [], 'completed': 0,
                                                 'failed': 0, 'total': len(resources), 'source_stamp': expected_stamp}
        threading.Thread(target=_run_progressive_open, args=(task_id, target, resources),
                         daemon=True, name='ProgressiveDropOpen').start()
        return {'success': True, 'path': str(target), 'filename': target.name, 'cards': state['cards'],
                'groups': state['groups'], 'viewport': state.get('viewport'), 'pins': state.get('pins', []),
                'revision': revision, 'workspace_id': info['workspace_id'],
                'progressive_task_id': task_id}
    finally:
        if selection_id:
            forget_selection(selection_id)


def _current_drop_path() -> Path:
    directory = get_data_dir().resolve()
    config = get_config()
    if (directory / "workspace.json").is_file():
        source = session_info(directory, config).get("source_path")
        return Path(source).resolve() if source else directory / "board.drop"
    if config.get("drop_storage_dir") == str(directory) and config.get("drop_file_path"):
        return Path(config["drop_file_path"]).resolve()
    return directory / "board.drop"


def _has_explicit_drop_path() -> bool:
    """Return whether the current workspace has a remembered user file."""
    directory = get_data_dir().resolve()
    config = get_config()
    if (directory / "workspace.json").is_file():
        return bool(session_info(directory, config).get("source_path"))
    path = config.get("drop_file_path")
    return (
        config.get("drop_storage_dir") == str(directory)
        and isinstance(path, str)
        and bool(path.strip())
    )


def _default_open_path() -> Path:
    remembered = get_config().get("drop_last_open_path")
    if remembered:
        return Path(remembered)
    has_opened = get_config().get("drop_open_storage_dir") == str(get_data_dir().resolve())
    if has_opened and _has_explicit_drop_path():
        return _current_drop_path()
    return get_template_path()


def _install_project_template() -> bool:
    """Install the bundled first-run board when the user has no workspace yet."""
    if _has_explicit_drop_path() or os.environ.get("PINBOARD_NEW_BOARD") == "1" or os.environ.get("PINBOARD_RELEASE_EMPTY") == "1":
        return False
    target = _current_drop_path()
    template = get_template_path()
    if target.exists() or not template.is_file():
        return False
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(template, target)
    target.with_suffix(target.suffix + ".template").touch()
    # .drop keeps media beside its metadata. Extract the bundled media once so
    # cards referring to /api/assets and /api/screenshots work immediately.
    try:
        with zipfile.ZipFile(template, mode="r") as archive:
            for name, folder in (("assets/", get_assets_dir()), ("screenshots/", get_screenshots_dir())):
                folder.mkdir(parents=True, exist_ok=True)
                for member in archive.namelist():
                    if not member.startswith(name) or member.endswith("/"):
                        continue
                    filename = Path(member).name
                    if filename:
                        destination = folder / filename
                        if not destination.exists():
                            with archive.open(member) as source, destination.open("wb") as output:
                                shutil.copyfileobj(source, output)
    except Exception:
        # The metadata file remains usable even if an individual asset fails.
        pass
    return True


def _workspace_cards_groups(payload: ArchiveExportPayload) -> tuple[list, list]:
    cards = payload.cards
    groups = payload.groups
    if cards is None or groups is None:
        disk_data = load_data_from_disk()
        cards = cards if cards is not None else disk_data.get("cards", [])
        groups = groups if groups is not None else disk_data.get("groups", [])
    return cards or [], groups or []


def _build_drop_bytes(payload: ArchiveExportPayload) -> bytes:
    """Build a v2 package while keeping its meta.json readable by v1 clients."""
    cards, groups = _workspace_cards_groups(payload)
    meta = {
        "version": "1.0",
        "format": "drop",
        "savedAt": datetime.datetime.now().isoformat(),
        "viewport": payload.viewport or {"x": 0, "y": 0, "zoom": 1.0},
        "pins": payload.pins or [],
        "cards": cards,
        "groups": groups,
    }
    referenced_assets, referenced_screenshots = _referenced_resource_names(cards, groups)
    resources: list[tuple[Path, str]] = []
    for directory, prefix, names in (
        (get_assets_dir(), "assets", referenced_assets),
        (get_screenshots_dir(), "screenshots", referenced_screenshots),
    ):
        for name in sorted(names):
            resources.append((directory / name, f"{prefix}/{name}"))
    meta_bytes = json.dumps(meta, ensure_ascii=False, indent=2).encode("utf-8")
    manifest = {
        "format": 2,
        "app_version": "0.1",
        "saved_at": meta["savedAt"],
        "revision": get_revision(),
        "workspace_id": session_info().get("workspace_id"),
        "object_counts": {"cards": len(cards), "groups": len(groups), "pins": len(meta["pins"])},
        "meta_sha256": hashlib.sha256(meta_bytes).hexdigest(),
        "resources": [],
        "min_reader": 1,
    }
    packaged: list[tuple[str, bytes]] = []
    for item, archive_path in resources:
        if not item.is_file():
            raise FileNotFoundError(f'保存引用的资源缺失：{item.name}')
        contents = item.read_bytes()
        manifest['resources'].append({'path': archive_path, 'size': len(contents),
                                      'sha256': hashlib.sha256(contents).hexdigest()})
        packaged.append((archive_path, contents))
    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("meta.json", meta_bytes)
        zf.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))
        for archive_path, contents in packaged:
            zf.writestr(archive_path, contents, compress_type=zipfile.ZIP_STORED)
    return zip_buffer.getvalue()


def _referenced_resource_names(cards: list, groups: list) -> tuple[set[str], set[str]]:
    """Return local asset/screenshot basenames referenced by the workspace.

    Saved workspaces used to include every file in the data directories. That
    kept deleted images inside later .drop files. Only paths served by this
    application are considered; remote website URLs are ignored.
    """
    assets: set[str] = set()
    screenshots: set[str] = set()

    def visit(value: Any) -> None:
        if isinstance(value, dict):
            for child in value.values():
                visit(child)
        elif isinstance(value, (list, tuple)):
            for child in value:
                visit(child)
        elif isinstance(value, str):
            for marker, target in (
                ("/api/assets/", assets),
                ("/api/thumbnails/assets/", assets),
                ("/api/screenshots/", screenshots),
                ("/api/thumbnails/screenshots/", screenshots),
            ):
                if not value.startswith(marker):
                    continue
                filename = unquote(value[len(marker):]).split("?", 1)[0].split("#", 1)[0]
                # A resource URL must identify one basename, never a path.
                if filename and "/" not in filename and "\\" not in filename:
                    target.add(filename)

    visit(cards)
    visit(groups)
    return assets, screenshots


def _prune_unreferenced_resources(cards: list, groups: list) -> None:
    """Remove local media no longer reachable from the current workspace."""
    referenced_assets, referenced_screenshots = _referenced_resource_names(cards, groups)
    for directory, names in (
        (get_assets_dir(), referenced_assets),
        (get_screenshots_dir(), referenced_screenshots),
    ):
        if not directory.is_dir():
            continue
        for item in directory.iterdir():
            if item.is_file() and item.name not in names:
                try:
                    item.unlink()
                except OSError:
                    # A thumbnailer or another request may still have a file open.
                    pass


def _read_drop_meta(path: Path) -> Dict[str, Any]:
    if not path.name.lower().endswith((".drop", ".drop.tmp", ".drop.bak", ".drop.saving")):
        raise ValueError("请选择 .drop 工作区文件")
    from backend.services.drop_archive import read_meta
    return read_meta(path)


def _extract_drop_assets(path: Path, loaded=None) -> None:
    from backend.services.drop_archive import archive_state
    from backend.services.draft_resources import resource_target
    from backend.services.atomic_files import atomic_bytes
    _, blobs, missing, _, _ = loaded if loaded is not None else archive_state(path)
    if missing:
        raise ValueError('便签包缺少可校验的图片，请使用部分恢复')
    for url, contents in blobs.items():
        atomic_bytes(resource_target(url), contents)


def _replace_with_retry(source: Path, target: Path) -> None:
    last_error: OSError | None = None
    for delay in (0, 0.05, 0.1, 0.2):
        if delay:
            time.sleep(delay)
        try:
            os.replace(source, target)
            return
        except PermissionError as error:
            last_error = error
    raise last_error or OSError("无法替换保存文件")


def _check_save_space(directory: Path, required_bytes: int) -> None:
    if shutil.disk_usage(directory).free < required_bytes * 2:
        raise OSError("磁盘可用空间不足，至少需要保存内容两倍的可用空间")


_STAMP_UNSET = object()


def _transactional_drop_save(target: Path, contents: bytes, expected_stamp=_STAMP_UNSET) -> None:
    """Publish a verified package while retaining the immediately previous version."""
    target.parent.mkdir(parents=True, exist_ok=True)
    _check_save_space(target.parent, len(contents))
    temporary = target.with_name(f".{target.name}.tmp")
    backup = target.with_suffix(target.suffix + ".bak")
    if temporary.exists():
        raise OSError(f"发现遗留临时文件：{temporary.name}；请先恢复、删除或忽略后再保存")
    moved_original = False
    try:
        with temporary.open("xb") as stream:
            stream.write(contents)
            stream.flush()
            os.fsync(stream.fileno())
        _read_drop_meta(temporary)
        observed = file_stamp(target)
        if expected_stamp is not _STAMP_UNSET and observed != expected_stamp:
            raise HTTPException(409, detail={"code": "external_changed", "path": str(target),
                                           "stamp": observed, "missing": observed is None})
        if target.exists():
            _replace_with_retry(target, backup)
            moved_original = True
        _replace_with_retry(temporary, target)
    except Exception:
        if moved_original and not target.exists() and backup.exists():
            try:
                _replace_with_retry(backup, target)
            except OSError:
                pass
        raise
    finally:
        temporary.unlink(missing_ok=True)


@router.get("/settings/storage-path")
async def get_storage_path():
    current = get_data_dir()
    default_base = Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData" / "Local"))
    default_path = (default_base / "InfiniteCanvasNote" / "data").resolve()
    return {
        "current_path": str(current),
        "default_path": str(default_path),
        "is_default": current == default_path,
    }


@router.post("/settings/storage-path")
@locked_workspace
def update_storage_path(payload: StoragePathUpdatePayload):
    new_path_str = payload.new_path.strip()
    if not new_path_str:
        raise HTTPException(status_code=400, detail="保存路径不能为空")
    try:
        result = set_custom_data_dir(new_path_str, payload.migrate_data)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"更改存储目录失败: {str(e)}")


@router.post("/archive/export")
async def export_archive(payload: ArchiveExportPayload):
    # Retrieve cards and groups
    cards = payload.cards
    groups = payload.groups
    if cards is None or groups is None:
        disk_data = load_data_from_disk()
        if cards is None:
            cards = disk_data.get("cards", [])
        if groups is None:
            groups = disk_data.get("groups", [])

    now_str = datetime.datetime.now().strftime("%Y-%m-%d_%H%M%S")
    meta = {
        "version": "1.0",
        "exportedAt": datetime.datetime.now().isoformat(),
        "viewport": payload.viewport or {"x": 0, "y": 0, "zoom": 1.0},
        "pins": payload.pins or [],
        "cards": cards,
        "groups": groups,
    }

    # Collect referenced assets
    assets_dir = get_assets_dir()
    screenshots_dir = get_screenshots_dir()

    zip_buffer = io.BytesIO()
    referenced_assets, referenced_screenshots = _referenced_resource_names(cards, groups)
    with zipfile.ZipFile(zip_buffer, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
        # Write metadata
        zf.writestr("meta.json", json.dumps(meta, ensure_ascii=False, indent=2))

        for directory, prefix, names in (
            (assets_dir, "assets", referenced_assets),
            (screenshots_dir, "screenshots", referenced_screenshots),
        ):
            for name in sorted(names):
                item = directory / name
                if item.is_file():
                    try:
                        zf.write(item, arcname=f"{prefix}/{item.name}")
                    except Exception:
                        pass

    zip_buffer.seek(0)
    filename = f"canvas_archive_{now_str}.note"
    return StreamingResponse(
        zip_buffer,
        media_type="application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'}
    )


@router.post("/storage/save")
def save_drop_file(payload: DropSavePayload):
    """Run dialog and archive writing off the API event loop."""
    if not _drop_save_lock.acquire(blocking=False):
        raise HTTPException(status_code=409, detail="正在保存，请稍候")
    try:
        workspace_id = session_info(get_data_dir(), get_config())["workspace_id"]
        has_explicit_path = _has_explicit_drop_path()
        target = _current_drop_path()
        # A workspace without an explicit file has never been saved by the
        # user. Prompt on its first Ctrl+S, just like an ordinary editor.
        choose_path = payload.save_as or not has_explicit_path
        if choose_path:
            target = choose_drop_file(Path(get_file_settings()["save_dir"]) / target.name)
            if target is None:
                return {"success": False, "cancelled": True}
        return _save_drop_to_target(payload, target, choose_path, workspace_id)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"保存 .drop 文件失败: {str(e)}")
    finally:
        _drop_save_lock.release()


@locked_workspace
def _save_drop_to_target(payload, target, choose_path, workspace_id):
    info = session_info(get_data_dir(), get_config())
    if info["workspace_id"] != workspace_id:
        raise HTTPException(409, "工作区已切换，请重新保存")
    observed = file_stamp(target)
    if not choose_path and info.get("document_stamp") != observed:
        if payload.overwrite_stamp != (observed or {"missing": True}):
            raise HTTPException(409, detail={"code": "external_changed", "path": str(target),
                                           "stamp": observed, "missing": observed is None})
    cards, groups = _workspace_cards_groups(payload)
    contents = _build_drop_bytes(payload)
    if file_stamp(target) != observed:
        raise HTTPException(409, detail={"code": "external_changed", "path": str(target),
                                       "stamp": file_stamp(target)})
    _transactional_drop_save(target, contents, expected_stamp=observed)
    # The captured document may already be older than the live canvas.
    # Do not delete resources uploaded by edits made during this save.
    target.with_suffix(target.suffix + ".template").unlink(missing_ok=True)
    # Keep both the active save path and the dialog's last-open path in
    # sync. Save As must become the file restored by the next launch;
    # otherwise a later open dialog can jump back to an older workspace.
    update_config({"drop_file_path": str(target),
                   "drop_storage_dir": str(get_data_dir().resolve()),
                   "drop_last_open_path": str(target)})
    state = {"cards": cards, "groups": groups, "viewport": payload.viewport or {"x": 0, "y": 0, "zoom": 1},
             "pins": payload.pins or []}
    set_session(saved_document(info, target, state), get_data_dir())
    return {"success": True, "path": str(target), "filename": target.name}


@router.post('/storage/select-open')
def select_open_file():
    """Show the picker before any checkpoint, workspace lock or child startup."""
    from backend.services.file_selection import remember_selection
    try:
        target = choose_existing_drop_file(_default_open_path())
        return {'selection_id': remember_selection(target)} if target is not None else {'cancelled': True}
    except (OSError, ValueError, RuntimeError) as error:
        raise HTTPException(400, str(error))


@router.post("/storage/open")
@locked_workspace
def open_drop_file(payload: Optional[Dict[str, Any]] = None):
    """Choose a .drop workspace, replace the current database, and return it."""
    if payload and payload.get('progressive') is True:
        try:
            return _open_drop_file_progressive(payload)
        except (OSError, ValueError, KeyError, TypeError, zipfile.BadZipFile) as error:
            raise HTTPException(status_code=400, detail=f"打开 .drop 文件失败: {error}")
    try:
        from backend.services.drop_recovery import inspect_open, selected
        captured = {}
        if payload and payload.get('inspection_id'):
            offer, choice = selected(payload['inspection_id'], payload.get('candidate_id'))
            if choice['kind'] != 'original':
                raise ValueError('备份和暂存须在独立新画板恢复')
            target = offer['source']
            expected_stamp = offer['source_stamp']
        else:
            if payload and payload.get('selection_id'):
                from backend.services.file_selection import selected_file
                target = selected_file(payload['selection_id'])
            else:
                target = choose_existing_drop_file(_default_open_path())
            if target is not None:
                if target.name.lower().endswith('.drop.bak'):
                    target = target.with_suffix('')
                report = inspect_open(target, captured=captured)
                if report:
                    raise HTTPException(409, detail={'code': 'recovery_required', **report})
                expected_stamp = captured['stamp']
        if target is None:
            return {"success": False, "cancelled": True}
        if not captured:
            from backend.services.drop_archive import archive_state
            captured['archive'] = archive_state(target)
        meta = captured['archive'][0]
        cards = meta.get("cards", [])
        groups = meta.get("groups", [])
        if not isinstance(cards, list) or not isinstance(groups, list):
            raise ValueError("便签包中的卡片或分组数据无效")
        _extract_drop_assets(target, captured['archive'])
        if file_stamp(target) != expected_stamp:
            raise ValueError('文件在读取期间发生变化，请重新选择')
        state = {"cards": cards, "groups": groups, "viewport": meta.get("viewport"), "pins": meta.get("pins", [])}
        from backend.services.scoped_media import scope_media
        state = scope_media(state)
        cards, groups = state["cards"], state["groups"]
        info = opened_session(None if target.resolve() == get_template_path().resolve() else target, get_data_dir())
        # Protect the incoming board's media before adopting its identity.
        from backend.services.storage import get_revision
        write_snapshot(info, state, get_revision() + 1, 0)
        revision = force_replace_all(state)
        if info.get("source_path"):
            info = saved_document(info, target, state)
        set_session(info, get_data_dir())
        changes = {"drop_open_storage_dir": str(get_data_dir().resolve()), "drop_last_open_path": str(target)}
        if target.resolve() == get_template_path().resolve():
            # Opening the example starts an unsaved workspace. Its first save
            # must choose a user file rather than replace the shipped example.
            changes.update(drop_file_path=None, drop_storage_dir=None)
        else:
            changes.update(drop_file_path=str(target), drop_storage_dir=str(get_data_dir().resolve()))
        update_config(changes)
        target.with_suffix(target.suffix + ".template").unlink(missing_ok=True)
        return {
            "success": True,
            "path": str(target),
            "filename": target.name,
            "cards": cards,
            "groups": groups,
            "viewport": meta.get("viewport"),
            "pins": meta.get("pins", []),
            "revision": revision,
            "workspace_id": info["workspace_id"],
        }
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=400, detail=f"打开 .drop 文件失败: {error}")
    finally:
        if payload and payload.get('selection_id'):
            from backend.services.file_selection import forget_selection
            forget_selection(payload['selection_id'])


@router.get('/storage/open-progress/{task_id}')
def progressive_open_status(task_id: str, cursor: int = 0):
    """Return image hydration progress for a metadata-first file open."""
    if not isinstance(cursor, int) or cursor < 0:
        raise HTTPException(400, '进度游标无效')
    with _progressive_open_lock:
        task = _progressive_open_tasks.get(task_id)
        if task is None:
            raise HTTPException(404, '打开任务已失效')
        updates = task['updates'][cursor:]
        return {'status': task['status'], 'updates': updates, 'next_cursor': cursor + len(updates),
                'completed': task['completed'], 'failed': task['failed'], 'total': task['total'],
                'error': task.get('error')}


@router.post('/storage/recovery/prepare')
@locked_workspace
def prepare_drop_recovery(payload: Dict[str, Any]):
    from backend.services.drop_recovery import prepare_choice, READ_ERRORS
    try:
        return prepare_choice(payload.get('inspection_id'), payload.get('candidate_id'), payload.get('allow_missing') is True)
    except READ_ERRORS as error:
        raise HTTPException(400, str(error))


@router.post('/storage/recovery/refresh')
@locked_workspace
def refresh_drop_recovery(payload: Dict[str, Any]):
    from backend.services.drop_recovery import refresh_offer, READ_ERRORS
    try:
        return refresh_offer(payload.get('inspection_id'))
    except READ_ERRORS as error:
        raise HTTPException(400, str(error))


@router.get("/storage/document")
@locked_workspace
def get_document_status(include_state: bool = False):
    info = session_info()
    # Establish a baseline for workspaces saved before document-state support.
    if info.get("source_path") and "document_stamp" not in info:
        path = Path(info["source_path"])
        if path.is_file():
            try:
                info = saved_document(info, path, _read_drop_meta(path))
                set_session(info)
            except (OSError, ValueError, KeyError, TypeError, zipfile.BadZipFile) as error:
                # An old session with a damaged source still needs Save As.
                return {**document_status(info, include_state), 'document_error': str(error)}
    return document_status(info, include_state)


class DocumentActionPayload(BaseModel):
    workspace_id: str
    stamp: Optional[Dict[str, Any]] = None


def _reset_working_document(payload: DocumentActionPayload, reload_file: bool) -> dict:
    from backend.services.draft_store import board_folder
    import uuid
    info = session_info()
    if payload.workspace_id != info["workspace_id"]:
        raise HTTPException(409, "工作区已切换，请重新载入")
    source = info.get("source_path")
    state = {"cards": [], "groups": [], "pins": [], "viewport": None}
    if source:
        path = Path(source)
        if file_stamp(path) != payload.stamp:
            raise HTTPException(409, "文件再次发生变化，请重新检查后操作")
        if path.is_file():
            state = _read_drop_meta(path)
            _extract_drop_assets(path)
        elif reload_file:
            raise HTTPException(400, "原文件已不存在，无法重新加载")
        else:
            state = info.get("document_saved_state") or state
        state = {key: state.get(key, [] if key != "viewport" else None)
                 for key in ("cards", "groups", "pins", "viewport")}
    elif reload_file:
        raise HTTPException(400, "未命名画板没有可重新加载的文件")
    directory = board_folder(info["workspace_id"])
    new_info = {"workspace_id": uuid.uuid4().hex, "source_path": source, "initialized": True}
    if source:
        new_info = saved_document(new_info, Path(source), state)
    from backend.services.storage import get_revision
    write_snapshot(new_info, state, get_revision() + 1, 0)
    previous_state = load_data_from_disk()
    revision = force_replace_all(state)
    try:
        set_session(new_info)
    except Exception:
        # Keep the old document usable if publishing its new identity fails.
        force_replace_all(previous_state)
        raise
    # Data remains scoped to this validated UUID directory; never touch .drop/.bak.
    root = Path(get_file_settings()["temp_dir"]).resolve()
    if directory.exists() and directory.resolve().parent == root and not directory.is_symlink():
        shutil.rmtree(directory)
    return {"success": True, **state, **new_info, "revision": revision}


@router.post("/storage/reload")
@locked_workspace
def reload_document(payload: DocumentActionPayload):
    return _reset_working_document(payload, True)


@router.post("/storage/discard")
@locked_workspace
def discard_document(payload: DocumentActionPayload):
    return _reset_working_document(payload, False)


@router.get("/storage/load")
async def load_drop_file():
    """Read the stored .drop file when the database has no workspace data."""
    target = _current_drop_path()
    installed_template = _install_project_template()
    is_template = installed_template or target.with_suffix(target.suffix + ".template").is_file()
    if not target.is_file():
        return {"success": False, "cards": [], "groups": []}
    try:
        meta = _read_drop_meta(target)
        return {"success": True, "is_template": is_template, **meta}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"读取 .drop 文件失败: {str(e)}")


@router.post("/archive/import")
async def import_archive(file: UploadFile = File(...)):
    contents = await file.read()
    if not contents:
        raise HTTPException(status_code=400, detail="上传文件为空")

    try:
        zip_buffer = io.BytesIO(contents)
        with zipfile.ZipFile(zip_buffer, mode="r") as zf:
            namelist = zf.namelist()
            if "meta.json" not in namelist:
                raise HTTPException(status_code=400, detail="便签包损坏或缺少 meta.json")

            meta_raw = zf.read("meta.json").decode("utf-8")
            meta = json.loads(meta_raw)

            cards = meta.get("cards", [])
            groups = meta.get("groups", [])
            viewport = meta.get("viewport")
            pins = meta.get("pins", [])

            # Extract assets
            target_assets = get_assets_dir()
            target_screenshots = get_screenshots_dir()
            target_assets.mkdir(parents=True, exist_ok=True)
            target_screenshots.mkdir(parents=True, exist_ok=True)

            for name in namelist:
                if name.startswith("assets/") and len(name) > len("assets/"):
                    fname = os.path.basename(name)
                    if fname:
                        target_file = target_assets / fname
                        with zf.open(name) as src, open(target_file, "wb") as dst:
                            dst.write(src.read())

                elif name.startswith("screenshots/") and len(name) > len("screenshots/"):
                    fname = os.path.basename(name)
                    if fname:
                        target_file = target_screenshots / fname
                        with zf.open(name) as src, open(target_file, "wb") as dst:
                            dst.write(src.read())

            # Replace in database
            revision = force_replace_all({"cards": cards, "groups": groups})

            return {
                "success": True,
                "cards": cards,
                "groups": groups,
                "viewport": viewport,
                "pins": pins,
                "revision": revision,
            }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"导入便签包失败: {str(e)}")
