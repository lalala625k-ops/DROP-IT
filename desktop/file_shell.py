"""Windows associated file icons and Explorer selection, without opening documents."""
import base64
import ctypes
import io
import sys
from contextlib import contextmanager
from ctypes import wintypes

from PIL import Image


class _SHFILEINFO(ctypes.Structure):
    _fields_ = [('hIcon', wintypes.HICON), ('iIcon', ctypes.c_int),
                ('dwAttributes', wintypes.DWORD), ('szDisplayName', wintypes.WCHAR * 260),
                ('szTypeName', wintypes.WCHAR * 80)]


class _BITMAPINFOHEADER(ctypes.Structure):
    _fields_ = [('biSize', wintypes.DWORD), ('biWidth', wintypes.LONG), ('biHeight', wintypes.LONG),
                ('biPlanes', wintypes.WORD), ('biBitCount', wintypes.WORD),
                ('biCompression', wintypes.DWORD), ('biSizeImage', wintypes.DWORD),
                ('biXPelsPerMeter', wintypes.LONG), ('biYPelsPerMeter', wintypes.LONG),
                ('biClrUsed', wintypes.DWORD), ('biClrImportant', wintypes.DWORD)]


@contextmanager
def _shell_com():
    if sys.platform != 'win32':
        raise OSError('仅 Windows 桌面版支持本地文件操作')
    ole = ctypes.OleDLL('ole32')
    ole.CoInitialize.argtypes = [ctypes.c_void_p]
    ole.CoInitialize.restype = ctypes.c_long
    # pywebview may already have initialized this thread in another COM mode.
    try:
        result = ole.CoInitialize(None)
    except OSError as error:
        if getattr(error, 'winerror', None) != -2147417850:  # RPC_E_CHANGED_MODE
            raise
        result = -2147417850
    try:
        yield
    finally:
        if result in (0, 1):
            ole.CoUninitialize()


def reveal_file(path):
    """Select an absolute, prevalidated file in Explorer using a shell item ID."""
    with _shell_com():
        shell = ctypes.OleDLL('shell32')
        parse = shell.SHParseDisplayName
        parse.argtypes = [wintypes.LPCWSTR, ctypes.c_void_p, ctypes.POINTER(ctypes.c_void_p),
                          wintypes.DWORD, ctypes.c_void_p]
        parse.restype = ctypes.c_long
        show = shell.SHOpenFolderAndSelectItems
        show.argtypes = [ctypes.c_void_p, wintypes.UINT, ctypes.c_void_p, wintypes.DWORD]
        show.restype = ctypes.c_long
        free = ctypes.windll.ole32.CoTaskMemFree
        free.argtypes = [ctypes.c_void_p]
        item = ctypes.c_void_p()
        try:
            parse(path, None, ctypes.byref(item), 0, None)
            if not item:
                raise OSError('无法定位原文件，请重新关联')
            show(item, 0, None, 0)
        finally:
            if item:
                free(item)


def _icon_image(icon, size=64):
    """Draw against two backgrounds to preserve both modern alpha and legacy masks."""
    gdi, user = ctypes.windll.gdi32, ctypes.windll.user32
    gdi.CreateCompatibleDC.argtypes = [ctypes.c_void_p]
    gdi.CreateCompatibleDC.restype = ctypes.c_void_p
    gdi.CreateDIBSection.argtypes = [ctypes.c_void_p, ctypes.c_void_p, wintypes.UINT,
                                   ctypes.POINTER(ctypes.c_void_p), ctypes.c_void_p, wintypes.DWORD]
    gdi.CreateDIBSection.restype = ctypes.c_void_p
    gdi.SelectObject.argtypes = [ctypes.c_void_p, ctypes.c_void_p]
    gdi.SelectObject.restype = ctypes.c_void_p
    gdi.DeleteObject.argtypes = [ctypes.c_void_p]
    gdi.DeleteDC.argtypes = [ctypes.c_void_p]
    user.DrawIconEx.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_int, wintypes.HICON,
                               ctypes.c_int, ctypes.c_int, wintypes.UINT, ctypes.c_void_p, wintypes.UINT]
    dc, bitmap, previous = gdi.CreateCompatibleDC(None), None, None
    if not dc:
        raise OSError('无法读取系统文件图标')
    try:
        header = _BITMAPINFOHEADER(ctypes.sizeof(_BITMAPINFOHEADER), size, -size, 1, 32)
        bits = ctypes.c_void_p()
        bitmap = gdi.CreateDIBSection(dc, ctypes.byref(header), 0, ctypes.byref(bits), None, 0)
        if not bitmap or not bits:
            raise OSError('无法读取系统文件图标')
        previous = gdi.SelectObject(dc, bitmap)
        backgrounds = []
        for background in (0, 255):
            ctypes.memset(bits, background, size * size * 4)
            if not user.DrawIconEx(dc, 0, 0, icon, size, size, 0, None, 3):  # DI_NORMAL
                raise OSError('无法读取系统文件图标')
            gdi.GdiFlush()
            backgrounds.append(ctypes.string_at(bits, size * size * 4))
        black, white = backgrounds
        rgba = bytearray(size * size * 4)
        for offset in range(0, len(rgba), 4):
            alpha = 255 - max(white[offset + c] - black[offset + c] for c in range(3))
            rgba[offset:offset + 4] = bytes([
                min(255, round(black[offset + c] * 255 / alpha)) if alpha else 0
                for c in (2, 1, 0)] + [alpha])
        return Image.frombytes('RGBA', (size, size), bytes(rgba))
    finally:
        if previous:
            gdi.SelectObject(dc, previous)
        if bitmap:
            gdi.DeleteObject(bitmap)
        gdi.DeleteDC(dc)


def icon_data_url(path):
    """Read the current system association icon, never a content thumbnail."""
    try:
        with _shell_com():
            shell = ctypes.windll.shell32
            get_info = shell.SHGetFileInfoW
            get_info.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, ctypes.POINTER(_SHFILEINFO),
                                 wintypes.UINT, wintypes.UINT]
            get_info.restype = ctypes.c_size_t
            info = _SHFILEINFO()
            try:
                # ICON | USEFILEATTRIBUTES: use the default association rather than a thumbnail handler.
                if not get_info(path, 0x80, ctypes.byref(info), ctypes.sizeof(info), 0x100 | 0x10) or not info.hIcon:
                    return None
                image = _icon_image(info.hIcon)
                output = io.BytesIO()
                image.save(output, format='PNG')
                return 'data:image/png;base64,' + base64.b64encode(output.getvalue()).decode('ascii')
            finally:
                if info.hIcon:
                    ctypes.windll.user32.DestroyIcon.argtypes = [wintypes.HICON]
                    ctypes.windll.user32.DestroyIcon(info.hIcon)
    except (OSError, ValueError, TypeError, ctypes.ArgumentError):
        return None
