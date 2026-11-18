"""Read-only control identity for a verified WeChat capture surface."""
import math


def warmup():
    import clr
    for name in ('UIAutomationClient', 'UIAutomationTypes', 'WindowsBase'):
        clr.AddReference(f'{name}, Version=4.0.0.0, Culture=neutral, PublicKeyToken=31bf3856ad364e35')


def capture_control(hwnd, x, y):
    """Return a positively identified button's bounds, never its content."""
    import ctypes as c
    setter, previous = None, None
    try:
        setter = c.WinDLL('user32', use_last_error=True).SetThreadDpiAwarenessContext
        setter.argtypes, setter.restype = [c.c_void_p], c.c_void_p
        previous = setter(c.c_void_p(-4))
        if not previous:
            return None
        return _capture_control(hwnd, x, y)
    except Exception:
        return None
    finally:
        if setter and previous:
            setter(previous)


def _capture_control(hwnd, x, y):
    try:
        from System import IntPtr
        from System.Windows import Point
        from System.Windows.Automation import AutomationElement, ControlType, InvokePattern, TreeWalker
        from desktop.source_win32 import Windows
        from desktop.screenshot_events import capture_overlay

        windows = Windows()
        process = windows.process(hwnd)
        if (not capture_overlay(windows, hwnd, 'wechat')
                or windows.window_at_point(x, y) != hwnd):
            return None
        root = AutomationElement.FromHandle(IntPtr(hwnd))
        current = root.Current
        identity = tuple(int(value) for value in root.GetRuntimeId())
        if (not identity or int(current.ProcessId) != process[0]
                or int(current.NativeWindowHandle) != hwnd or current.IsOffscreen):
            return None
        native_rect = windows.rect(hwnd)
        root_rect = current.BoundingRectangle
        root_bounds = (float(root_rect.Left), float(root_rect.Top),
                       float(root_rect.Right), float(root_rect.Bottom))
        element = AutomationElement.FromPoint(Point(x, y))
        hit_identity = tuple(int(value) for value in element.GetRuntimeId())
        button, button_element, reached_root = None, None, False
        for _ in range(32):
            if element is None:
                break
            current = element.Current
            if int(current.ProcessId) != process[0]:
                return None
            if tuple(int(value) for value in element.GetRuntimeId()) == identity:
                reached_root = int(current.NativeWindowHandle) == hwnd
                break
            if button is None and current.ControlType == ControlType.Button:
                if current.IsOffscreen or not current.IsEnabled:
                    return None
                if element.GetCurrentPattern(InvokePattern.Pattern) is None:
                    return None
                rect = current.BoundingRectangle
                button = (float(rect.Left), float(rect.Top), float(rect.Right), float(rect.Bottom))
                button_element = element
            element = TreeWalker.RawViewWalker.GetParent(element)
        if not reached_root or button is None or not native_rect:
            return None
        if not all(math.isfinite(value) for value in (*button, *root_bounds)):
            return None
        left, top, right, bottom = button
        if not (left <= x < right and top <= y < bottom):
            return None
        for bounds in (native_rect, root_bounds):
            if not (bounds[0] <= left < right <= bounds[2]
                    and bounds[1] <= top < bottom <= bounds[3]):
                return None
        live_root = AutomationElement.FromHandle(IntPtr(hwnd))
        live_hit = AutomationElement.FromPoint(Point(x, y))
        current = button_element.Current
        rect = current.BoundingRectangle
        if (tuple(int(value) for value in live_root.GetRuntimeId()) != identity
                or int(live_root.Current.ProcessId) != process[0]
                or int(live_root.Current.NativeWindowHandle) != hwnd
                or tuple(int(value) for value in live_hit.GetRuntimeId()) != hit_identity
                or int(live_hit.Current.ProcessId) != process[0]
                or int(current.ProcessId) != process[0] or current.ControlType != ControlType.Button
                or current.IsOffscreen or not current.IsEnabled
                or button_element.GetCurrentPattern(InvokePattern.Pattern) is None
                or (float(rect.Left), float(rect.Top), float(rect.Right), float(rect.Bottom)) != button
                or windows.rect(hwnd) != native_rect
                or windows.window_at_point(x, y) != hwnd or windows.process(hwnd) != process
                or not capture_overlay(windows, hwnd, 'wechat')):
            return None
        return button
    except Exception:
        return None
