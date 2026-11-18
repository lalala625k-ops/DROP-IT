"""Target-specific proxy selection for public webpage and cover requests."""

import ipaddress
import logging
import socket
import threading
import time
from collections import OrderedDict
from urllib.parse import urlsplit

import requests

LOCAL_PORTS = (7897, 7890, 10808, 10809)
_states = OrderedDict()
_lock = threading.Lock()
_logger = logging.getLogger(__name__)


def system_proxy(url):
    return requests.utils.select_proxy(url, requests.utils.get_environ_proxies(url))


def bypass_proxy(url):
    host = (urlsplit(url).hostname or "").rstrip(".").lower()
    try:
        local = not ipaddress.ip_address(host).is_global
    except ValueError:
        local = host == "localhost" or host.endswith(".local")
    return local or requests.utils.should_bypass_proxies(url, no_proxy=None)


def _key(url, proxy):
    parts = urlsplit(url)
    return (parts.scheme, parts.hostname, parts.port), proxy


def _state(url, proxy):
    key = _key(url, proxy)
    with _lock:
        value = _states.get(key)
        if value and value[0] > time.monotonic():
            _states.move_to_end(key)
            return value[1]
        _states.pop(key, None)
    return None


def _remember(url, proxy, healthy):
    with _lock:
        _states[_key(url, proxy)] = (time.monotonic() + (30 if healthy else 15), healthy)
        _states.move_to_end(_key(url, proxy))
        while len(_states) > 128:
            _states.popitem(last=False)


def report_failure(url, proxies):
    proxy = requests.utils.select_proxy(url, proxies or {}) if proxies is not None else system_proxy(url)
    if proxy:
        _remember(url, proxy, False)
    _logger.info("network_route host=%s route=%s outcome=transport_failed",
                 urlsplit(url).hostname, route_label(proxy))


def route_label(proxy):
    try:
        return f"proxy_port:{urlsplit(proxy).port}" if proxy else "direct"
    except ValueError:
        return "proxy"


def direct_proxies(url):
    # Explicit None entries suppress environment, ALL_PROXY and host-specific
    # settings when Requests merges them into this single fallback attempt.
    return {key: None for key in {*requests.utils.get_environ_proxies(url), "http", "https", "all"}}


def explicit_proxies(url, proxy):
    # Requests gives host-specific settings precedence over protocol settings.
    # Override those too, so the probe and download really use this candidate.
    return {**{key: proxy for key in requests.utils.get_environ_proxies(url) if key != "no"},
            "http": proxy, "https": proxy}


def _probe(url, proxy, deadline):
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https") or parts.username or parts.password:
        return False
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        return False
    timeout = min(0.6, remaining / 2)
    try:
        # Do not follow redirects, read bodies, forward cookies or log URLs.
        with requests.head(url, proxies=explicit_proxies(url, proxy),
                           headers={"User-Agent": "Mozilla/5.0"},
                           timeout=(timeout, timeout), allow_redirects=False, stream=True) as response:
            return 200 <= response.status_code < 400 or response.status_code == 405
    except requests.RequestException:
        return False


def fallback_proxy(url, *, exclude=(), deadline=None):
    """Validate local candidates against this target within a two-second budget."""
    if bypass_proxy(url):
        return None
    deadline = min(deadline or float("inf"), time.monotonic() + 2)
    for port in LOCAL_PORTS:
        proxy = f"http://127.0.0.1:{port}"
        if proxy in exclude or _state(url, proxy) is False:
            continue
        if _state(url, proxy) is True:
            return proxy
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            break
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=min(0.1, remaining)):
                pass
            healthy = _probe(url, proxy, deadline)
        except OSError:
            healthy = False
        _remember(url, proxy, healthy)
        _logger.info("proxy_probe host=%s route=%s outcome=%s", urlsplit(url).hostname,
                     route_label(proxy), "ready" if healthy else "unavailable")
        if healthy:
            return proxy
    return None


def select_proxies(url, *, deadline=None):
    if bypass_proxy(url):
        return None
    configured = system_proxy(url)
    if configured and _state(url, configured) is not False:
        return None  # Requests applies the configured route and redirect bypass.
    proxy = fallback_proxy(url, exclude=(configured,), deadline=deadline)
    if proxy:
        return explicit_proxies(url, proxy)
    return direct_proxies(url) if configured else None


def retry_proxies(url, previous, *, deadline=None):
    report_failure(url, previous)
    selected = requests.utils.select_proxy(url, previous or {}) if previous is not None else system_proxy(url)
    if not selected or bypass_proxy(url):
        return previous
    proxy = fallback_proxy(url, exclude=(selected,), deadline=deadline)
    return explicit_proxies(url, proxy) if proxy else direct_proxies(url)
