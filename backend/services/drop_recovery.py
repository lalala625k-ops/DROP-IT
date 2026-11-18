"""Version-bound choices for a file, its backup and matching draft history."""
import datetime
import hashlib
import json
import time
import uuid
import zipfile
import zlib
from pathlib import Path
from backend.services import data_paths
from backend.services.atomic_files import atomic_bytes, atomic_json
from backend.services.document_state import file_stamp
from backend.services.drop_archive import archive_state, NewerReaderRequired
from backend.services.draft_store import replay_journal, board_folder
from backend.services.file_settings import get_file_settings
from backend.services.recovery_inspection import inspect_source, matching_sources, register_source, source_path, read_external
from backend.services.recovery_tasks import prepare_recovery
from backend.services.workspace_session import session_info

_offers = {}
READ_ERRORS = (OSError, ValueError, KeyError, TypeError, zipfile.BadZipFile, RuntimeError, zlib.error, EOFError)


def _stamp(path):
    try:
        return file_stamp(path)
    except OSError:
        # An unreadable original must not hide an accessible backup.
        try:
            info = path.stat()
            return {'unreadable': True, 'mtime_ns': str(info.st_mtime_ns), 'size': info.st_size}
        except OSError:
            return {'unreadable': True}


def _timestamp(value, path):
    try:
        parsed = datetime.datetime.fromisoformat(value.replace('Z', '+00:00'))
        return parsed.timestamp()
    except (ValueError, TypeError, AttributeError):
        try:
            return path.stat().st_mtime
        except OSError:
            return 0


def _key(state):
    def clean(value):
        if isinstance(value, dict):
            return {key: clean(child) for key, child in value.items() if child is not None and key != 'isParsing'}
        if isinstance(value, list):
            return [clean(item) for item in value]
        return value
    state = {key: state.get(key, [] if key != 'viewport' else None) for key in ('cards', 'groups', 'pins', 'viewport')}
    state['groups'] = [{**item, 'collapsed': item.get('collapsed') or False, 'zIndex': item.get('zIndex') or 0} for item in state['groups']]
    return json.dumps(clean(state), sort_keys=True, ensure_ascii=False)


def _describe(kind, path, salvage=False, captured=None):
    candidate = {'id': uuid.uuid4().hex, 'kind': kind, 'path': str(path), 'status': 'unrecoverable',
                 'cards': 0, 'groups': 0, 'pins': 0, 'issues': [], 'warnings': []}
    internal = {'path': path, 'kind': kind, 'stamp': _stamp(path), 'salvage': salvage}
    try:
        if kind == 'draft':
            record = inspect_source(path)
            if record['status'] == 'unrecoverable':
                raise ValueError(record.get('reason', '暂存损坏'))
            data = read_external(path)
            # Include coalesced edits newer than this checkpoint, when valid.
            try:
                replayed = replay_journal(data['workspace_id'])
                if replayed and replayed.get('snapshot_id') == data.get('snapshot_id') and replayed.get('client_revision', -1) > data.get('client_revision', -1):
                    data = replayed
                    data['saved_at'] = datetime.datetime.fromtimestamp((board_folder(data['workspace_id']) / 'journal.jsonl').stat().st_mtime, datetime.timezone.utc).isoformat()
            except (OSError, ValueError):
                candidate['warnings'].append('日志不可用，使用所列检查点版本')
            state, saved_at = data['state'], data.get('saved_at')
            from backend.services.recovery_inspection import resource_issues
            missing, _ = resource_issues(data, board_folder(data['workspace_id']) / 'resources')
            internal['draft'] = data
            internal['journal_stamp'] = file_stamp(board_folder(data['workspace_id']) / 'journal.jsonl')
        else:
            result = archive_state(path, salvage)
            state, _, missing, warnings, saved_at = result
            if captured is not None:
                captured.update(archive=result, stamp=internal['stamp'])
            candidate['warnings'] = warnings
        candidate.update(status='partial' if missing or salvage else 'complete', issues=missing,
                         saved_at=saved_at, cards=len(state['cards']), groups=len(state['groups']), pins=len(state['pins']))
        internal.update(state_key=_key(state), time=_timestamp(saved_at, path))
    except READ_ERRORS as error:
        candidate['reason'] = ('文件不是完整的便签包或已损坏' if isinstance(error, zipfile.BadZipFile)
                               else '便签包缺少必要条目' if isinstance(error, KeyError)
                               else '元数据损坏或截断' if isinstance(error, json.JSONDecodeError)
                               else str(error) or '文件损坏或无法读取')
        internal['time'] = _timestamp(None, path)
        if isinstance(error, NewerReaderRequired):
            candidate['requires_upgrade'] = True
    candidate['saved_at'] = candidate.get('saved_at') or (datetime.datetime.fromtimestamp(internal['time'], datetime.timezone.utc).isoformat() if internal['time'] else '')
    return candidate, internal


