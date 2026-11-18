"""Passive hotkeys and crop lifecycle for WeChat and Windows screen snipping."""
import ntpath
import math
import time


def capture_hotkey(code, flags, is_down):
    if code not in (0x41, 0x53):
        return None
    ctrl = is_down(0x11)
    win = is_down(0x5B) or is_down(0x5C)
    shift = is_down(0x10)
    alt = bool(flags & 0x20)
    if code == 0x41 and alt and not (ctrl or win or shift):
        return 'wechat'
    if code == 0x53 and win and shift and not (ctrl or alt):
        return 'windows'
    return None


def capture_overlay(windows, hwnd, tool):
    cls = windows.text(hwnd, True)
    if tool == 'wechat' and cls == 'Qt51514QWindowIcon':
        return _weixin_qt_capture(windows, hwnd)
    if tool == 'windows':
        # Win10's ScreenClippingHost and Win11's SnippingTool capture surface.
        # The editor itself (ApplicationFrameWindow/WinUI) is not an overlay.
        names = {
            'Windows.UI.Core.CoreWindow': {'screenclippinghost.exe'},
            'Microsoft-Windows-SnipperCaptureForm': {'snippingtool.exe'},
        }.get(cls, set())
    else:
        names = {'wechat.exe', 'weixin.exe'} if cls in ('SnapshotWnd', 'CToolBarWnd') else set()
    return bool(names and ntpath.basename(windows.process(hwnd)[1]).lower() in names)


def _weixin_qt_capture(windows, hwnd):
    # Qt is shared by chat, calls and capture. Only the observed full-screen,
    # captionless topmost popup is a capture surface; every other Qt window
    # remains an obstruction and cannot anchor a screenshot selection.
    try:
        if (ntpath.basename(windows.process(hwnd)[1]).lower() != 'weixin.exe'
                or windows.text(hwnd) != 'Weixin'):
            return False
        styles = windows.styles(hwnd)
        if styles is None:
            return False
        style, extended = styles
        if ((style & 0x90000000) != 0x90000000  # WS_POPUP | WS_VISIBLE
                or style & 0x60c40000  # WS_CHILD | WS_MINIMIZE | WS_CAPTION | WS_THICKFRAME
                or not extended & 0x8):  # WS_EX_TOPMOST
            return False
        rect = windows.rect(hwnd)
        if not rect or rect[2] <= rect[0] or rect[3] <= rect[1]:
            return False
        u = windows.u
        x, y = u.GetSystemMetrics(76), u.GetSystemMetrics(77)
        width, height = u.GetSystemMetrics(78), u.GetSystemMetrics(79)
        if width > 0 and height > 0 and rect == (x, y, x + width, y + height):
            return True
        return rect == windows.monitor_rect(hwnd)
    except Exception:
        return False


