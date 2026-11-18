"""Keep short-lived visible Edge URL snapshots before a screenshot begins."""
import time
from desktop.source_browser import edge_windows, web_reference


class BrowserSnapshot:
    def __init__(self, clock=time.monotonic):
        self._clock = clock
        self._entry = None
        self._entries = {}
        self._next = 0
        self._known_windows = set()
        self._known_titles = {}
        self._refresh_state = {'state': 'not_started'}
        self.last_attempt = None

    def clear(self):
        self._entry = None
        self._entries = {}
        self._known_windows = set()
        self._known_titles = {}

    @property
    def ready(self):
        entries = list(self._entries.values()) + [self._entry]
        return any(entry and self._clock() - entry[3] <= 1.5 for entry in entries)

    def refresh(self, windows, probe, preferred_hwnd=None):
        candidates = edge_windows(windows)
        if not candidates:
            self.clear()
            self._refresh_state = {'state': 'no_visible_edge'}
            return
        self._entries = {hwnd: entry for hwnd, entry in self._entries.items() if hwnd in candidates}
        appeared = [hwnd for hwnd in candidates if hwnd not in self._known_windows]
        titles = {hwnd: windows.text(hwnd) for hwnd in candidates}
        changed = [hwnd for hwnd in candidates if hwnd in self._known_titles
                   and self._known_titles[hwnd] != titles[hwnd]]
        self._known_windows = set(candidates)
        self._known_titles = titles
        if preferred_hwnd in candidates:
            hwnd = preferred_hwnd
        else:
            # Navigation/tab changes reuse the HWND. Give a newly observed
            # title one turn before rotation, without refreshing stale URLs
            # or repeatedly prioritizing a provider that failed to read it.
            priority = appeared or changed
            hwnd = priority[0] if priority else candidates[self._next % len(candidates)]
        # Resume rotation after the priority window so background windows still
        # get fresh URLs, including when the first read of a new window fails.
        self._next = (candidates.index(hwnd) + 1) % len(candidates)
        title, started = windows.text(hwnd), self._clock()
        self._refresh_state = {'state': 'reading', 'started': started}
        try:
            source = probe.read(hwnd, title)
        except Exception:
            self._refresh_state = {'state': 'read_error', 'started': started,
                                   'elapsed_ms': round((self._clock()-started)*1000)}
            raise
        source = web_reference(source.get('url')) if isinstance(source, dict) else None
        same_window = hwnd in edge_windows(windows) and windows.text(hwnd) == title
        self._refresh_state = {'state': 'finished', 'started': started,
                               'elapsed_ms': round((self._clock()-started)*1000),
                               'source_read': bool(source), 'window_unchanged': same_window}
        if source and same_window:
            self._entry = (hwnd, title, source, started)
            self._entries[hwnd] = self._entry
        elif not same_window:
            self._entries.pop(hwnd, None)
            if self._entry and self._entry[0] == hwnd:
                self._entry = None
        # A transient provider failure does not erase a still-fresh snapshot.
        # Its original timestamp is unchanged, and the crop worker must verify
        # the exact frozen URL independently before binding the screenshot.

    def capture(self, hwnd, title, diagnostics=None):
        entry = self._entries.get(hwnd) or self._entry
        now = self._clock()
        if diagnostics is not None:
            same_handle = bool(entry and entry[0] == hwnd)
            diagnostics.update(cached=same_handle,
                               age_ms=round((now-entry[3])*1000) if same_handle else None,
                               title_matches=bool(same_handle and entry[1] == title))
        if not entry or entry[:2] != (hwnd, title) or now - entry[3] > 1.5:
            return None
        # The hotkey uses this immutable pre-capture URL. The worker later
        # verifies that Edge still exposes this exact URL before binding it.
        return dict(entry[2])

    def fallback_candidates(self, windows):
        """Cached URLs for the explicit unchecked policy, never verified snapshots."""
        result = []
        for hwnd in edge_windows(windows):
            entry = self._entries.get(hwnd) or self._entry
            if not entry or entry[0] != hwnd:
                continue
            webpage = web_reference(entry[2].get('url'))
            if webpage:
                # Age, title equality and crop association are deliberately
                # not requirements in this user-authorized fallback branch.
                result.append({'hwnd': hwnd, 'browser_url': webpage['url']})
        return result

    def freeze(self, windows):
        result, checks = [], []
        for hwnd in edge_windows(windows):
            title = windows.text(hwnd)
            check = {}
            source = self.capture(hwnd, title, check)
            checks.append({**check, 'accepted': bool(source)})
            if source:
                result.append({'hwnd': hwnd, 'title': title, 'browser_url': source['url']})
        refresh_state = self._refresh_state
        refresh = {key: value for key, value in refresh_state.items() if key != 'started'}
        if 'started' in refresh_state:
            refresh['age_ms'] = round((self._clock()-refresh_state['started'])*1000)
        # Keep the preflight evidence even when subsequent polling succeeds.
        # No URL, title, window handle, file path or image enters diagnostics.
        self.last_attempt = {'windows': checks[:16], 'refresh': refresh}
        return result
