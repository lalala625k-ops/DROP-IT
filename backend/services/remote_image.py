"""Download remote cover images into the board's durable asset store."""

from __future__ import annotations

import hashlib
import io
import ipaddress
import logging
import socket
import time
from urllib.parse import urlparse, urljoin
from typing import Any

import requests
from PIL import Image

from backend.services.atomic_files import atomic_bytes
from backend.services.data_paths import get_assets_dir
from backend.services.thumbnail_service import get_or_create_thumbnail
from backend.services.parse_progress import timed_operation
from backend.services.proxy_routing import select_proxies, retry_proxies, direct_proxies, report_failure

_logger = logging.getLogger(__name__)


MAX_REMOTE_IMAGE_BYTES = 12 * 1024 * 1024
PROXY_FAKE_IP_NETWORK = ipaddress.ip_network("198.18.0.0/15")
REQUEST_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
}
RETRYABLE_STATUSES = {408, 429, 500, 502, 503, 504}


def _uses_proxy(url: str, proxies: dict | None) -> bool:
    # Match Requests' effective routing, including Windows system proxy settings
    # and per-target NO_PROXY rules. Explicit fallback/direct routes are pinned.
    effective = {**requests.utils.get_environ_proxies(url), **(proxies or {})}
    return bool(requests.utils.select_proxy(url, effective))


def _public_url(value: str, *, allow_proxy_dns: bool = False) -> bool:
    try:
        parsed = urlparse(value)
        if parsed.scheme not in {"http", "https"} or not parsed.hostname:
            return False
        if parsed.username or parsed.password or parsed.port not in (None, 80, 443):
            return False
        host = parsed.hostname.rstrip(".").lower()
        if host in {"localhost", "localhost.localdomain"} or host.endswith(".local"):
            return False
        try:
            address = ipaddress.ip_address(host)
        except ValueError:
            # Reject numeric IPv4 aliases too (for example 2130706433).
            try:
                socket.inet_aton(host)
            except OSError:
                pass
            else:
                return False
        else:
            return address.is_global and not address.is_multicast
        addresses = socket.getaddrinfo(host, parsed.port or (443 if parsed.scheme == "https" else 80),
                                       type=socket.SOCK_STREAM)
        resolved = [ipaddress.ip_address(item[4][0]) for item in addresses]
        # Local proxies can resolve public domains to virtual addresses. Allow
        # only their fake-IP range, and only when the request uses that proxy.
        return bool(resolved) and all(
            (address.is_global and not address.is_multicast)
            or (allow_proxy_dns and address in PROXY_FAKE_IP_NETWORK)
            for address in resolved
        )
    except (ValueError, OSError, socket.gaierror):
        return False


def _extension(image_format: str | None) -> str:
    return {"JPEG": "jpg", "PNG": "png", "WEBP": "webp", "GIF": "gif", "BMP": "bmp",
            "AVIF": "avif"}.get((image_format or "").upper(), "")


def _download_image(url: str, headers: dict, proxies: dict | None) -> bytes | None:
    deadline = time.monotonic() + 15
    with requests.Session() as session:
        for _attempt in range(2):
            try:
                content = _download_attempt(session, url, headers, proxies, deadline)
                return content
            except (requests.Timeout, requests.ConnectionError, requests.HTTPError,
                    requests.exceptions.ChunkedEncodingError) as error:
                if time.monotonic() >= deadline:
                    if not isinstance(error, requests.HTTPError):
                        report_failure(url, proxies)
                    break
                if _attempt == 0:
                    if not isinstance(error, requests.HTTPError):
                        proxies = retry_proxies(url, proxies, deadline=deadline)
                elif not isinstance(error, requests.HTTPError):
                    report_failure(url, proxies)
    return None


def _download_attempt(session, url, headers, proxies, deadline) -> bytes | None:
    for _redirect in range(4):
        # Validate every redirect and retry, retaining the same download budget.
        if not _public_url(url, allow_proxy_dns=_uses_proxy(url, proxies)):
            return None
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            return None
        referer = headers.get("Referer")
        if referer and not _public_url(referer, allow_proxy_dns=_uses_proxy(referer, proxies)):
            headers = {key: value for key, value in headers.items() if key != "Referer"}
        timeout = (min(3, remaining / 2), min(6, remaining / 2))
        with session.get(url, headers=headers, proxies=proxies, timeout=timeout, stream=True,
                         allow_redirects=False) as response:
            if response.status_code in (301, 302, 303, 307, 308):
                url = urljoin(url, response.headers.get("Location", ""))
                # A different origin may have its own system route / bypass.
                # Never probe a redirect until its public address is checked.
                if not _public_url(url, allow_proxy_dns=True):
                    return None
                if proxies is None or requests.utils.select_proxy(url, proxies):
                    proxies = select_proxies(url, deadline=deadline)
                else:
                    proxies = direct_proxies(url)
                continue
            if response.status_code in RETRYABLE_STATUSES:
                raise requests.HTTPError(response=response)
            if not response.ok:
                return None
            content_type = (response.headers.get("Content-Type") or "").split(";", 1)[0].lower()
            if content_type and not (content_type.startswith("image/") or content_type == "application/octet-stream"):
                return None
            if int(response.headers.get("Content-Length") or 0) > MAX_REMOTE_IMAGE_BYTES:
                return None
            content = bytearray()
            for chunk in response.iter_content(64 * 1024):
                content.extend(chunk)
                if len(content) > MAX_REMOTE_IMAGE_BYTES or time.monotonic() >= deadline:
                    return None
            return bytes(content) or None
    return None


@timed_operation('image_download')
def cache_remote_image(url: str, referer: str | None = None) -> dict[str, Any] | None:
    """Fetch, validate, and atomically cache one public image URL.

    The original page URL remains a card's ``url`` field. This function only
    stores the image bytes and returns application-local asset URLs.
    """
    try:
        # Validate before probing any candidate proxy. Fake DNS is provisionally
        # allowed here, then checked again against the actual selected route.
        if not _public_url(url, allow_proxy_dns=True):
            _logger.info("image_cache stage=address outcome=rejected")
            return None
        proxies = select_proxies(url)
        if not _public_url(url, allow_proxy_dns=_uses_proxy(url, proxies)):
            return None
        headers = dict(REQUEST_HEADERS)
        if referer and _public_url(referer, allow_proxy_dns=_uses_proxy(referer, proxies)):
            headers["Referer"] = referer
        content = _download_image(url, headers, proxies)
        if not content:
            _logger.info("image_cache stage=download outcome=failed")
            return None
        with Image.open(io.BytesIO(content)) as image:
            image_format = image.format
            width, height = image.size
            image.verify()
        extension = _extension(image_format)
        if not extension:
            return None
        digest = hashlib.sha256(content).hexdigest()[:16]
        filename = f"{digest}.{extension}"
        target = get_assets_dir() / filename
        if not target.is_file():
            atomic_bytes(target, bytes(content))
        thumbnail = get_or_create_thumbnail("assets", filename)
        result = {"url": f"/api/assets/{filename}", "width": width, "height": height}
        if thumbnail:
            result["thumbnail_url"] = f"/api/thumbnails/assets/{filename}"
        _logger.info("image_cache stage=stored outcome=success")
        return result
    except (requests.RequestException, OSError, ValueError, Image.DecompressionBombError) as error:
        _logger.info("image_cache outcome=failed error=%s", type(error).__name__)
        return None
