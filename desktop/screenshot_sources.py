"""Observe verified WeChat/Windows crops without intercepting input or clipboard."""
import ctypes as c
import base64
import io
import ntpath
import os
import queue
import threading
import time
from ctypes import wintypes as w
from types import SimpleNamespace
from PIL import Image, ImageGrab
from desktop.file_sources import SourceStore, verified_crop
from desktop.source_probe_client import DocumentProbe
from desktop.source_browser import is_edge, web_reference
from desktop.browser_snapshot import BrowserSnapshot
from desktop.screenshot_events import ScreenshotEvents


class ScreenshotSources(ScreenshotEvents):
    def __init__(self):
        self._store = SourceStore()
        self._stop = threading.Event()
        self._tasks = queue.Queue()
        self._probe = DocumentProbe()
        self._browser_snapshot = BrowserSnapshot()
        self._pending = None
        self._windows = None
        self._status = 'starting'
        self._probe_ready = False
        self._listener_ready = False
        self._last_capture = 'idle'
        self._last_image_attempt = None
        self._last_clipboard_sequence = None
        self._last_foreground = None
        self._refresh_requested = None
        self._refresh_queued = False
        self._refresh_lock = threading.Lock()
        self._capture_lock = threading.RLock()
        self._last_web_source = None
        self._fallback_capture = None
        self._last_match_mode = 'none'

    def _capture_state(self, state):
        # Diagnostic stage codes contain no URL, title, document path or pixels.
        self._last_capture = state

    def start(self):
        if os.name != 'nt':
            self._status = 'unavailable'
            return
        threading.Thread(target=self._work, daemon=True, name='ScreenshotDocumentSource').start()
        threading.Thread(target=self._listen, daemon=True, name='ScreenshotSourceEvents').start()

    def stop(self):
        with self._capture_lock:
            self._stop.set()
            self._status = 'stopped'
            self._pending = None
            self._store.clear()
            self._last_web_source = None
            self._fallback_capture = None
            self._last_match_mode = 'none'
        self._tasks.put(None)
        self._browser_snapshot.clear()
        self._probe.stop()

    def match(self, image, timeout=2):
        windows = self._windows
        with self._capture_lock:
            self._last_match_mode = 'none'
            if self._stop.is_set() or not windows:
                return None
            sequence = windows.u.GetClipboardSequenceNumber()
            fallback_capture = self._fallback_capture
        source = self._match_verified(image, timeout)
        if source:
            with self._capture_lock:
                if (self._stop.is_set() or self._windows is not windows
                        or windows.u.GetClipboardSequenceNumber() != sequence):
                    return None
                webpage = web_reference(source.get('url')) if isinstance(source, dict) else None
                if webpage:
                    self._last_web_source = dict(webpage)
                self._last_match_mode = 'verified'
                self._fallback_capture = None
                return source
        # Explicit unchecked association: this capture's available web URL
        # precedes the previous verified URL. Neither is a verified binding.
        if not self._valid_fallback_image(image):
            return None
        with self._capture_lock:
            if (self._stop.is_set() or self._windows is not windows
                    or windows.u.GetClipboardSequenceNumber() != sequence
                    or self._fallback_capture is not fallback_capture):
                return None
            if fallback_capture:
                candidates = fallback_capture['candidates']
                foreground = fallback_capture['foreground_hwnd']
                ordered = [item for item in candidates if item['hwnd'] == foreground]
                ordered += [item for item in candidates if item['hwnd'] != foreground]
                for candidate in ordered:
                    obtained = candidate.get('source')
                    webpage = (web_reference(obtained.get('url')) if isinstance(obtained, dict) else None)
                    webpage = webpage or web_reference(candidate.get('browser_url'))
                    if webpage:
                        self._last_match_mode = 'current_web'
                        self._capture_state('current_web_source_fallback')
                        return dict(webpage)
            previous = self._last_web_source
            webpage = web_reference(previous.get('url')) if isinstance(previous, dict) else None
            if not webpage:
                return None
            self._last_match_mode = 'previous_web'
            self._capture_state('previous_web_source_fallback')
            return dict(webpage)

    @staticmethod
    def _valid_fallback_image(image):
        if not isinstance(image, str) or len(image) > 32 * 1024 * 1024:
            return False
        formats = {'data:image/png;base64': 'PNG', 'data:image/jpeg;base64': 'JPEG',
                   'data:image/webp;base64': 'WEBP'}
        try:
            header, payload = image.split(',', 1)
            if header not in formats:
                return False
            pixels = base64.b64decode(payload, validate=True)
            with Image.open(io.BytesIO(pixels)) as decoded:
                if (decoded.format != formats[header] or decoded.width <= 0 or decoded.height <= 0
                        or decoded.width * decoded.height > 20_000_000):
                    return False
                decoded.verify()
            # verify() checks containers; loading also rejects truncated data.
            with Image.open(io.BytesIO(pixels)) as decoded:
                decoded.load()
            return True
        except Exception:
            return False

    def _match_verified(self, image, timeout=2):
        windows = self._windows
        if not windows:
            return None
        sequence = windows.u.GetClipboardSequenceNumber()
        deadline = time.monotonic() + timeout
        while not self._stop.is_set():
            if windows.u.GetClipboardSequenceNumber() != sequence:
                return None
            store = self._store
            source = store.match(image, sequence)
            if source:
                with self._capture_lock:
                    return source if (self._store is store and not self._stop.is_set()
                                      and windows.u.GetClipboardSequenceNumber() == sequence) else None
            pending = self._pending
            # Wait only for this observed crop, never for arbitrary pasted images.
            gesture = (pending or {}).get('control_gesture')
            classifying = bool(gesture and gesture['state'] == 'pending')
            small_candidate = self._small_gesture_candidate(pending)
            if (not pending or not (pending.get('selection') or classifying or small_candidate)
                    or not pending.get('overlay')):
                return None
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                return None
            self._stop.wait(min(.025, remaining))

    def clipboard_image_data_url(self):
        """Return the current DIB as an ephemeral PNG for the desktop paste bridge."""
        windows = self._windows
        if not windows:
            return None
        try:
            image = windows.dib_image()
            if image is None:
                return None
            stream = io.BytesIO()
            image.save(stream, format='PNG')
            return 'data:image/png;base64,' + base64.b64encode(stream.getvalue()).decode('ascii')
        except Exception:
            return None

    def status(self):
        state = 'ready' if self._probe_ready and self._listener_ready and not self._stop.is_set() else self._status
        return {'state': state, 'capture': 'WeChat Alt+A / Windows Win+Shift+S', 'lastCapture': self._last_capture,
                'browserReady': self._browser_snapshot.ready,
                'lastAttempt': self._browser_snapshot.last_attempt, 'lastImage': self._last_image_attempt,
                'lastMatchMode': self._last_match_mode}

    def _clipboard_image(self, windows, pending, sequence):
        # Diagnostics hold sequence numbers, counts, durations and stage codes
        # only; no URL, title, path or pixels.
        started = time.monotonic()
        queued_at = pending.get('image_queued_at') if isinstance(pending, dict) else None
        record = {'sequence': sequence, 'polls': 0, 'dib_none': 0, 'dib_reason': None, 'outcome': None,
                  'queue_ms': round((started - queued_at) * 1000, 1) if isinstance(queued_at, float) else None}
        self._last_image_attempt = record

        def finish(outcome, image=None):
            record['outcome'] = outcome
            record['elapsed_ms'] = round((time.monotonic() - started) * 1000, 1)
            try:
                record['end_sequence'] = windows.u.GetClipboardSequenceNumber()
            except Exception:
                pass
            return image

        deadline = started + .3
        while not self._stop.is_set() and self._pending is pending:
            if windows.u.GetClipboardSequenceNumber() != sequence:
                return finish('sequence_changed')
            image = windows.dib_image()
            # Count a poll only after the native read is still associated with
            # the requested sequence. Windows.dib_image also performs an
            # atomic check while decoding; this second check covers a change
            # immediately after that read and prevents stale pixels from
            # entering diagnostics or the binding path.
            if windows.u.GetClipboardSequenceNumber() != sequence:
                return finish('sequence_changed')
            record['polls'] += 1
            if image is not None:
                return finish('image', image)
            record['dib_none'] += 1
            reason = getattr(windows, 'last_dib_reason', None)
            record['dib_reason'] = reason if isinstance(reason, str) else None
            if time.monotonic() >= deadline:
                return finish('deadline')
            # Clipboard ownership/format publication can briefly overlap with
            # other desktop windows reading the same screenshot.
            self._stop.wait(.02)
        return finish('superseded')

    def _requeue_changed_clipboard(self, pending, sequence):
        """Queue a fresh read for a newly published clipboard sequence.

        A capture tool may publish DIB formats in more than one clipboard
        update.  The first read must still reject the old sequence, but a
        sequence change during that read must not discard the later update
        when Windows does not deliver a second notification to this listener.
        Each sequence is queued at most once and the read remains subject to
        the normal per-attempt budget and final sequence check.
        """
        if self._stop.is_set() or self._pending is not pending:
            return
        current = self._windows.u.GetClipboardSequenceNumber()
        if current == sequence:
            return
        queued = pending.setdefault('queued_sequences', set())
        if current in queued:
            return
        queued.add(current)
        pending['sequence'] = current
        pending['image_queued_at'] = time.monotonic()
        self._tasks.put(('image', pending, current))

    def _retry_web_source(self, pending, candidate, sequence):
        """Retry transient UIA failures only for this crop's immutable URL."""
        deadline = time.monotonic() + .6
        for attempt in range(2):
            if attempt:
                if time.monotonic() >= deadline:
                    break
                self._stop.wait(.04)
            if (self._stop.is_set() or self._pending is not pending
                    or self._windows.u.GetClipboardSequenceNumber() != sequence
                    or self._windows.text(candidate['hwnd']) != candidate['title']):
                break
            source = self._probe.read(candidate['hwnd'], candidate['title'], candidate['browser_url'])
            if (isinstance(source, dict) and source.get('url') == candidate['browser_url']
                    and not self._stop.is_set() and self._pending is pending
                    and self._windows.u.GetClipboardSequenceNumber() == sequence
                    and self._windows.text(candidate['hwnd']) == candidate['title']):
                return source
        return None

    def _restore_small_gesture(self, pending, gesture, selection, candidates, image, sequence):
        # No current match is replaced by this fallback. The previous crop is
        # still checked against every frozen source to preserve uniqueness.
        with self._capture_lock:
            if self._small_gesture_candidate(pending) is not gesture or gesture is None:
                return [], selection
            previous = gesture['previous_selection']
        matches = [item for item in candidates if verified_crop(
            pending['screen'], pending['origin'], previous, item['rect'], item['obstructions'], image,
            require_same_pixels=not bool(item.get('browser_url')),
            capture_tool=pending.get('tool', 'wechat'))]
        if len(matches) != 1 or not matches[0].get('browser_url'):
            return [], selection
        with self._capture_lock:
            if (self._small_gesture_candidate(pending) is not gesture
                    or pending.get('selection') != selection
                    or self._windows.u.GetClipboardSequenceNumber() != sequence):
                return [], selection
            pending['selection'] = previous
            if gesture.get('previous_released_at') is not None:
                pending['released_at'] = gesture['previous_released_at']
            gesture['state'] = 'small_restored'
            self._capture_state('small_gesture_source_restored')
        return matches, previous

    def _request_browser_refresh(self):
        foreground = self._windows.u.GetForegroundWindow()
        if foreground == self._last_foreground:
            return
        self._last_foreground = foreground
        if not is_edge(self._windows, foreground):
            return
        # The listener only wakes the existing worker. Never run UIA or wait
        # for its helper in the input/message thread.
        with self._refresh_lock:
            self._refresh_requested = foreground
            if not self._refresh_queued:
                self._refresh_queued = True
                self._tasks.put(('refresh', None, None))

    def _refresh_browser(self, preferred_hwnd=None):
        try:
            self._browser_snapshot.refresh(self._windows, self._probe, preferred_hwnd=preferred_hwnd)
        except Exception:
            self._browser_snapshot.clear()

    def _work(self):
        try:
            self._probe.start()
            self._probe_ready = True
        except Exception:
            self._status = 'unavailable'
        while not self._stop.is_set():
            try:
                task = self._tasks.get(timeout=.25)
            except queue.Empty:
                if self._windows and not self._pending:
                    self._refresh_browser()
                continue
            if task is None:
                break
            kind, pending, sequence = task
            if kind == 'refresh':
                with self._refresh_lock:
                    preferred = self._refresh_requested
                    self._refresh_requested = None
                    self._refresh_queued = False
                if self._windows and not self._pending:
                    self._refresh_browser(preferred)
            elif kind == 'capture_control':
                self._classify_control_gesture(pending, sequence)
            elif kind == 'source':
                candidates = pending.get('candidates', [pending])
                for candidate in candidates:
                    if self._pending is not pending:
                        break
                    if candidate.get('browser_url'):
                        # With several windows, the crop decides which URL
                        # needs verification. Do not queue unrelated UIA reads
                        # ahead of the image task (each can time out).
                        if len(candidates) > 1:
                            continue
                        source = self._probe.read(candidate['hwnd'], candidate['title'], candidate['browser_url'])
                    else:
                        source = self._probe.read(candidate['hwnd'], candidate['title'])
                    # Verify every frozen candidate without changing window focus.
                    if self._pending is pending:
                        candidate['source'] = source
                if self._pending is pending and not any(
                        item.get('source') or item.get('browser_url') for item in candidates):
                    self._capture_state('source_unavailable')
            elif kind == 'image':
                try:
                    time.sleep(.08)  # Let the capture tool finish publishing DIB formats.
                    if self._stop.is_set() or self._pending is not pending:
                        continue
                    windows = self._windows
                    if windows.u.GetClipboardSequenceNumber() != sequence:
                        self._requeue_changed_clipboard(pending, sequence)
                        continue
                    image = self._clipboard_image(windows, pending, sequence)
                    if self._stop.is_set() or self._pending is not pending:
                        continue
                    attempt = self._last_image_attempt or {}
                    requeued = attempt.get('outcome') == 'sequence_changed'
                    if requeued:
                        # Do not reuse the old image or source binding. Read
                        # the new clipboard sequence independently.
                        self._requeue_changed_clipboard(pending, sequence)
                    if requeued:
                        continue
                    selection = pending.get('selection')
                    gesture = pending.get('control_gesture')
                    blocked = bool(gesture and gesture['state'] in ('left', 'stale', 'oversized'))
                    if blocked or (not selection and not self._small_gesture_candidate(pending)):
                        with self._capture_lock:
                            if self._pending is pending:
                                self._capture_state('clipboard_without_selection')
                                self._pending = None
                        continue
                    candidates = pending.get('candidates', [pending])
                    if not any(item.get('source') or item.get('browser_url') for item in candidates):
                        self._capture_state('source_unavailable')
                    elif not image:
                        self._capture_state('clipboard_image_unavailable')
                    else:
                        matches = [item for item in candidates if selection and verified_crop(
                            pending['screen'], pending['origin'], selection, item['rect'],
                            item['obstructions'], image,
                            require_same_pixels=not bool(item.get('browser_url')),
                            capture_tool=pending.get('tool', 'wechat'))]
                        if not matches:
                            matches, selection = self._restore_small_gesture(
                                pending, gesture, selection, candidates, image, sequence)
                        if len(matches) != 1:
                            self._capture_state('crop_unverified' if selection else 'clipboard_without_selection')
                        else:
                            selected = matches[0]
                            if not selected.get('source') and selected.get('browser_url'):
                                selected['source'] = self._retry_web_source(pending, selected, sequence)
                            if self._stop.is_set() or self._pending is not pending:
                                continue
                            if not selected.get('source'):
                                self._capture_state('source_unavailable')
                            else:
                                # Fingerprinting can process a large image.
                                # Prepare off the input lock, then commit only
                                # if this exact gesture/capture is still live.
                                prepared_store = SourceStore()
                                prepared_store.bind(image, selected['source'], sequence)
                                with self._capture_lock:
                                    if (not self._stop.is_set() and self._pending is pending
                                            and pending.get('selection') == selection
                                            and pending.get('control_gesture') is gesture
                                            and not (gesture and gesture['state'] in ('pending', 'left', 'stale', 'oversized'))
                                            and not (gesture and gesture['state'] == 'small_restored'
                                                     and self._small_gesture_candidate(pending) is not gesture)
                                            and windows.u.GetClipboardSequenceNumber() == sequence):
                                        self._store = prepared_store
                                        webpage = web_reference(selected['source'].get('url'))
                                        if webpage:
                                            self._last_web_source = dict(webpage)
                                        self._fallback_capture = None
                                        self._capture_state('bound')
                    with self._capture_lock:
                        if self._pending is pending and pending.get('sequence') == sequence:
                            self._pending = None
                except Exception:
                    self._capture_state('capture_error')

    def _begin(self, hwnd, tool='wechat'):
        with self._capture_lock:
            self._begin_locked(hwnd, tool)

    def _begin_locked(self, hwnd, tool='wechat'):
        self._pending = None
        self._fallback_capture = None
        self._store.clear()
        windows = self._windows
        cls, title = windows.text(hwnd, True), windows.text(hwnd)
        lower = title.lower()
        candidates = self._browser_snapshot.freeze(windows)
        known = {item['hwnd'] for item in candidates}
        cached = self._browser_snapshot.fallback_candidates(windows)
        self._fallback_capture = {'foreground_hwnd': hwnd,
                                  'candidates': candidates + [item for item in cached if item['hwnd'] not in known]}
        self._capture_state('unsupported_window')
        if is_edge(windows, hwnd):
            if not candidates:
                self._capture_state('browser_not_ready')
                return
        elif cls == 'Photoshop':
            candidates.append({'hwnd': hwnd, 'title': title})
        elif lower.endswith(' - wps office') and ('.pdf' in lower or '.ppt' in lower):
            exe = ntpath.basename(windows.process(hwnd)[1]).lower()
            if exe in ('wps.exe', 'wpspdf.exe', 'kpdf.exe', 'wpp.exe'):
                candidates.append({'hwnd': hwnd, 'title': title})
        if not candidates:
            return
        for candidate in candidates:
            candidate.update(rect=windows.rect(candidate['hwnd']),
                             obstructions=windows.obstructions(candidate['hwnd'], capture_tool=tool), source=None)
        candidates = [item for item in candidates if item['rect']]
        if not candidates:
            return
        origin = (windows.u.GetSystemMetrics(76), windows.u.GetSystemMetrics(77))
        if all(item.get('browser_url') for item in candidates):
            # Web crops verify geometry against the physical desktop, not its
            # old pixels. Avoid a full-screen grab inside the keyboard hook.
            width, height = windows.u.GetSystemMetrics(78), windows.u.GetSystemMetrics(79)
            if width <= 0 or height <= 0:
                self._capture_state('screen_unavailable')
                return
            screen = SimpleNamespace(width=width, height=height)
        else:
            # Local document crops still require the original screen pixels.
            screen = ImageGrab.grab(all_screens=True)
        primary = next((item for item in candidates if item['hwnd'] == hwnd), candidates[0])
        pending = {**primary, 'foreground_hwnd': hwnd, 'candidates': candidates,
                   'screen': screen,
                   'origin': origin,
                   'time': time.monotonic(), 'tool': tool}
        self._pending = pending
        self._capture_state('observing')
        self._tasks.put(('source', pending, None))

    def _listen(self):
        from desktop.source_win32 import Windows, WindowClass, PROC, HOOK, Key, Mouse
        self._windows = windows = Windows(); u = windows.u
        u.SetThreadDpiAwarenessContext.argtypes = [c.c_void_p]
        u.SetThreadDpiAwarenessContext.restype = c.c_void_p
        u.SetThreadDpiAwarenessContext(c.c_void_p(-4))
        @PROC
        def procedure(hwnd, message, wp, lp):
            if message == 0x031D:
                self._clipboard_changed()
                return 0
            if message == 0x0113:
                if self._stop.is_set(): u.PostQuitMessage(0)
                else: self._check_capture()
                return 0
            return u.DefWindowProcW(hwnd, message, wp, lp)
        @HOOK
        def keyboard(code, wp, lp):
            if code >= 0 and wp in (0x100, 0x104):
                key = c.cast(lp, c.POINTER(Key)).contents
                self._key_event(key.code, key.flags)
            return u.CallNextHookEx(None, code, wp, lp)
        @HOOK
        def mouse(code, wp, lp):
            if code >= 0 and self._pending:
                point = c.cast(lp, c.POINTER(Mouse)).contents.point
                self._mouse_event(wp, point.x, point.y)
            return u.CallNextHookEx(None, code, wp, lp)
        hooks, hwnd = [], None
        try:
            instance = windows.k.GetModuleHandleW(None)
            name = 'DropItScreenshotSource' + str(id(self))
            wc = WindowClass(proc=procedure, instance=instance, name=name)
            if not u.RegisterClassW(c.byref(wc)): raise c.WinError(c.get_last_error())
            hwnd = u.CreateWindowExW(0, name, '', 0, 0, 0, 0, 0, w.HWND(-3), None, instance, None)
            if not hwnd or not u.AddClipboardFormatListener(hwnd): raise c.WinError(c.get_last_error())
            for kind, callback in ((13, keyboard), (14, mouse)):
                handle = u.SetWindowsHookExW(kind, callback, instance, 0)
                if not handle: raise c.WinError(c.get_last_error())
                hooks.append(handle)
            u.SetTimer(hwnd, 1, 80, None)
            self._listener_ready = True
            msg = w.MSG()
            while u.GetMessageW(c.byref(msg), None, 0, 0) > 0:
                u.TranslateMessage(c.byref(msg)); u.DispatchMessageW(c.byref(msg))
        except Exception:
            self._status = 'unavailable'
        finally:
            self._listener_ready = False
            for handle in hooks: u.UnhookWindowsHookEx(handle)
            if hwnd: u.RemoveClipboardFormatListener(hwnd); u.DestroyWindow(hwnd)
            self._pending = None
