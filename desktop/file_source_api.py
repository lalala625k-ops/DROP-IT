"""File and webpage screenshot references exposed through the desktop bridge."""
import os
from desktop.file_sources import local_file, reference


class FileSourceApi:
    def __init__(self):
        self._sources = None
        from desktop.dropped_file_sources import DroppedFileSources
        self._dropped_files = DroppedFileSources()

    def get_dropped_file_source(self, stamp, name, size, modified):
        return self._dropped_files.match(stamp, name, size, modified)

    def get_file_preview(self, path):
        from desktop.file_sources import local_file
        from desktop.file_previews import preview_data_url
        try:
            return preview_data_url(local_file(path))
        except (OSError, ValueError, TypeError):
            return None

    def get_file_icon(self, path):
        from desktop.file_shell import icon_data_url
        try:
            return icon_data_url(local_file(path))
        except (OSError, ValueError, TypeError):
            return None

    def reveal_source_file(self, path):
        from desktop.file_shell import reveal_file
        try:
            reveal_file(local_file(path))
            return {'success': True}
        except Exception as error:
            return {'success': False, 'error': str(error)}

    def match_screenshot_source(self, image):
        if not self._sources:
            return None
        return self._sources.match(image, timeout=2)

    def read_clipboard_image(self):
        if not self._sources:
            return None
        return self._sources.clipboard_image_data_url()

    def open_source_file(self, path):
        try:
            os.startfile(local_file(path))
            return {'success': True}
        except Exception as error:
            return {'success': False, 'error': str(error)}

    def select_source_file(self):
        if not self._window:
            return None
        import webview
        paths = self._window.create_file_dialog(webview.FileDialog.OPEN, allow_multiple=False)
        if not paths:
            return None
        try:
            return {'success': True, 'source': reference(paths[0], 'selected')}
        except ValueError as error:
            return {'success': False, 'error': str(error)}

    def get_source_capture_status(self):
        return self._sources.status() if self._sources else {'state': 'unavailable'}


def attach_file_sources(api, window):
    from desktop.dropped_file_sources import attach_dropped_file_sources
    attach_dropped_file_sources(api, window)
    from desktop.screenshot_sources import ScreenshotSources
    api._sources = ScreenshotSources()
    api._sources.start()
    window.events.closed += lambda: api._sources.stop()
