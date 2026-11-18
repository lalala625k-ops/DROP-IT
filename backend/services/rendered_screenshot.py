"""Wait for verified dynamic content in a disposable headless browser."""
import base64
import json
import logging
import os
import subprocess
import time
from pathlib import Path
from urllib.parse import urlsplit

import websocket

_logger = logging.getLogger(__name__)


def capture_rendered_page(command, output: Path, validate, deadline: float, *, retry_after=None):
    profile = Path(next(arg.split('=', 1)[1] for arg in command if arg.startswith('--user-data-dir=')))
    url = command[-1]
    flags = [arg for arg in command[:-1] if not arg.startswith(('--screenshot=', '--virtual-time-budget=', '--timeout='))]
    flags += ['--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', 'about:blank']
    options = {'creationflags': subprocess.CREATE_NO_WINDOW} if os.name == 'nt' else {'start_new_session': True}
    process = subprocess.Popen(flags, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, **options)
    connection = None
    identifier = 0

    def remaining():
        value = deadline - time.monotonic()
        if value <= 0:
            raise TimeoutError('Rendered content budget exhausted')
        return value

    def call(method, params=None, session=None):
        nonlocal identifier
        identifier += 1
        message = {'id': identifier, 'method': method, 'params': params or {}}
        if session:
            message['sessionId'] = session
        connection.settimeout(remaining())
        connection.send(json.dumps(message))
        while True:
            connection.settimeout(remaining())
            response = json.loads(connection.recv())
            if response.get('id') == identifier:
                if 'error' in response:
                    raise RuntimeError('Headless browser command failed')
                return response.get('result', {})

    try:
        port_file = profile / 'DevToolsActivePort'
        while not port_file.is_file():
            remaining()
            if process.poll() is not None:
                raise RuntimeError('Headless browser exited before connecting')
            time.sleep(0.05)
        port, path = port_file.read_text().splitlines()[:2]
        # Connect only to this process's loopback endpoint, bypassing web proxies.
        connection = websocket.create_connection(f'ws://127.0.0.1:{int(port)}{path}', timeout=remaining(),
                                                 suppress_origin=True, http_no_proxy=['127.0.0.1', 'localhost'])
        target = call('Target.createTarget', {'url': 'about:blank'})['targetId']
        session = call('Target.attachToTarget', {'targetId': target, 'flatten': True})['sessionId']
        call('Page.enable', session=session)
        call('Emulation.setDeviceMetricsOverride', {'width': 1280, 'height': 800,
             'deviceScaleFactor': 1, 'mobile': False}, session)
        retry_at = time.monotonic() + retry_after if retry_after is not None else None
        navigation = call('Page.navigate', {'url': url}, session)
        if navigation.get('errorText'):
            if retry_at is None:
                raise RuntimeError('Headless page navigation failed')
            retry_at = time.monotonic()
        while True:
            result = call('Runtime.evaluate', {
                'expression': 'document.documentElement ? document.documentElement.outerHTML : ""',
                'returnByValue': True,
            }, session)
            html = result.get('result', {}).get('value', '')
            if isinstance(html, str) and len(html) < 4_000_000 and validate(html):
                screenshot = call('Page.captureScreenshot', {'format': 'png', 'captureBeyondViewport': False}, session)
                output.write_bytes(base64.b64decode(screenshot['data'], validate=True))
                return subprocess.CompletedProcess(command, 0)
            if retry_at is not None and time.monotonic() >= retry_at:
                # Reuse this disposable profile's downloaded scripts, but restart
                # a stalled embed once. The original deadline never moves.
                retry_at = None
                _logger.info('web_screenshot host=%s stage=render_retry', urlsplit(url).hostname)
                navigation = call('Page.navigate', {'url': url}, session)
                if navigation.get('errorText'):
                    raise RuntimeError('Headless page navigation failed')
            remaining()
            time.sleep(0.15)
    finally:
        if connection:
            try:
                connection.send(json.dumps({'id': identifier + 1, 'method': 'Browser.close'}))
                connection.close()
            except Exception:
                pass
        try:
            process.wait(timeout=1)
        except subprocess.TimeoutExpired:
            if os.name == 'nt':
                try:
                    subprocess.run(['taskkill', '/PID', str(process.pid), '/T', '/F'], capture_output=True,
                                   timeout=2, creationflags=subprocess.CREATE_NO_WINDOW)
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
