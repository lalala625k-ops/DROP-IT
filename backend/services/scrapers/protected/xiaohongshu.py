"""P-008: Xiaohongshu note cover; locked by user approval on 2026-10-09."""
import hashlib
import io
import time
from urllib.parse import urljoin, urlparse

import requests
from PIL import Image

from backend.services.atomic_files import atomic_bytes
from backend.services.parse_progress import publish_metadata, timed_operation
from backend.services.data_paths import get_assets_dir
from backend.services.scrapers.base import BaseScraper
from backend.services.scrapers.protected.xiaohongshu_page import content_image_url, note_id, parse_note_page

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
    'Referer': 'https://www.xiaohongshu.com/',
}
SITE_HOSTS = {'xiaohongshu.com', 'www.xiaohongshu.com', 'xhslink.com', 'www.xhslink.com'}
MAX_IMAGE_BYTES = 12 * 1024 * 1024
MAX_PAGE_ATTEMPTS = 5


def _site_url(url):
    parsed = urlparse(url)
    return (parsed.scheme in ('http', 'https') and parsed.hostname in SITE_HOSTS
            and not parsed.username and not parsed.password and parsed.port in (None, 80, 443))


def _page(session, url, referer=None, *, deadline=None):
    deadline = deadline or time.monotonic() + 9
    request_headers = {**HEADERS, 'Referer': referer or url}
    for _ in range(6):
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            return None
        response = session.get(url, headers=request_headers,
                               timeout=(min(3, remaining / 2), min(6, remaining / 2)), allow_redirects=False)
        if response.status_code in (301, 302, 303, 307, 308):
            url = urljoin(url, response.headers.get('Location', ''))
            if not _site_url(url):
                return None
            resolved = note_id(url)
            if resolved:
                url = urlparse(url)._replace(scheme='https', path='/discovery/item/' + resolved).geturl()
            continue
        if not response.ok or urlparse(url).path.startswith(('/login', '/404')):
            return None
        response.encoding = 'utf-8'
        return response
    return None


@timed_operation('image_download')
def _cache_image(session, url, referer=None, *, deadline=None):
    deadline = min(deadline or float('inf'), time.monotonic() + 9)
    request_headers = {**HEADERS, 'Referer': referer or url}
    for attempt in range(2):
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            return ''
        try:
            with session.get(url, headers=request_headers,
                             timeout=(min(3, remaining / 2), min(6, remaining / 2)), stream=True) as response:
                if not response.ok or not content_image_url(response.url):
                    if attempt == 0:
                        continue
                    return ''
                if int(response.headers.get('Content-Length') or 0) > MAX_IMAGE_BYTES:
                    return ''
                content = bytearray()
                for chunk in response.iter_content(64 * 1024):
                    content.extend(chunk)
                    if len(content) > MAX_IMAGE_BYTES or time.monotonic() > deadline:
                        return ''
            with Image.open(io.BytesIO(content)) as image:
                extension = {'JPEG': 'jpg', 'PNG': 'png', 'WEBP': 'webp', 'GIF': 'gif'}.get(image.format)
                if not extension or min(image.size) < 100:
                    return ''
                image.verify()
            filename = hashlib.sha256(content).hexdigest()[:16] + '.' + extension
            path = get_assets_dir() / filename
            if not path.is_file():
                atomic_bytes(path, bytes(content))
            return '/api/assets/' + filename
        except requests.RequestException:
            if attempt == 0:
                continue
            return ''
        except (OSError, ValueError, Image.DecompressionBombError):
            return ''
    return ''


class XiaohongshuScraper(BaseScraper):
    name = 'xiaohongshu'
    status = 'PROTECTED'

    def can_handle(self, url):
        try:
            return _site_url(url) and (bool(note_id(url)) or (
                urlparse(url).hostname in ('xhslink.com', 'www.xhslink.com') and urlparse(url).path != '/'))
        except ValueError:
            return False

    def scrape(self, url, *, source_only=False):
        started = time.monotonic()
        result = {'title': url, 'description': '', 'image': '',
                  'favicon': 'https://www.xiaohongshu.com/favicon.ico', 'url': url}
        with requests.Session() as session:
            # The domestic share page does not need the overseas-site proxy or
            # browser cookies. Retain the user's share parameters and note ID.
            session.trust_env = False
            target = urlparse(url)._replace(scheme='https')
            expected = note_id(url)
            original_target = target.geturl()
            image_referer = original_target
            if expected:
                target = target._replace(path='/discovery/item/' + expected)
            parsed = {'title': '', 'description': '', 'images': []}
            for attempt in range(MAX_PAGE_ATTEMPTS):
                if time.monotonic() >= started + 12:
                    break
                response = None
                try:
                    response = _page(session, target.geturl(), original_target, deadline=started + 12)
                    if response is not None:
                        resolved = note_id(response.url)
                        if not resolved or (expected and expected != resolved):
                            break
                        expected = resolved
                        image_referer = response.url
                        current = parse_note_page(response.text, expected)
                        for key in ('title', 'description'):
                            parsed[key] = parsed[key] or current[key]
                        parsed['images'] += [image for image in current['images'] if image not in parsed['images']]
                        if parsed['title'] and result['title'] == url:
                            result.update(title=parsed['title'], description=parsed['description'])
                            if not source_only:
                                publish_metadata(result)
                except (requests.RequestException, ValueError, TypeError, AttributeError):
                    pass
                if parsed['title'] and (source_only or parsed['images']):
                    break
                if attempt == MAX_PAGE_ATTEMPTS - 1 or not expected:
                    break
                # A title-only shell is incomplete too. Both official note
                # routes keep the same ID and signed query, including short links.
                # Fast restricted/empty responses may recover on a later attempt;
                # all five attempts still share the original page deadline.
                base = urlparse(response.url) if response is not None else target
                path = '/explore/' if base.path.startswith('/discovery/item/') else '/discovery/item/'
                target = base._replace(scheme='https', path=path + expected)
            result.update(title=parsed['title'] or url, description=parsed['description'])
            if source_only:
                return result
            if not parsed['title']:
                publish_metadata(result)
            # Only variants of the first note image, never recommendations.
            for image_url in parsed['images'][:4]:
                if time.monotonic() >= started + 26:
                    break
                result['image'] = _cache_image(session, image_url, image_referer, deadline=started + 26)
                if result['image']:
                    break
        # Always return this site result: do not fall back to the login-page logo.
        return result