class ScreenshotEvents:
    def _overlay(self, hwnd):
        tool = (self._pending or {}).get('tool', 'wechat')
        return capture_overlay(self._windows, hwnd, tool)

    def _key_event(self, code, flags):
        with self._capture_lock:
            self._key_event_locked(code, flags)

    def _key_event_locked(self, code, flags):
        if code == 0x1B:
            if self._pending:
                self._capture_state('cancelled')
            self._pending = None
            return
        u = self._windows.u
        tool = capture_hotkey(code, flags, lambda vk: bool(u.GetAsyncKeyState(vk) & 0x8000))
        if tool:
            try:
                self._begin(u.GetForegroundWindow(), tool)
            except Exception:
                self._capture_state('capture_error')
                self._pending = None

    def _mouse_event(self, message, x, y):
        with self._capture_lock:
            self._mouse_event_locked(message, x, y)

    @staticmethod
    def _button_path_inside(gesture):
        bounds, path = gesture.get('button_bounds'), gesture['path']
        return bool(bounds and bounds[0] <= path[0] <= path[2] < bounds[2]
                    and bounds[1] <= path[1] <= path[3] < bounds[3])

    def _small_gesture_candidate(self, pending):
        """The user's bounded fallback belongs only to this capture/gesture."""
        gesture = (pending or {}).get('control_gesture')
        if (self._stop.is_set() or self._pending is not pending or not pending
                or pending.get('tool', 'wechat') != 'wechat' or not pending.get('overlay')
                or not gesture or not gesture.get('previous_selection')
                or gesture['state'] in ('stale', 'left', 'oversized')
                or time.monotonic() - pending.get('time', time.monotonic()) > 30):
            return None
        left, top, right, bottom = gesture['path']
        return gesture if 0 <= right - left <= 20 and 0 <= bottom - top <= 20 else None

    def _track_control_gesture(self, pending, x, y):
        gesture = pending.get('control_gesture')
        if not gesture or gesture.get('released'):
            return
        left, top, right, bottom = gesture['path']
        gesture['path'] = (min(left, x), min(top, y), max(right, x), max(bottom, y))
        point = gesture['point']
        if abs(x - point[0]) > 5 or abs(y - point[1]) > 5:
            gesture['moved'] = True
        if gesture['state'] == 'button' and not self._button_path_inside(gesture):
            gesture['state'] = 'left'
            pending.pop('selection', None)
            pending.pop('released_at', None)
            self._capture_state('capture_button_left')
        elif gesture['state'] == 'small_restored' and not self._small_gesture_candidate(pending):
            gesture['state'] = 'oversized'
            pending.pop('selection', None)
            pending.pop('released_at', None)
            self._capture_state('small_gesture_oversized')

    def _classify_control_gesture(self, pending, gesture):
        if (self._stop.is_set() or self._pending is not pending
                or pending.get('control_gesture') is not gesture
                or gesture['state'] != 'pending'
                or time.monotonic() - pending.get('time', time.monotonic()) > 30):
            return
        try:
            bounds = self._probe.capture_control(gesture['hwnd'], *gesture['point'])
            valid = (isinstance(bounds, (tuple, list)) and len(bounds) == 4
                     and all(isinstance(value, (int, float)) and math.isfinite(value) for value in bounds)
                     and bounds[0] < bounds[2] and bounds[1] < bounds[3])
        except Exception:
            bounds, valid = None, False
        with self._capture_lock:
            if (self._stop.is_set() or self._pending is not pending
                    or pending.get('control_gesture') is not gesture
                    or gesture['state'] != 'pending'
                    or time.monotonic() - pending.get('time', time.monotonic()) > 30):
                return
            expected = gesture.get('publication_sequence', gesture['down_sequence'])
            if self._windows.u.GetClipboardSequenceNumber() != expected:
                gesture['state'] = 'stale'
                pending.pop('selection', None)
                pending.pop('released_at', None)
                return
            if not valid:
                gesture['state'] = 'unverified'
                self._capture_state('capture_control_unverified')
                return
            gesture['button_bounds'] = tuple(bounds)
            if not self._button_path_inside(gesture):
                gesture['state'] = 'left'
                pending.pop('selection', None)
                pending.pop('released_at', None)
                self._capture_state('capture_button_left')
                return
            gesture['state'] = 'button'
            pending['selection'] = gesture['previous_selection']
            if gesture.get('previous_released_at') is not None:
                pending['released_at'] = gesture['previous_released_at']
            self._capture_state('capture_button_preserved')

    def _mouse_event_locked(self, message, x, y):
        if message not in (0x200, 0x201, 0x202):
            return
        pending = self._pending
        if not pending:
            return
        gesture = pending.get('control_gesture')
        if pending.get('completed'):
            # Clipboard publication can precede button mouse-up. Keep tracking
            # that gesture so delayed classification cannot hide an excursion.
            if message in (0x200, 0x202):
                self._track_control_gesture(pending, x, y)
                down = pending.get('down')
                if (gesture and gesture['state'] not in ('button', 'small_restored') and down
                        and (abs(x - down[0]) > 5 or abs(y - down[1]) > 5)):
                    pending.pop('selection', None)
                    pending.pop('released_at', None)
                if message == 0x202 and gesture:
                    gesture['released'] = True
                    pending.pop('down', None)
            elif message == 0x201 and gesture:
                pending.pop('control_gesture', None)
                pending.pop('selection', None)
                pending.pop('released_at', None)
            return
        if message in (0x200, 0x202):
            self._track_control_gesture(pending, x, y)
        if message == 0x200:
            down = pending.get('down')
            if (down and (abs(x - down[0]) > 5 or abs(y - down[1]) > 5)
                    and not (gesture and gesture['state'] in ('button', 'small_restored'))):
                # Invalidate the old crop once another drag actually starts.
                # A completion click can publish pixels before mouse-up.
                pending.pop('selection', None)
                pending.pop('released_at', None)
            return
        foreground = self._windows.u.GetForegroundWindow()
        on_overlay = self._overlay(foreground)
        target = foreground
        if message == 0x201 and not on_overlay:
            # A low-level mouse hook runs before this click activates its
            # target. The first drag can already hit the capture surface
            # while GetForegroundWindow still reports the previous app.
            target = self._windows.window_at_point(x, y)
            on_overlay = bool(target and self._overlay(target))
        if on_overlay:
            pending['overlay'] = True
        if message == 0x201 and on_overlay:
            # WeChat's completion button is on the same capture overlay. Keep
            # the finished crop through a click; replace it only after a real
            # second drag, rather than clearing it on the button's mouse-down.
            previous = pending.get('selection')
            if gesture and gesture['state'] == 'pending' and gesture.get('moved'):
                # An unclassified rectangle is provisional and must never
                # become another gesture's fallback selection.
                previous = None
                pending.pop('selection', None)
                pending.pop('released_at', None)
            pending.pop('control_gesture', None)
            pending['down'] = (x, y)
            if previous and pending.get('tool', 'wechat') == 'wechat':
                gesture = {'state': 'pending', 'hwnd': target, 'point': (x, y),
                           'path': (x, y, x, y), 'moved': False, 'previous_selection': previous,
                           'previous_released_at': pending.get('released_at'),
                           'down_sequence': self._windows.u.GetClipboardSequenceNumber()}
                pending['control_gesture'] = gesture
                self._tasks.put(('capture_control', pending, gesture))
        elif message == 0x202 and pending.get('down'):
            x1, y1 = pending.pop('down')
            if gesture:
                gesture['released'] = True
                if gesture['state'] in ('button', 'left', 'stale', 'small_restored', 'oversized'):
                    return
            # The system overlay can close in the same turn as mouse-up. Its
            # verified mouse-down still anchors this release to the capture.
            if not on_overlay and pending.get('tool') != 'windows':
                return
            if abs(x - x1) > 5 and abs(y - y1) > 5:
                pending['selection'] = (min(x1, x), min(y1, y), max(x1, x), max(y1, y))
                pending['released_at'] = time.monotonic()
                self._capture_state('selected')

    def _clipboard_changed(self):
        with self._capture_lock:
            self._clipboard_changed_locked()

    def _clipboard_changed_locked(self):
        sequence = self._windows.u.GetClipboardSequenceNumber()
        if sequence == self._last_clipboard_sequence:
            # WM_CLIPBOARDUPDATE is a notification, not a new capture ID.
            # A duplicate can arrive after the worker has already bound it.
            return
        self._last_clipboard_sequence = sequence
        self._store.clear()
        pending = self._pending
        gesture = (pending or {}).get('control_gesture')
        classifying = bool(gesture and gesture['state'] == 'pending')
        small_candidate = self._small_gesture_candidate(pending)
        if pending and (pending.get('selection') or classifying or small_candidate) and pending.get('overlay'):
            if gesture:
                # Only this first publication may wait for control identity.
                # A subsequent sequence must not revive its saved rectangle.
                if (gesture['state'] == 'pending' and 'publication_sequence' in gesture
                        and gesture['publication_sequence'] != sequence):
                    gesture['state'] = 'stale'
                    pending.pop('selection', None)
                    self._capture_state('clipboard_without_selection')
                    self._pending = None
                    return
                gesture['publication_sequence'] = sequence
            pending['completed'] = True
            pending['sequence'] = sequence
            pending.setdefault('queued_sequences', set()).add(sequence)
            pending['image_queued_at'] = time.monotonic()
            self._tasks.put(('image', pending, sequence))
        else:
            if pending:
                self._capture_state('clipboard_without_selection')
            self._pending = None

    def _check_capture(self):
        with self._capture_lock:
            self._check_capture_locked()

    def _check_capture_locked(self):
        pending = self._pending
        if not pending:
            self._request_browser_refresh()
            return
        u = self._windows.u
        foreground = u.GetForegroundWindow()
        now = time.monotonic()
        if now - pending['time'] > 30:
            self._capture_state('expired')
            self._pending = None
        elif self._overlay(foreground):
            pending['overlay'] = True
        elif pending.get('overlay') and not pending.get('completed'):
            # Windows closes the overlay before publishing clipboard pixels.
            # Keep only a finished drag alive for this short hand-off; Esc,
            # no selection and expiry still discard the pending reference.
            released = pending.get('released_at')
            if pending.get('tool') == 'windows' and released is not None:
                if now - released <= 1:
                    return
                self._capture_state('clipboard_timeout')
                self._pending = None
            elif foreground not in {pending['hwnd'], pending.get('foreground_hwnd', pending['hwnd']),
                                    *(item['hwnd'] for item in pending.get('candidates', []))}:
                self._capture_state('source_window_lost')
                self._pending = None
