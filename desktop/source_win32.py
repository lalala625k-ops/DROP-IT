"""Pointer-safe Windows primitives for the passive screenshot observer."""
import ctypes as c
import io
import struct
from ctypes import wintypes as w
from PIL import Image

RESULT = c.c_ssize_t
PROC = c.WINFUNCTYPE(RESULT, w.HWND, w.UINT, w.WPARAM, w.LPARAM)
HOOK = c.WINFUNCTYPE(RESULT, c.c_int, w.WPARAM, w.LPARAM)
ENUM = c.WINFUNCTYPE(w.BOOL, w.HWND, w.LPARAM)


class WindowClass(c.Structure):
    _fields_ = [('style', w.UINT), ('proc', PROC), ('cls_extra', c.c_int), ('wnd_extra', c.c_int),
               ('instance', w.HINSTANCE), ('icon', w.HICON), ('cursor', w.HANDLE), ('brush', w.HBRUSH),
               ('menu', w.LPCWSTR), ('name', w.LPCWSTR)]


class Key(c.Structure):
    _fields_ = [('code', w.DWORD), ('scan', w.DWORD), ('flags', w.DWORD), ('time', w.DWORD), ('extra', c.c_size_t)]


class Mouse(c.Structure):
    _fields_ = [('point', w.POINT), ('data', w.DWORD), ('flags', w.DWORD), ('time', w.DWORD), ('extra', c.c_size_t)]


class MonitorInfo(c.Structure):
    _fields_ = [('size', w.DWORD), ('monitor', w.RECT), ('work', w.RECT), ('flags', w.DWORD)]


