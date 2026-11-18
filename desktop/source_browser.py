"""Read Edge's address bar without focusing it or changing the clipboard."""
import ntpath
import re
from collections import OrderedDict
from urllib.parse import urlsplit


def web_reference(value):
    if not isinstance(value, str) or not value or len(value) > 8192 or any(char.isspace() for char in value):
        return None
    try:
        url = urlsplit(value)
        if url.scheme.lower() not in ('http', 'https') or not url.hostname or url.username or url.password:
            return None
        if any(ord(char) < 32 for char in value) or '\\' in value:
            return None
        _ = url.port  # Reject malformed ports as well as malformed hosts.
    except ValueError:
        return None
    return {'url': value, 'app': 'Microsoft Edge'}


def is_edge(windows, hwnd):
    return (windows.text(hwnd, True) == 'Chrome_WidgetWin_1'
            and ntpath.basename(windows.process(hwnd)[1]).lower() == 'msedge.exe')


def edge_windows(windows):
    """Candidates are real visible windows; crop checks decide which was captured."""
    result = [hwnd for hwnd in windows.visible_windows() if is_edge(windows, hwnd)]
    foreground = windows.u.GetForegroundWindow()
    if foreground not in result and is_edge(windows, foreground):
        result.insert(0, foreground)
    return result


def _unicode_display(value):
    # Edge displays UTF-8 names as Unicode. Decode only non-ASCII byte runs:
    # decoding %2F, %26, %23 or %25 could change URL structure or double-decode.
    def decode(match):
        try:
            return bytes.fromhex(match[0].replace('%', '')).decode('utf-8')
        except UnicodeDecodeError:
            return match[0]
    return re.sub(r'(?:%[89a-fA-F][0-9a-fA-F])+', decode, value)


def complete_address(displayed, document_url):
    """Use the live document URL only when it agrees with Edge's elided bar."""
    source = web_reference(document_url)
    if not source or not isinstance(displayed, str) or not displayed:
        return None
    without_scheme = document_url.split('://', 1)[1]
    candidates = {document_url, without_scheme}
    # Edge may also omit www. and a root trailing slash in its display value.
    if without_scheme.startswith('www.'):
        candidates.add(without_scheme[4:])
    if urlsplit(document_url).path == '/':
        for value in tuple(candidates):
            # The root slash precedes query/fragment delimiters, which may
            # themselves contain slashes. Preserve those bytes verbatim.
            slash = value.find('/', value.find('://') + 3 if '://' in value else 0)
            candidates.add(value[:slash] + value[slash + 1:])
    return document_url if _unicode_display(displayed) in {
        _unicode_display(value) for value in candidates} else None


class BrowserAddress:
    def __init__(self, element, pattern, documents):
        self.element, self.pattern, self.documents = element, pattern, documents

    @property
    def Current(self):
        return self

    @property
    def Value(self):
        current = self.element.Current
        if current.IsOffscreen:
            return ''
        displayed = str(self.pattern.Current.Value)
        if web_reference(displayed) and not current.HasKeyboardFocus:
            # A browser root URL has an empty-path slash. Insert only that
            # character; rebuilding the URL loses empty ?/# delimiters.
            if not urlsplit(displayed).path:
                boundary = min((displayed.find(mark) for mark in ('?', '#')
                                if mark in displayed), default=len(displayed))
                return displayed[:boundary] + '/' + displayed[boundary:]
            return displayed
        # A focused bar can still show the current page. Require agreement
        # with its live Document URL so an unsubmitted address is never used.
        matches = set()
        for element, pattern in self.documents:
            if not element.Current.IsOffscreen:
                url = complete_address(displayed, str(pattern.Current.Value))
                if url:
                    matches.add(url)
        return matches.pop() if len(matches) == 1 else ''


