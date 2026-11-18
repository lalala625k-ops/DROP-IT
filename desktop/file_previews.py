"""Small local file previews: PDF first pages and Windows content thumbnails."""
import base64
import ctypes
import io
import os
import sys
from ctypes import wintypes

from PIL import Image
from desktop.pdf_previews import first_page_webp


class _GUID(ctypes.Structure):
    _fields_ = [('Data1', wintypes.DWORD), ('Data2', wintypes.WORD), ('Data3', wintypes.WORD),
                ('Data4', wintypes.BYTE * 8)]


class _SIZE(ctypes.Structure):
    _fields_ = [('cx', ctypes.c_int), ('cy', ctypes.c_int)]


class _BITMAP(ctypes.Structure):
    _fields_ = [('bmType', ctypes.c_long), ('bmWidth', ctypes.c_long), ('bmHeight', ctypes.c_long),
                ('bmWidthBytes', ctypes.c_long), ('bmPlanes', ctypes.c_ushort),
                ('bmBitsPixel', ctypes.c_ushort), ('bmBits', ctypes.c_void_p)]


class _BITMAPINFOHEADER(ctypes.Structure):
    _fields_ = [('biSize', wintypes.DWORD), ('biWidth', ctypes.c_long), ('biHeight', ctypes.c_long),
                ('biPlanes', wintypes.WORD), ('biBitCount', wintypes.WORD), ('biCompression', wintypes.DWORD),
                ('biSizeImage', wintypes.DWORD), ('biXPelsPerMeter', ctypes.c_long),
                ('biYPelsPerMeter', ctypes.c_long), ('biClrUsed', wintypes.DWORD),
                ('biClrImportant', wintypes.DWORD)]


class _BITMAPINFO(ctypes.Structure):
    _fields_ = [('bmiHeader', _BITMAPINFOHEADER), ('bmiColors', wintypes.DWORD * 3)]


_IID_SHELL_ITEM_IMAGE_FACTORY = _GUID(0xBCC18B79, 0xBA16, 0x442F,
                                      (ctypes.c_ubyte * 8)(0x80, 0xC4, 0x8A, 0x59, 0xC3, 0x0C, 0x46, 0x3B))
_S_OK = 0
_DIB_RGB_COLORS = 0
_SIIGBF_RESIZETOFIT = 0
_SIIGBF_BIGGERSIZEOK = 1
_SIIGBF_THUMBNAILONLY = 8


def _release(pointer):
    if pointer:
        vtable = ctypes.cast(pointer, ctypes.POINTER(ctypes.POINTER(ctypes.c_void_p))).contents
        release = ctypes.WINFUNCTYPE(ctypes.c_ulong, ctypes.c_void_p)(vtable[2])
        release(pointer)


def _thumbnail_bitmap(path, size=800):
    if sys.platform != 'win32':
        return None
    shell32 = ctypes.windll.shell32
    ole32 = ctypes.windll.ole32
    ole32.CoInitialize(None)
    item = ctypes.c_void_p()
    bitmap = ctypes.c_void_p()
    try:
        create = shell32.SHCreateItemFromParsingName
        create.argtypes = [wintypes.LPCWSTR, ctypes.c_void_p, ctypes.POINTER(_GUID), ctypes.POINTER(ctypes.c_void_p)]
        create.restype = ctypes.c_long
        if create(os.path.abspath(path), None, ctypes.byref(_IID_SHELL_ITEM_IMAGE_FACTORY), ctypes.byref(item)) != _S_OK:
            return None
        vtable = ctypes.cast(item, ctypes.POINTER(ctypes.POINTER(ctypes.c_void_p))).contents
        get_image = ctypes.WINFUNCTYPE(ctypes.c_long, ctypes.c_void_p, _SIZE, wintypes.DWORD,
                                       ctypes.POINTER(ctypes.c_void_p))(vtable[3])
        if get_image(item, _SIZE(size, size), _SIIGBF_RESIZETOFIT | _SIIGBF_BIGGERSIZEOK | _SIIGBF_THUMBNAILONLY,
                     ctypes.byref(bitmap)) != _S_OK or not bitmap:
            return None
        gdi32 = ctypes.windll.gdi32
        user32 = ctypes.windll.user32
        gdi32.GetObjectW.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_void_p]
        gdi32.GetDIBits.argtypes = [ctypes.c_void_p, ctypes.c_void_p, wintypes.UINT, wintypes.UINT,
                                   ctypes.c_void_p, ctypes.c_void_p, wintypes.UINT]
        user32.GetDC.argtypes = [ctypes.c_void_p]
        user32.GetDC.restype = ctypes.c_void_p
        user32.ReleaseDC.argtypes = [ctypes.c_void_p, ctypes.c_void_p]
        info = _BITMAP()
        if not gdi32.GetObjectW(bitmap, ctypes.sizeof(info), ctypes.byref(info)):
            return None
        width, height = abs(info.bmWidth), abs(info.bmHeight)
        if not width or not height or width > 4096 or height > 4096:
            return None
        header = _BITMAPINFOHEADER(ctypes.sizeof(_BITMAPINFOHEADER), width, -height, 1, 32, 0,
                                   width * height * 4, 0, 0, 0, 0)
        bitmap_info = _BITMAPINFO(header, (0, 0, 0))
        pixels = (ctypes.c_ubyte * (width * height * 4))()
        dc = user32.GetDC(None)
        try:
            copied = gdi32.GetDIBits(dc, bitmap, 0, height, ctypes.byref(pixels),
                                     ctypes.byref(bitmap_info), _DIB_RGB_COLORS)
        finally:
            user32.ReleaseDC(None, dc)
        if copied != height:
            return None
        image = Image.frombuffer('RGBA', (width, height), bytes(pixels), 'raw', 'BGRA', 0, 1)
        output = io.BytesIO()
        image.save(output, format='WEBP', quality=82, method=4)
        return output.getvalue()
    finally:
        if bitmap:
            ctypes.windll.gdi32.DeleteObject.argtypes = [ctypes.c_void_p]
            ctypes.windll.gdi32.DeleteObject(bitmap)
        if item:
            _release(item)
        ole32.CoUninitialize()


def preview_data_url(path):
    """Return a bounded content preview, or None to retain the file icon card."""
    try:
        if not os.path.isfile(path):
            return None
        data = first_page_webp(path) if os.path.splitext(path)[1].lower() == '.pdf' else None
        if not data:
            data = _thumbnail_bitmap(path)
        if not data or len(data) > 2 * 1024 * 1024:
            return None
        return 'data:image/webp;base64,' + base64.b64encode(data).decode('ascii')
    except (OSError, ValueError, TypeError, ctypes.ArgumentError):
        return None
