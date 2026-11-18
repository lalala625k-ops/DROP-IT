"""Match a WebView2 file drop to that event's native local image path."""
import math
import json
import ntpath
import os
import threading
import time
from desktop.file_sources import reference


def observe_dropped_files(api, window):
    # Keep pywebview's native file hand-off, but serialize only file metadata.
    # Its default Event serialization also walks target/currentTarget and the
    # entire canvas DOM, blocking the browser before it can display the image.
    body = window.dom.body
    callback = api._dropped_files.record
    if callback in body._event_handler_ids:
        body.off('drop', callback)
    # pywebview removes the cached element entry when the last handler is
    # detached; restore it before a hot reload or a second installation.
    window.dom._elements[body._node_id] = body
    body.on('drop', callback)
    handler_id = body._event_handler_ids[callback]
    return window.evaluate_js(compact_drop_script(handler_id, body._node_id))


def compact_drop_script(handler_id, node_id):
    # The adapter is limited to this listener; no global serializer or installed
    # pywebview code is changed. Keep its handler ID so body.off still cleans up.
    return """(() => {
      const id = %s, nodeId = %s;
      const view = window.pywebview;
      if (!window.chrome?.webview?.postMessageWithAdditionalObjects || !view?._eventHandlers[id]) return false;
      document.body.removeEventListener('drop', view._eventHandlers[id]);
      view._eventHandlers[id] = event => {
        if (!event.isTrusted || !event.dataTransfer?.files.length) return;
        const files = Array.from(event.dataTransfer.files);
        window.chrome.webview.postMessageWithAdditionalObjects('FilesDropped', files);
        const data = {type: 'drop', isTrusted: true, timeStamp: event.timeStamp,
          dataTransfer: {files: files.map(file => ({name: file.name, size: file.size, lastModified: file.lastModified}))}};
        view._jsApiCallback('pywebviewEventHandler', {event: data, nodeId}, 'eventHandler');
      };
      document.body.addEventListener('drop', view._eventHandlers[id]);
      return true;
    })()""" % (json.dumps(handler_id), json.dumps(node_id))


class DroppedFileSources:
    def __init__(self, clock=time.monotonic):
        self._clock = clock
        self._condition = threading.Condition()
        self._drops = {}

    def _prune(self):
        now = self._clock()
        self._drops = {key: value for key, value in self._drops.items() if now - value[0] <= 5}

    @staticmethod
    def _source(file):
        path = file.get('pywebviewFullPath')
        if not isinstance(path, str) or ntpath.basename(path) != file.get('name'):
            return None
        try:
            source = reference(path)
            stat = os.stat(source['path'])
            if stat.st_size != file.get('size') or abs(stat.st_mtime_ns / 1_000_000 - file.get('lastModified', -1)) > 1:
                return None
            return source
        except (OSError, ValueError, TypeError):
            return None

    def record(self, event):
        stamp = event.get('timeStamp')
        if event.get('isTrusted') is not True or not isinstance(stamp, (int, float)) or not math.isfinite(stamp):
            return
        files = event.get('dataTransfer', {}).get('files', [])
        sources = []
        for file in files:
            source = self._source(file)
            if source:
                sources.append((dict(file), source))
        with self._condition:
            self._prune()
            self._drops[stamp] = (self._clock(), sources)
            while len(self._drops) > 16:
                self._drops.pop(next(iter(self._drops)))
            self._condition.notify_all()

    def match(self, stamp, name, size, modified, timeout=5):
        # Native DOM callbacks can follow the JS bridge request by over a second.
        # Wait for this event only; a later drop must never supply its path.
        if not isinstance(stamp, (int, float)) or not math.isfinite(stamp):
            return None
        deadline = time.monotonic() + timeout
        with self._condition:
            while True:
                self._prune()
                entry = self._drops.get(stamp)
                if entry:
                    for index, (file, source) in enumerate(entry[1]):
                        if (file.get('name'), file.get('size'), file.get('lastModified')) == (name, size, modified):
                            entry[1].pop(index)
                            # The original file may have changed since the native event.
                            return source if self._source(file) else None
                    return None
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    return None
                self._condition.wait(remaining)


def attach_dropped_file_sources(api, window):
    # pywebview supplies pywebviewFullPath only for its native DOM drop events.
    # This observes the event without cancelling React's normal canvas intake.
    previous = getattr(api, '_drop_loaded_handler', None)
    if previous is not None:
        window.events.loaded -= previous
    def loaded():
        observe_dropped_files(api, window)
    api._drop_loaded_handler = loaded
    window.events.loaded += loaded
    # Attaching to an already running window must also survive its next reload.
    if window.events.loaded.is_set():
        loaded()