class BrowserProviders:
    """Bounded live address providers; never cache URL values or documents."""
    def __init__(self, capacity=16):
        self.capacity, self.entries = capacity, OrderedDict()

    @staticmethod
    def identity(root):
        current = root.Current
        if current.IsOffscreen:
            raise ValueError('hidden browser root')
        return (int(current.ProcessId), tuple(int(value) for value in root.GetRuntimeId()),
                str(current.Name))

    @staticmethod
    def live(address, pid, role):
        current = address.element.Current
        return (int(current.ProcessId) == pid and current.ControlType == role
                and not current.IsOffscreen and not current.HasKeyboardFocus
                and bool(web_reference(str(address.pattern.Current.Value))))

    def discard(self, hwnd):
        self.entries.pop(hwnd, None)

    def remember(self, hwnd, root, address):
        self.discard(hwnd)
        try:
            identity, role = self.identity(root), address.element.Current.ControlType
            if self.live(address, identity[0], role):
                self.entries[hwnd] = (identity, BrowserAddress(address.element, address.pattern, []), role)
                while len(self.entries) > self.capacity:
                    self.entries.popitem(last=False)
        except Exception:
            pass

    def get(self, hwnd, root):
        entry = self.entries.pop(hwnd, None)
        try:
            if (entry and entry[0] == self.identity(root)
                    and self.live(entry[1], entry[0][0], entry[2])):
                self.entries[hwnd] = entry
                return entry[1]
        except Exception:
            pass
        return None


_providers = BrowserProviders()


def _address_bar(hwnd):
    import clr
    for name in ('UIAutomationClient', 'UIAutomationTypes'):
        clr.AddReference(f'{name}, Version=4.0.0.0, Culture=neutral, PublicKeyToken=31bf3856ad364e35')
    from System import IntPtr
    from System.Windows.Automation import AutomationElement, ControlType, TreeScope, Condition, ValuePattern

    root = AutomationElement.FromHandle(IntPtr(hwnd))
    if root is None:
        _providers.discard(hwnd)
        return None
    cached = _providers.get(hwnd, root)
    if cached is not None:
        return cached
    queue, address, documents = [root], None, []
    # Inspect only browser chrome and top-level Document URL metadata. Never
    # traverse webpage inputs, text or iframe documents.
    names = {'address and search bar', '地址和搜索栏', '地址與搜尋列', '地址和搜尋列'}
    for _ in range(300):
        if not queue:
            break
        element = queue.pop(0)
        current = element.Current
        if current.ControlType == ControlType.Document:
            if not current.IsOffscreen:
                try:
                    documents.append((element, element.GetCurrentPattern(ValuePattern.Pattern)))
                except Exception:
                    pass
            continue
        if current.ControlType == ControlType.Edit and (
                current.AutomationId == 'addressEditBox' or str(current.Name).casefold() in names):
            if not current.IsOffscreen:
                pattern = element.GetCurrentPattern(ValuePattern.Pattern)
                address = (element, pattern)
                if web_reference(str(pattern.Current.Value)) and not current.HasKeyboardFocus:
                    found = BrowserAddress(element, pattern, [])
                    _providers.remember(hwnd, root, found)
                    return found
            else:
                return None
        children = element.FindAll(TreeScope.Children, Condition.TrueCondition)
        queue.extend(children[index] for index in range(min(children.Count, 100)))
    return BrowserAddress(*address, documents) if address else None


def read_browser(hwnd, windows, expected_title=None, expected_url=None):
    # Keep the exact process used to recognize Edge for the post-read check;
    # HWND reuse between two process lookups must not establish a new identity.
    process = windows.process(hwnd)
    if (windows.text(hwnd, True) != 'Chrome_WidgetWin_1'
            or ntpath.basename(process[1]).lower() != 'msedge.exe'):
        _providers.discard(hwnd)
        return None
    title = windows.text(hwnd)
    if expected_title is not None and title != expected_title:
        _providers.discard(hwnd)
        return None
    try:
        address = _address_bar(hwnd)
        if address is None:
            _providers.discard(hwnd)
            return None
        source = web_reference(str(address.Current.Value))
        # Re-read the live provider, not a cached UIA value. A navigation or
        # tab switch during this read must not attach the wrong page.
        if (not source or _unicode_display(str(address.Current.Value)) != _unicode_display(source['url'])
                or windows.text(hwnd) != title or windows.process(hwnd) != process):
            _providers.discard(hwnd)
            return None
        if expected_url is not None:
            if _unicode_display(source['url']) != _unicode_display(expected_url):
                _providers.discard(hwnd)
                return None
            return web_reference(expected_url)
        return source
    except Exception:
        _providers.discard(hwnd)
        return None
