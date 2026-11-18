"""Every desktop launch owns a fresh working directory and a close record."""
import os
import uuid
from pathlib import Path


def prepare_launch(child=False):
    board_id = uuid.uuid4().hex[:12]
    root = Path(os.environ.get('PINBOARD_CONFIG_DIR') or
                Path(os.environ.get('LOCALAPPDATA', Path.home() / 'AppData/Local')) / 'InfiniteCanvasNote')
    if not child or not os.environ.get('PINBOARD_DATA_DIR'):
        os.environ['PINBOARD_DATA_DIR'] = str(root / 'boards' / 'desktop' / board_id)
    os.environ['PINBOARD_NEW_BOARD'] = '1'
    os.environ['PINBOARD_RUN_ID'] = uuid.uuid4().hex
    from backend.services.startup_sessions import begin_run
    begin_run(os.environ['PINBOARD_RUN_ID'], os.environ['PINBOARD_DATA_DIR'])
    return Path(os.environ['PINBOARD_DATA_DIR']).name
