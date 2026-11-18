import os
import hashlib
import io
import logging
import socket
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Optional
from urllib.parse import urlsplit

import requests
from PIL import Image, ImageChops
from backend.services.atomic_files import atomic_bytes
from backend.services.data_paths import get_screenshots_dir
from backend.services.proxy_routing import select_proxies
from backend.services.parse_progress import timed_operation

_logger = logging.getLogger(__name__)

def detect_local_proxy() -> Optional[str]:
    """Legacy proxy discovery retained for the separate image-to-link services."""
    for port in [7897, 7890, 10808, 10809]:
        try:
            s = socket.socket()
            s.settimeout(0.15)
            s.connect(("127.0.0.1", port))
            s.close()
            return f"http://127.0.0.1:{port}"
        except Exception:
            pass
    return None

def find_browser_executable() -> Optional[str]:
    """Find installed Chrome or Edge executable on the system."""
    candidates = [
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
        os.path.expandvars(r"%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"),
        os.path.expandvars(r"%LOCALAPPDATA%\Microsoft\Edge\Application\msedge.exe"),
    ]
    for p in candidates:
        if os.path.exists(p):
            return p
    return None

AUTH_DOMAINS_AND_KEYWORDS = [
    "accounts.feishu.cn", "passport.feishu.cn", "passport.",
    "login.", "signin.", "auth.", "sso.", "/login", "/signin", "/auth"
]

def is_auth_url(url: str) -> bool:
    lower = url.lower()
    return any(k in lower for k in AUTH_DOMAINS_AND_KEYWORDS)

def _valid_screenshot(path: Path) -> bool:
    try:
        with Image.open(path) as image:
            if image.format not in ('PNG', 'JPEG') or min(image.size) < 2 or image.width * image.height > 20_000_000:
                return False
            image.load()
            if all(low == high for low, high in image.convert('RGB').getextrema()):
                return False
        return True
    except (OSError, ValueError, Image.DecompressionBombError):
        return False


def _run_browser(command, *, timeout):
    options = {'creationflags': subprocess.CREATE_NO_WINDOW} if os.name == 'nt' else {'start_new_session': True}
    with subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, **options) as process:
        try:
            process.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            # Kill only this isolated capture tree before releasing its profile.
            if os.name == 'nt':
                try:
                    subprocess.run(['taskkill', '/PID', str(process.pid), '/T', '/F'],
                                   capture_output=True, timeout=2, creationflags=subprocess.CREATE_NO_WINDOW)
                except (OSError, subprocess.TimeoutExpired):
                    process.kill()
            else:
                import signal
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
            if process.poll() is None:
                process.kill()
            process.wait(timeout=2)
            raise
        return subprocess.CompletedProcess(command, process.returncode)


@timed_operation('screenshot')
def capture_screenshot_fallback(url: str, timeout: float = 10, *, validate_page=None, trim_background=False,
                                retry_after=None) -> Optional[str]:
    """Capture the first viewport into the current board's screenshot store."""
    if is_auth_url(url):
        return None
    try:
        directory = get_screenshots_dir()
        variant = ('|validated' if validate_page else '') + ('|trimmed' if trim_background else '')
        digest = hashlib.md5((url + variant).encode('utf-8')).hexdigest()[:16]
        for extension in ('png', 'jpg'):
            cached = directory / f'{digest}.{extension}'
            if _valid_screenshot(cached):
                return f'/api/screenshots/{cached.name}'
        browser = find_browser_executable()
        if not browser:
            _logger.warning('web_screenshot host=%s stage=browser_missing', urlsplit(url).hostname)
            return None
        deadline = time.monotonic() + timeout
        proxies = select_proxies(url, deadline=deadline)
        proxy = requests.utils.select_proxy(url, proxies or {})
        with tempfile.TemporaryDirectory(prefix='dropit-web-shot-', ignore_cleanup_errors=True) as temporary:
            output = Path(temporary) / 'viewport.png'
            command = [browser, '--headless=new', '--disable-gpu', '--no-sandbox',
                       '--no-first-run', '--no-default-browser-check', '--disable-extensions',
                       '--window-size=1280,800', '--force-device-scale-factor=1', '--hide-scrollbars',
                       '--virtual-time-budget=2000',
                       f'--user-data-dir={Path(temporary) / "profile"}', f'--screenshot={output}',
                       '--run-all-compositor-stages-before-draw']
            if proxy:
                command.append(f'--proxy-server={proxy}')
            elif proxies is not None:
                command.append('--no-proxy-server')
            command.append(url)
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                return None
            command.insert(-1, f'--timeout={max(1, int((remaining - 1) * 1000))}')
            if validate_page:
                from backend.services.rendered_screenshot import capture_rendered_page
                options = {'retry_after': retry_after} if retry_after is not None else {}
                result = capture_rendered_page(command, output, validate_page, deadline, **options)
            else:
                result = _run_browser(command, timeout=remaining)
            if result.returncode != 0 or not _valid_screenshot(output):
                _logger.warning('web_screenshot host=%s stage=output_invalid code=%s', urlsplit(url).hostname, result.returncode)
                return None
            target = directory / f'{digest}.png'
            content = output.read_bytes()
            if trim_background:
                with Image.open(output) as image:
                    rgb = image.convert('RGB')
                    bounds = ImageChops.difference(rgb, Image.new('RGB', image.size, 'white')).getbbox()
                    if not bounds:
                        return None
                    buffer = io.BytesIO()
                    rgb.crop(bounds).save(buffer, 'PNG')
                    content = buffer.getvalue()
            atomic_bytes(target, content)
            return f'/api/screenshots/{target.name}'
    except Exception as error:
        _logger.warning('web_screenshot host=%s stage=capture_failed error=%s', urlsplit(url).hostname, type(error).__name__)
    return None
