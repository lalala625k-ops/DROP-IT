"""Prepare Windows display components before starting services or sessions."""

import ctypes
import os
from pathlib import Path
import platform
import subprocess
import sys


WEBVIEW_KEY = r'SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
NET_KEY = r'SOFTWARE\Microsoft\NET Framework Setup\NDP\v4\Full'
VC_RUNTIME_MINIMUM = (14, 40, 33816, 0)


def vc_runtime_ready() -> bool:
    """Check actual x64 DLLs; some valid installations lack VC registry entries."""
    from ctypes import wintypes
    version = ctypes.WinDLL('version', use_last_error=True)
    version.GetFileVersionInfoSizeW.argtypes = [wintypes.LPCWSTR, ctypes.POINTER(wintypes.DWORD)]
    version.GetFileVersionInfoSizeW.restype = wintypes.DWORD
    version.GetFileVersionInfoW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD, wintypes.LPVOID]
    version.GetFileVersionInfoW.restype = wintypes.BOOL
    version.VerQueryValueW.argtypes = [wintypes.LPCVOID, wintypes.LPCWSTR, ctypes.POINTER(wintypes.LPVOID), ctypes.POINTER(wintypes.UINT)]
    version.VerQueryValueW.restype = wintypes.BOOL
    system = Path(os.environ.get('SystemRoot', r'C:\Windows')) / 'System32'
    for name in ('msvcp140.dll', 'msvcp140_1.dll', 'vcruntime140.dll', 'vcruntime140_1.dll'):
        path = str(system / name)
        size = version.GetFileVersionInfoSizeW(path, None)
        if not size:
            return False
        buffer = ctypes.create_string_buffer(size)
        pointer, length = wintypes.LPVOID(), wintypes.UINT()
        if not version.GetFileVersionInfoW(path, 0, size, buffer) or not version.VerQueryValueW(buffer, '\\', ctypes.byref(pointer), ctypes.byref(length)) or length.value < 52:
            return False
        fields = ctypes.cast(pointer, ctypes.POINTER(wintypes.DWORD))
        actual = (fields[2] >> 16, fields[2] & 0xffff, fields[3] >> 16, fields[3] & 0xffff)
        if fields[0] != 0xFEEF04BD or actual < VC_RUNTIME_MINIMUM:
            return False
    return True


def runtime_ready() -> bool:
    """Use Microsoft's Evergreen registry detection; Edge itself is insufficient."""
    if os.name != 'nt':
        return False
    import winreg
    webview, net_release = False, 0
    for view in (winreg.KEY_WOW64_32KEY, winreg.KEY_WOW64_64KEY):
        for hive in (winreg.HKEY_CURRENT_USER, winreg.HKEY_LOCAL_MACHINE):
            try:
                with winreg.OpenKey(hive, WEBVIEW_KEY, 0, winreg.KEY_READ | view) as key:
                    version = str(winreg.QueryValueEx(key, 'pv')[0])
                    parts = version.split('.')
                    webview |= 2 <= len(parts) <= 4 and all(p.isdigit() for p in parts) and any(int(p) > 0 for p in parts)
            except (OSError, ValueError, TypeError):
                pass
        try:
            with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, NET_KEY, 0, winreg.KEY_READ | view) as key:
                net_release = max(net_release, int(winreg.QueryValueEx(key, 'Release')[0]))
        except (OSError, ValueError, TypeError):
            pass
    return webview and net_release >= 394802 and vc_runtime_ready()


def ensure_runtime() -> bool:
    if os.name != 'nt' or platform.machine().lower() not in ('amd64', 'x86_64') or sys.getwindowsversion().build < 10240:
        raise RuntimeError('DROP-IT currently supports Windows 10/11 x64 only.')
    if runtime_ready():
        return True
    root = Path(sys.executable).resolve().parent if getattr(sys, 'frozen', False) else Path(__file__).resolve().parents[1]
    script = root / ('bootstrap' if getattr(sys, 'frozen', False) else 'scripts/bootstrap') / 'Ensure-Runtime.ps1'
    if not script.is_file():
        raise RuntimeError('Runtime setup files are missing. Extract or reinstall the complete DROP-IT package.')
    powershell = Path(os.environ.get('SystemRoot', r'C:\Windows')) / 'System32/WindowsPowerShell/v1.0/powershell.exe'
    code = subprocess.run([str(powershell), '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', str(script)],
                          creationflags=subprocess.CREATE_NO_WINDOW).returncode
    if code != 0:
        # The setup UI already explains retry/cancel or a required restart.
        return False
    if not runtime_ready():
        ctypes.windll.user32.MessageBoxW(None, '运行组件仍不可用，请重启后再试。\nRuntime components are still unavailable. Restart Windows and retry.', 'DROP-IT', 0x10)
        return False
    return True
