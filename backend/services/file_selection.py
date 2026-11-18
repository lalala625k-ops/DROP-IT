"""Short-lived native file choices shared with a newly launched backend."""
import json
import re
import time
import uuid
from pathlib import Path
from backend.services import data_paths
from backend.services.atomic_files import atomic_json


def selection_path(selection_id):
    if not re.fullmatch(r'[0-9a-f]{32}', selection_id or ''):
        raise ValueError('文件选择标识无效')
    return data_paths.CONFIG_DIR / 'file-selections' / f'{selection_id}.json'


def remember_selection(path):
    selection_id = uuid.uuid4().hex
    atomic_json(selection_path(selection_id), {'path': str(Path(path).resolve()), 'expires': time.time() + 600})
    return selection_id


def selected_file(selection_id):
    data = json.loads(selection_path(selection_id).read_text(encoding='utf-8'))
    if data['expires'] < time.time():
        raise ValueError('文件选择已过期，请重新打开')
    return Path(data['path'])


def forget_selection(selection_id):
    try:
        selection_path(selection_id).unlink(missing_ok=True)
    except OSError:
        pass
