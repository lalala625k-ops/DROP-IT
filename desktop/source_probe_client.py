"""A hidden, killable COM/UIA helper so source reads cannot block the desktop."""
import json
import os
import queue
import subprocess
import sys
import threading
import time
from pathlib import Path


class DocumentProbe:
    def __init__(self):
        self._process = None
        self._lock = threading.RLock()
        self._lines = queue.Queue()
        self._closed = False

    def start(self):
        with self._lock:
            if self._closed:
                raise RuntimeError('source helper stopped')
            if self._process and self._process.poll() is None:
                return
            self._start()

    def _start(self):
        command = [sys.executable, '--source-worker'] if getattr(sys, 'frozen', False) else [
            sys.executable, '-u', str(Path(__file__).with_name('source_worker.py'))]
        self._lines = queue.Queue()
        self._process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL, text=True, encoding='utf-8',
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
        process, lines = self._process, self._lines
        def read():
            try:
                for line in process.stdout:
                    lines.put(line)
            except (OSError, ValueError):
                pass
        threading.Thread(target=read, daemon=True).start()
        try:
            if not json.loads(lines.get(timeout=8)).get('ready'):
                raise RuntimeError('source helper failed')
        except Exception:
            self._reset()
            raise

    def read(self, hwnd, expected_title=None, expected_url=None):
        with self._lock:
            if self._closed:
                return None
            try:
                if not self._process or self._process.poll() is not None:
                    self.start()
                request = {'hwnd': hwnd, 'title': expected_title}
                if expected_url is not None:
                    request['url'] = expected_url
                self._process.stdin.write(json.dumps(request) + '\n')
                self._process.stdin.flush()
                return json.loads(self._lines.get(timeout=1.5)).get('source')
            except Exception:
                self._reset()
                return None

    def stop(self):
        with self._lock:
            self._closed = True
            self._reset()

    def capture_control(self, hwnd, x, y):
        # Never start or wait behind a document read for an input gesture.
        deadline = time.monotonic() + .2
        if not self._lock.acquire(blocking=False):
            return None
        try:
            process = self._process
            if self._closed or not process or process.poll() is not None:
                return None
            request = {'op': 'capture_control', 'hwnd': hwnd, 'x': x, 'y': y}
            process.stdin.write(json.dumps(request) + '\n')
            process.stdin.flush()
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError()
            return json.loads(self._lines.get(timeout=remaining)).get('source')
        except Exception:
            # Detach both stream and queue before asynchronous cleanup so a
            # late UIA response cannot answer a later document request.
            process, self._process = self._process, None
            self._lines = queue.Queue()
            if process:
                def discard():
                    try:
                        if process.poll() is None:
                            process.kill()
                        process.wait(timeout=2)
                        for stream in (process.stdin, process.stdout):
                            if stream:
                                stream.close()
                    except Exception:
                        pass
                threading.Thread(target=discard, daemon=True).start()
            return None
        finally:
            self._lock.release()

    def _reset(self):
        process, self._process = self._process, None
        if process:
            if process.poll() is None:
                process.kill()
            process.wait(timeout=2)
            for stream in (process.stdin, process.stdout):
                if stream:
                    stream.close()