class Windows:
    def __init__(self):
        self.u, self.k = c.WinDLL('user32', use_last_error=True), c.WinDLL('kernel32', use_last_error=True)
        declarations = [
            ('GetForegroundWindow', [], w.HWND), ('GetClipboardSequenceNumber', [], w.DWORD),
            ('WindowFromPoint', [w.POINT], w.HWND), ('GetAncestor', [w.HWND, w.UINT], w.HWND),
            ('IsIconic', [w.HWND], w.BOOL),
            ('MonitorFromWindow', [w.HWND, w.DWORD], w.HANDLE),
            ('GetMonitorInfoW', [w.HANDLE, c.POINTER(MonitorInfo)], w.BOOL),
            ('GetAsyncKeyState', [c.c_int], c.c_short),
            ('GetWindowTextW', [w.HWND, w.LPWSTR, c.c_int], c.c_int),
            ('GetClassNameW', [w.HWND, w.LPWSTR, c.c_int], c.c_int),
            ('GetWindowThreadProcessId', [w.HWND, c.POINTER(w.DWORD)], w.DWORD),
            ('GetWindowRect', [w.HWND, c.POINTER(w.RECT)], w.BOOL), ('IsWindowVisible', [w.HWND], w.BOOL),
            ('SetWindowsHookExW', [c.c_int, HOOK, w.HINSTANCE, w.DWORD], w.HANDLE),
            ('CallNextHookEx', [w.HANDLE, c.c_int, w.WPARAM, w.LPARAM], RESULT),
            ('UnhookWindowsHookEx', [w.HANDLE], w.BOOL),
            ('DefWindowProcW', [w.HWND, w.UINT, w.WPARAM, w.LPARAM], RESULT),
            ('RegisterClassW', [c.POINTER(WindowClass)], w.WORD),
            ('CreateWindowExW', [w.DWORD, w.LPCWSTR, w.LPCWSTR, w.DWORD, c.c_int, c.c_int, c.c_int, c.c_int,
                                  w.HWND, w.HMENU, w.HINSTANCE, c.c_void_p], w.HWND),
            ('AddClipboardFormatListener', [w.HWND], w.BOOL),
            ('RemoveClipboardFormatListener', [w.HWND], w.BOOL), ('DestroyWindow', [w.HWND], w.BOOL),
            ('SetTimer', [w.HWND, c.c_size_t, w.UINT, c.c_void_p], c.c_size_t),
            ('GetMessageW', [c.POINTER(w.MSG), w.HWND, w.UINT, w.UINT], w.BOOL),
            ('OpenClipboard', [w.HWND], w.BOOL), ('CloseClipboard', [], w.BOOL),
            ('GetClipboardData', [w.UINT], w.HANDLE), ('IsClipboardFormatAvailable', [w.UINT], w.BOOL),
            ('EnumClipboardFormats', [w.UINT], w.UINT),
        ]
        for name, args, result in declarations:
            fn = getattr(self.u, name); fn.argtypes = args; fn.restype = result
        window_long = self.u.GetWindowLongPtrW if c.sizeof(c.c_void_p) == 8 else self.u.GetWindowLongW
        window_long.argtypes = [w.HWND, c.c_int]
        window_long.restype = c.c_ssize_t
        for name, args, result in [
            ('GetModuleHandleW', [w.LPCWSTR], w.HINSTANCE),
            ('GlobalSize', [w.HGLOBAL], c.c_size_t), ('GlobalLock', [w.HGLOBAL], c.c_void_p),
            ('GlobalUnlock', [w.HGLOBAL], w.BOOL),
            ('OpenProcess', [w.DWORD, w.BOOL, w.DWORD], w.HANDLE),
            ('QueryFullProcessImageNameW', [w.HANDLE, w.DWORD, w.LPWSTR, c.POINTER(w.DWORD)], w.BOOL),
            ('CloseHandle', [w.HANDLE], w.BOOL),
        ]:
            fn = getattr(self.k, name); fn.argtypes = args; fn.restype = result

    def text(self, hwnd, class_name=False):
        value = c.create_unicode_buffer(512)
        (self.u.GetClassNameW if class_name else self.u.GetWindowTextW)(hwnd, value, 512)
        return value.value

    def process(self, hwnd):
        pid = w.DWORD(); self.u.GetWindowThreadProcessId(hwnd, c.byref(pid))
        handle = self.k.OpenProcess(0x1000, False, pid.value)
        if not handle:
            return pid.value, ''
        try:
            value, size = c.create_unicode_buffer(32768), w.DWORD(32768)
            self.k.QueryFullProcessImageNameW(handle, 0, value, c.byref(size))
            return pid.value, value.value
        finally:
            self.k.CloseHandle(handle)

    def rect(self, hwnd):
        value = w.RECT()
        if not self.u.GetWindowRect(hwnd, c.byref(value)):
            return None
        return value.left, value.top, value.right, value.bottom

    def styles(self, hwnd):
        getter = self.u.GetWindowLongPtrW if c.sizeof(c.c_void_p) == 8 else self.u.GetWindowLongW
        values = []
        for index in (-16, -20):  # GWL_STYLE, GWL_EXSTYLE
            c.set_last_error(0)
            value = getter(hwnd, index)
            if value == 0 and c.get_last_error():
                return None
            values.append(int(value) & 0xffffffff)
        return tuple(values)

    def monitor_rect(self, hwnd):
        # MONITOR_DEFAULTTONULL: a detached window cannot borrow the nearest
        # monitor as evidence. No display enumeration is needed per event.
        handle = self.u.MonitorFromWindow(hwnd, 0)
        if not handle:
            return None
        info = MonitorInfo(size=c.sizeof(MonitorInfo))
        if not self.u.GetMonitorInfoW(handle, c.byref(info)):
            return None
        value = info.monitor
        return value.left, value.top, value.right, value.bottom

    def window_at_point(self, x, y):
        hwnd = self.u.WindowFromPoint(w.POINT(x, y))
        return (self.u.GetAncestor(hwnd, 2) or hwnd) if hwnd else None

    def visible_windows(self):
        result = []
        dwm = c.WinDLL('dwmapi').DwmGetWindowAttribute
        dwm.argtypes = [w.HWND, w.DWORD, c.c_void_p, w.DWORD]
        dwm.restype = c.c_long
        @ENUM
        def collect(hwnd, _):
            if self.u.IsWindowVisible(hwnd) and not self.u.IsIconic(hwnd):
                cloaked = w.DWORD()
                if dwm(hwnd, 14, c.byref(cloaked), c.sizeof(cloaked)) == 0 and cloaked.value:
                    return True
                rect = self.rect(hwnd)
                if rect and rect[2] > rect[0] and rect[3] > rect[1]:
                    result.append(hwnd)
            return True
        self.u.EnumWindows(collect, 0)
        return result

    def obstructions(self, source, capture_tool=None):
        from desktop.screenshot_events import capture_overlay
        result = []
        @ENUM
        def collect(hwnd, _):
            if hwnd == source:
                return False
            if self.u.IsWindowVisible(hwnd):
                if capture_tool and capture_overlay(self, hwnd, capture_tool):
                    return True
                rect = self.rect(hwnd)
                if rect:
                    result.append(rect)
            return True
        self.u.EnumWindows(collect, 0)
        return result

    def dib_image(self):
        # Read DIB bytes without touching CF_BITMAP or writing the clipboard.
        self.last_dib_reason = 'clipboard_busy'
        if not self.u.OpenClipboard(None):
            return None
        try:
            sequence = self.u.GetClipboardSequenceNumber()
            format_id = 0
            # EnumClipboardFormats yields published formats followed by their
            # possible conversions. Prefer the first supported DIB instead of
            # requesting a later synthesized CF_DIBV5 just because it is available.
            while True:
                format_id = self.u.EnumClipboardFormats(format_id)
                if not format_id:
                    self.last_dib_reason = 'no_dib_format'
                    return None
                if format_id in (8, 17):  # CF_DIB, CF_DIBV5
                    break
            handle = self.u.GetClipboardData(format_id)
            size = self.k.GlobalSize(handle) if handle else 0
            if not 40 <= size <= 80 * 1024 * 1024:
                self.last_dib_reason = 'size_out_of_range'
                return None
            pointer = self.k.GlobalLock(handle)
            if not pointer:
                self.last_dib_reason = 'lock_failed'
                return None
            try:
                data = c.string_at(pointer, size)
            finally:
                self.k.GlobalUnlock(handle)
        finally:
            self.u.CloseClipboard()
        # Delayed rendering can change the sequence during a read. That image
        # cannot be returned as if it belonged to the original clipboard state.
        if self.u.GetClipboardSequenceNumber() != sequence:
            self.last_dib_reason = 'sequence_changed_during_read'
            return None
        header, bits, compression, colors = struct.unpack_from('<I', data)[0], struct.unpack_from('<H', data, 14)[0], struct.unpack_from('<I', data, 16)[0], struct.unpack_from('<I', data, 32)[0]
        offset = header + (12 if header == 40 and compression == 3 else 0) + (colors or (1 << bits if bits <= 8 else 0)) * 4
        bmp = struct.pack('<2sIHHI', b'BM', len(data) + 14, 0, 0, offset + 14) + data
        with Image.open(io.BytesIO(bmp)) as image:
            if image.width * image.height > 20_000_000:
                self.last_dib_reason = 'image_too_large'
                return None
            result = image.convert('RGB')
        if self.u.GetClipboardSequenceNumber() != sequence:
            self.last_dib_reason = 'sequence_changed_after_decode'
            return None
        self.last_dib_reason = 'ok'
        return result
