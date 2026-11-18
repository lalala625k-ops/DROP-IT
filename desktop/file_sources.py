"""Ephemeral screenshot references; never write document contents to disk."""
import base64
import hashlib
import io
import ntpath
import os
import struct
import threading
import time
from PIL import Image
from desktop.source_browser import web_reference


def fingerprint(image):
    image = image.convert('RGB')
    return hashlib.sha256(struct.pack('>II', *image.size) + image.tobytes()).hexdigest()


def local_file(path):
    if not isinstance(path, str) or len(path) > 32767 or '\0' in path:
        raise ValueError('文件路径无效')
    # Opening executables or URL shortcuts is not a document-link operation.
    if len(path) < 3 or not path[0].isascii() or not path[0].isalpha() or path[1] != ':' \
            or path[2] not in '\\/' or ':' in path[2:]:
        raise ValueError('请选择本机的完整文件路径')
    if ntpath.splitext(path)[1].lower() in {
        '.exe', '.com', '.bat', '.cmd', '.ps1', '.vbs', '.js', '.msi', '.scr', '.lnk', '.url', '.hta',
        '.py', '.pyw', '.jar', '.reg', '.wsf', '.wsh', '.vbe', '.jse', '.cpl', '.pif', '.msp', '.application'}:
        raise ValueError('此类型不能作为来源文档打开')
    if not os.path.isfile(path):
        raise ValueError('找不到原文件，请重新关联')
    return os.path.abspath(path)


def reference(path, linked_by='detected', app=None):
    path = local_file(path)
    return {'path': path, 'name': ntpath.basename(path), 'linkedBy': linked_by,
            **({'app': app} if app else {})}


class SourceStore:
    def __init__(self, clock=time.monotonic):
        self._clock, self._lock = clock, threading.Lock()
        self._entry = None

    def clear(self):
        with self._lock:
            self._entry = None

    def bind(self, image, source, sequence):
        with self._lock:
            self._entry = (fingerprint(image), dict(source), sequence, self._clock())

    def match(self, data_url, sequence):
        with self._lock:
            entry = self._entry
            if not entry or entry[2] != sequence or self._clock() - entry[3] > 300:
                return None
        if not isinstance(data_url, str) or len(data_url) > 32 * 1024 * 1024:
            return None
        try:
            header, data = data_url.split(',', 1)
            if header not in ('data:image/png;base64', 'data:image/jpeg;base64', 'data:image/webp;base64'):
                return None
            with Image.open(io.BytesIO(base64.b64decode(data, validate=True))) as image:
                if image.width * image.height > 20_000_000:
                    return None
                key = fingerprint(image)
        except Exception:
            return None
        with self._lock:
            entry = self._entry
            if entry and entry[0] == key and entry[2] == sequence and self._clock() - entry[3] <= 300:
                if 'url' in entry[1]:
                    return web_reference(entry[1]['url'])
                try:
                    return reference(entry[1]['path'], app=entry[1].get('app'))
                except ValueError:
                    pass
        return None


def verified_crop(screen, origin, selection, source_rect, obstructions, image, require_same_pixels=True,
                  capture_tool='wechat'):
    """Verify crop geometry; local document sources also require identical pixels."""
    x1, y1, x2, y2 = selection
    left, top, right, bottom = source_rect
    # The capture tool may report the drag end as the source window's final
    # pixel. Keep that inclusive endpoint eligible; the adjusted rectangle
    # must still stay completely inside the source window.
    if x2 <= x1 or y2 <= y1 or not (left <= x1 < x2 <= right and top <= y1 < y2 <= bottom):
        return False
    # Windows uses the exact half-open crop: an obstruction beginning at its
    # right/bottom endpoint does not cover a pixel. WeChat can include those
    # endpoints, so preserve its conservative precheck before endpoint correction.
    if capture_tool == 'windows':
        if any(x1 < r and x2 > l and y1 < b and y2 > t for l, t, r, b in obstructions):
            return False
    elif any(x1 < r and x2 >= l and y1 < b and y2 >= t for l, t, r, b in obstructions):
        return False
    delta_x = image.size[0] - (x2 - x1)
    delta_y = image.size[1] - (y2 - y1)
    if capture_tool == 'wechat':
        # Choose one fixed rectangle for each size difference, rather than
        # searching alternate placements until one avoids a boundary/cover.
        # The 0/+1/+2 layouts retain the original endpoint/border behavior.
        offsets = {-3: (1, -2), -2: (1, -1), -1: (0, -1), 0: (0, 0),
                   1: (0, 1), 2: (-1, 1), 3: (-1, 2)}
        if delta_x not in offsets or delta_y not in offsets:
            return False
        dx1, dx2 = offsets[delta_x]
        dy1, dy2 = offsets[delta_y]
    else:
        # Windows snipping still requires the exact rectangle.
        if delta_x or delta_y:
            return False
        dx1 = dx2 = dy1 = dy2 = 0
    cx1, cy1, cx2, cy2 = x1 + dx1, y1 + dy1, x2 + dx2, y2 + dy2
    if not (left <= cx1 < cx2 <= right and top <= cy1 < cy2 <= bottom):
        return False
    if any(cx1 < r and cx2 > l and cy1 < b and cy2 > t for l, t, r, b in obstructions):
        return False
    ox, oy = origin
    box = (cx1 - ox, cy1 - oy, cx2 - ox, cy2 - oy)
    if box[0] < 0 or box[1] < 0 or box[2] > screen.width or box[3] > screen.height:
        return False
    if (box[2] - box[0], box[3] - box[1]) != image.size:
        return False
    return not require_same_pixels or fingerprint(screen.crop(box)) == fingerprint(image)
