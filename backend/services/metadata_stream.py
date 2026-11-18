"""Stream one existing scraper execution without a second metadata request."""
import asyncio
import json
import threading

from fastapi.responses import StreamingResponse

from backend.services.parse_progress import progress_scope, publish_metadata
from backend.services.scoped_media import scope_media


def stream_metadata(scrape, url):
    loop = asyncio.get_running_loop()
    messages = asyncio.Queue()
    closed = threading.Event()

    def emit(kind, metadata=None):
        if not closed.is_set():
            loop.call_soon_threadsafe(messages.put_nowait, {'type': kind, 'metadata': metadata or {}})

    def run():
        try:
            with progress_scope(lambda metadata: emit('metadata', metadata)):
                result = scrape(url)
                publish_metadata(result)
                emit('complete', scope_media(result))
        except Exception:
            # Do not send exception text, request URLs or credentials to clients.
            emit('error')

    # Create under the endpoint's workspace context before yielding the response.
    worker = asyncio.create_task(asyncio.to_thread(run))

    async def body():
        try:
            while True:
                message = await messages.get()
                yield (json.dumps(message, ensure_ascii=False) + '\n').encode('utf-8')
                if message['type'] in ('complete', 'error'):
                    break
        finally:
            closed.set()
            # Cancelling the await does not kill a running thread; the scraper's
            # existing deadlines still own its isolated browser cleanup.
            worker.cancel()

    return StreamingResponse(body(), media_type='application/x-ndjson',
                             headers={'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no'})
