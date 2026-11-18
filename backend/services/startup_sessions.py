"""Desktop launch records distinguish interrupted windows from normal closes."""
import datetime
import json
import os
import re
from pathlib import Path
from backend.services.atomic_files import atomic_json


def process_identity(pid):
    """None means exited; unknown conservatively means it may still be running."""
    if os.name == 'nt':
        import ctypes
        from ctypes import wintypes
        kernel = ctypes.WinDLL('kernel32', use_last_error=True)
        kernel.OpenProcess.argtypes = (wintypes.DWORD, wintypes.BOOL, wintypes.DWORD)
        kernel.OpenProcess.restype = wintypes.HANDLE
        kernel.CloseHandle.argtypes = (wintypes.HANDLE,)
        kernel.GetExitCodeProcess.argtypes = (wintypes.HANDLE, ctypes.POINTER(wintypes.DWORD))
        kernel.GetProcessTimes.argtypes = (wintypes.HANDLE,) + (ctypes.POINTER(wintypes.FILETIME),) * 4
        handle = kernel.OpenProcess(0x1000, False, pid)
        if not handle:
            return None if ctypes.get_last_error() == 87 else 'unknown'
        try:
            code = wintypes.DWORD()
            if not kernel.GetExitCodeProcess(handle, ctypes.byref(code)):
                return 'unknown'
            if code.value != 259:
                return None
            times = [wintypes.FILETIME() for _ in range(4)]
            if not kernel.GetProcessTimes(handle, *(ctypes.byref(value) for value in times)):
                return 'unknown'
            return str((times[0].dwHighDateTime << 32) | times[0].dwLowDateTime)
        finally:
            kernel.CloseHandle(handle)
    try:
        os.kill(pid, 0)
        # Linux start time also distinguishes PID reuse.
        stat = Path(f'/proc/{pid}/stat')
        return stat.read_text().rsplit(')', 1)[1].split()[19] if stat.is_file() else 'unknown'
    except ProcessLookupError:
        return None
    except (OSError, IndexError):
        return 'unknown'


def run_path(run_id):
    from backend.services import data_paths
    if not re.fullmatch(r'[0-9a-f]{32}', run_id or ''):
        raise ValueError('启动记录标识无效')
    return data_paths.CONFIG_DIR / 'window-runs' / f'{run_id}.json'


def begin_run(run_id, directory):
    atomic_json(run_path(run_id), {'run_id': run_id, 'data_dir': str(Path(directory).resolve()),
        'pid': os.getpid(), 'owner': process_identity(os.getpid()), 'closed': False})


def finish_run(run_id=None):
    run_id = run_id or os.environ.get('PINBOARD_RUN_ID')
    if not run_id:
        return
    path = run_path(run_id)
    record = json.loads(path.read_text(encoding='utf-8'))
    atomic_json(path, {**record, 'closed': True})


def relocate_run(directory):
    run_id = os.environ.get('PINBOARD_RUN_ID')
    if run_id:
        path = run_path(run_id)
        record = json.loads(path.read_text(encoding='utf-8'))
        atomic_json(path, {**record, 'data_dir': str(Path(directory).resolve())})


def interrupted_records():
    from backend.services import data_paths
    from backend.services.draft_store import board_folder, snapshot_files, read_snapshot, replay_journal, journal_path
    from backend.services.recovery_inspection import inspect_source
    records = []
    for path in (data_paths.CONFIG_DIR / 'window-runs').glob('*.json'):
        record = None
        try:
            run = json.loads(path.read_text(encoding='utf-8'))
            if run_path(run.get('run_id')) != path.resolve():
                continue
            if run.get('closed') or run.get('run_id') == os.environ.get('PINBOARD_RUN_ID'):
                continue
            owner = process_identity(int(run['pid']))
            if owner is not None and (owner == 'unknown' or owner == run.get('owner') or run.get('owner') == 'unknown'):
                continue
            info = json.loads((Path(run['data_dir']) / 'workspace.json').read_text(encoding='utf-8'))
            workspace_id = info['workspace_id']
            snapshot = None
            for source in snapshot_files(workspace_id):
                try:
                    snapshot = read_snapshot(workspace_id, source.stem, verify=False)
                    break
                except (OSError, ValueError, KeyError, TypeError):
                    continue
            warning = None
            try:
                saved = replay_journal(workspace_id, snapshot, verify=False)
            except (OSError, ValueError, KeyError, TypeError):
                saved = snapshot
                warning = '暂存日志不可用，使用最近可读检查点'
            if not saved or not any(saved['state'].get(key) for key in ('cards', 'groups', 'pins')):
                continue
            folder = data_paths.CONFIG_DIR / 'startup-recovery' / run['run_id']
            journal = journal_path(workspace_id)
            saved_at = (snapshot or {}).get('saved_at')
            if journal.is_file() and not warning:
                saved_at = datetime.datetime.fromtimestamp(journal.stat().st_mtime, datetime.timezone.utc).isoformat()
            staged = {**saved, 'format': 'drop-draft-v1', 'interrupted_run_id': run['run_id'],
                      'saved_at': saved_at or datetime.datetime.fromtimestamp(path.stat().st_mtime, datetime.timezone.utc).isoformat()}
            atomic_json(folder / 'snapshot.json', staged)
            record = inspect_source(folder / 'snapshot.json', str(board_folder(workspace_id) / 'resources'))
            if warning:
                record['reason'] = warning
            records.append(record)
        except (OSError, ValueError, KeyError, TypeError):
            # Leave damaged/legacy records untouched; manual recovery remains available.
            continue
    return sorted(records, key=lambda item: item.get('saved_at') or '', reverse=True)
