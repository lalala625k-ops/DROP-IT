"""Request-local metadata progress and opt-in, content-free test timings."""
import logging
import os
import time
from contextlib import contextmanager
from contextvars import ContextVar
from functools import wraps

_receiver = ContextVar('metadata_progress', default=None)
_logger = logging.getLogger(__name__)


def record_timing(stage, started):
    if os.environ.get('PINBOARD_PARSE_TIMINGS') == '1':
        _logger.info('parse_timing stage=%s elapsed_ms=%.2f', stage, (time.perf_counter() - started) * 1000)


def timed_operation(stage):
    def decorate(function):
        @wraps(function)
        def invoke(*args, **kwargs):
            started = time.perf_counter()
            try:
                return function(*args, **kwargs)
            finally:
                record_timing(stage, started)
        return invoke
    return decorate


@contextmanager
def progress_scope(receiver):
    started = time.perf_counter()
    published = False
    last = None

    def receive(metadata):
        nonlocal published, last
        if metadata == last:
            return
        last = metadata
        if not published:
            record_timing('web_metadata', started)
            published = True
        receiver(metadata)

    token = _receiver.set(receive)
    try:
        yield
    finally:
        _receiver.reset(token)


def publish_metadata(metadata):
    receiver = _receiver.get()
    if receiver:
        # Partial messages carry text only, never provisional cover addresses.
        receiver({key: value for key in ('title', 'description', 'author', 'favicon')
                  if isinstance(value := metadata.get(key), str)})
