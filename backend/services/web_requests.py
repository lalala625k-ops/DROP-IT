"""Bounded transport retry without changing site parsing or HTTP failure rules."""

import logging
import time
from contextlib import contextmanager
from contextvars import ContextVar
from urllib.parse import urlsplit, urljoin

import requests

from backend.services.proxy_routing import select_proxies, retry_proxies, system_proxy, route_label, report_failure

_logger = logging.getLogger(__name__)
_source_scope = ContextVar('source_metadata_request', default=False)


@contextmanager
def source_request_scope():
    token = _source_scope.set(True)
    try:
        yield
    finally:
        _source_scope.reset(token)


def request(method, url, *, timeout=8, **kwargs):
    if _source_scope.get():
        return _source_request(method, url, timeout=timeout, **kwargs)
    return _request(method, url, timeout=timeout, **kwargs)


def _source_request(method, url, *, timeout, **kwargs):
    # Preserve the source-only endpoint's public-target check on every hop.
    from backend.services.remote_image import _public_url
    follow = kwargs.pop('allow_redirects', method.lower() == 'get')
    deadline = time.monotonic() + (sum(timeout) if isinstance(timeout, tuple) else timeout)
    for _ in range(6):
        if not _public_url(url, allow_proxy_dns=True):
            raise requests.exceptions.InvalidURL('Source metadata target must be public HTTP(S)')
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise requests.Timeout('Source metadata redirect budget exhausted')
        response = _request(method, url, timeout=remaining, allow_redirects=False, **kwargs)
        if not follow or response.status_code not in (301, 302, 303, 307, 308):
            return response
        target = response.headers.get('Location')
        if not target:
            return response
        url = urljoin(url, target)
        response.close()
    raise requests.TooManyRedirects('Source metadata redirect limit exceeded')


def _request(method, url, *, timeout=8, **kwargs):
    budget = sum(timeout) if isinstance(timeout, tuple) else timeout
    deadline = time.monotonic() + budget
    proxies = select_proxies(url, deadline=deadline)
    for attempt in range(2):
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise requests.Timeout("Web request routing budget exhausted")
        # Reserve time for one alternate route after a transport failure.
        allowance = remaining * (0.6 if attempt == 0 else 1)
        try:
            response = getattr(requests, method.lower())(
                url, proxies=proxies, timeout=(min(3, allowance / 2), allowance / 2), **kwargs)
            proxy = requests.utils.select_proxy(url, proxies or {}) if proxies is not None else system_proxy(url)
            _logger.info("metadata_request host=%s route=%s status=%s attempt=%s",
                         urlsplit(url).hostname, route_label(proxy), response.status_code, attempt + 1)
            return response  # 403/404 and other HTTP errors keep existing semantics.
        except (requests.ConnectionError, requests.Timeout, requests.exceptions.ChunkedEncodingError):
            if attempt:
                report_failure(url, proxies)
                raise
            proxies = retry_proxies(url, proxies, deadline=deadline)


def get(url, **kwargs):
    return request("get", url, **kwargs)


def head(url, **kwargs):
    return request("head", url, **kwargs)