def inspect_open(path: Path, force=False, captured=None):
    """Return None for an unambiguous valid file, otherwise an immutable offer."""
    path = path.resolve()
    original, original_data = _describe('original', path, captured=captured)
    candidates, entries = [original], {original['id']: original_data}
    matches = matching_sources(Path(get_file_settings()['temp_dir']), path)
    latest = {}
    for record in sorted(matches, key=lambda item: _timestamp(item.get('saved_at'), Path(item['draft_path'])), reverse=True):
        latest.setdefault(record['workspace_id'], record)
    for record in list(latest.values())[:5]:
        item, data = _describe('draft', Path(record['draft_path']))
        candidates.append(item); entries[item['id']] = data
    newer_drafts = [item for item in candidates if item['kind'] == 'draft' and item['status'] != 'unrecoverable'
                    and entries[item['id']]['time'] > original_data['time']
                    and entries[item['id']].get('state_key') != original_data.get('state_key')]
    # A missing referenced resource is also a partial read, even for v1 files.
    temporaries = (path.with_name(f'.{path.name}.tmp'), path.with_suffix(path.suffix + '.tmp'), path.with_suffix(path.suffix + '.saving'))
    if not force and original['status'] == 'complete' and not newer_drafts and not any(item.is_file() for item in temporaries):
        return None
    backup = path.with_suffix(path.suffix + '.bak')
    if backup.exists() or original['status'] == 'unrecoverable':
        item, data = _describe('backup', backup)
        candidates.insert(1, item); entries[item['id']] = data
    if original['status'] == 'unrecoverable' and not original.get('requires_upgrade'):
        item, data = _describe('salvage', path, True)
        candidates.append(item); entries[item['id']] = data
    # Inspect interrupted same-directory saves without publishing or deleting them.
    for temporary in temporaries:
        if temporary.is_file():
            item, data = _describe('temporary', temporary)
            candidates.append(item); entries[item['id']] = data
    complete = [item for item in candidates if item['status'] == 'complete']
    usable = complete or [item for item in candidates if item['status'] == 'partial']
    recommended = max(usable, key=lambda item: entries[item['id']]['time'])['id'] if usable else None
    now = time.monotonic()
    for token in list(_offers):
        if _offers[token]['expires'] < now:
            del _offers[token]
    token = uuid.uuid4().hex
    _offers[token] = {'expires': now + 600, 'workspace_id': session_info()['workspace_id'], 'source': path,
                      'source_stamp': original_data['stamp'], 'entries': entries}
    return {'inspection_id': token, 'source_path': str(path), 'candidates': candidates, 'recommended_id': recommended}


def refresh_offer(inspection_id):
    offer = _offers.get(inspection_id)
    if not offer or offer['expires'] < time.monotonic() or offer['workspace_id'] != session_info()['workspace_id']:
        raise ValueError('恢复选择已失效，请重新打开文件')
    return inspect_open(offer['source'], force=True)


def selected(inspection_id, candidate_id):
    offer = _offers.get(inspection_id)
    if not offer or offer['expires'] < time.monotonic() or offer['workspace_id'] != session_info()['workspace_id']:
        raise ValueError('恢复选择已失效，请重新打开文件')
    item = offer['entries'].get(candidate_id)
    if not item or _stamp(offer['source']) != offer['source_stamp'] or _stamp(item['path']) != item['stamp']:
        raise ValueError('文件已变化，请重新打开后选择恢复版本')
    if item['kind'] == 'draft' and file_stamp(board_folder(item['draft']['workspace_id']) / 'journal.jsonl') != item['journal_stamp']:
        raise ValueError('暂存日志已变化，请重新打开后选择恢复版本')
    return offer, item


def prepare_choice(inspection_id, candidate_id, allow_missing=False):
    offer, item = selected(inspection_id, candidate_id)
    folder = data_paths.CONFIG_DIR / 'drop-recovery-staging' / uuid.uuid4().hex
    if item['kind'] == 'draft':
        data = item['draft']
        from backend.services.recovery_inspection import resource_issues
        missing, valid = resource_issues(data, board_folder(data['workspace_id']) / 'resources')
        blobs = {url: blob.read_bytes() for url, blob in valid.items()}
        if any(hashlib.sha256(contents).hexdigest() != data['resources'][url] for url, contents in blobs.items()):
            raise ValueError('暂存资源已变化，请重新检查恢复版本')
        state, saved_at, warnings = data['state'], data.get('saved_at'), []
    else:
        state, blobs, missing, warnings, saved_at = archive_state(item['path'], item['salvage'])
    if (missing or item['salvage']) and not allow_missing:
        raise ValueError('请先确认部分恢复，缺失图片将显示占位')
    selected(inspection_id, candidate_id)  # Recheck after copying/reading source bytes.
    resources = {}
    for url, contents in blobs.items():
        digest = hashlib.sha256(contents).hexdigest()
        atomic_bytes(folder / 'resources' / digest, contents)
        resources[url] = digest
    snapshot = {'format': 'drop-draft-v1', 'workspace_id': uuid.uuid4().hex, 'state': state, 'resources': resources,
                'source_path': str(offer['source']), 'saved_at': saved_at, 'snapshot_id': 'recovered'}
    atomic_json(folder / 'snapshot.json', snapshot)
    result = prepare_recovery(register_source(folder / 'snapshot.json'), None, allow_missing)
    return {**result, 'warnings': warnings}
