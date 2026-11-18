"""Render the first PDF page locally, independent of Explorer's icon provider."""
import io
import math
import os
import threading


# PDFium is not thread safe, including calls on separate documents.
_PDF_LOCK = threading.Lock()
_MAX_FILE_BYTES = 100 * 1024 * 1024


def first_page_webp(path, size=800):
    try:
        import pypdfium2 as pdfium
    except ImportError:
        return None
    try:
        if os.path.getsize(path) > _MAX_FILE_BYTES:
            return None
        with _PDF_LOCK, pdfium.PdfDocument(path) as document:
            if not len(document):
                return None
            page = document[0]
            try:
                width, height = page.get_size()
                if not all(math.isfinite(value) and value > 0 for value in (width, height)):
                    return None
                bitmap = page.render(scale=size / max(width, height), fill_color=(255, 255, 255, 255))
                try:
                    image = bitmap.to_pil()
                    try:
                        output = io.BytesIO()
                        image.save(output, format='WEBP', quality=85, method=4)
                        return output.getvalue()
                    finally:
                        image.close()
                finally:
                    bitmap.close()
            finally:
                page.close()
    except (pdfium.PdfiumError, OSError, ValueError, TypeError, OverflowError):
        # Encrypted, corrupt or unsupported PDFs retain the normal file card.
        return None
