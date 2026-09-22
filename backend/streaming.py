"""Server-sent-event plumbing shared by all seven streaming endpoints.

Every endpoint speaks the same wire format: a sequence of `data: {json}` frames,
each carrying a `type` discriminator, terminated by a literal `data: [DONE]`.
The frontend's useSSE hook is the only consumer.
"""
import asyncio
import json
import threading
from typing import Any, AsyncIterator, Callable, Iterator

from fastapi.responses import StreamingResponse

DONE = "data: [DONE]\n\n"

# Tells nginx/ALB-style proxies not to buffer the stream, which would otherwise
# defeat the point by delivering every frame at once when the response closes.
SSE_HEADERS = {
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
}


def event(event_type: str, **payload: Any) -> str:
    """Format a single SSE frame."""
    return f"data: {json.dumps({'type': event_type, **payload})}\n\n"


def error_event(exc: Exception) -> str:
    return event("error", message=str(exc))


def sse_response(generator: AsyncIterator[str]) -> StreamingResponse:
    return StreamingResponse(
        generator,
        media_type="text/event-stream",
        headers=SSE_HEADERS,
    )


async def iter_blocking(make_iterator: Callable[[], Iterator[Any]]) -> AsyncIterator[Any]:
    """Bridge a blocking iterator into async land without stalling the event loop.

    The Gemini SDK's streaming responses are ordinary blocking generators. Looping
    one directly inside an async endpoint would block the whole event loop for the
    duration of the call, so we drain it on a worker thread and hand items back
    through a queue.
    """
    queue: asyncio.Queue = asyncio.Queue()
    loop = asyncio.get_running_loop()
    sentinel = object()

    def worker() -> None:
        try:
            for item in make_iterator():
                loop.call_soon_threadsafe(queue.put_nowait, item)
        except Exception as exc:  # surfaced to the caller below
            loop.call_soon_threadsafe(queue.put_nowait, exc)
        finally:
            loop.call_soon_threadsafe(queue.put_nowait, sentinel)

    threading.Thread(target=worker, daemon=True).start()

    while True:
        item = await queue.get()
        if item is sentinel:
            return
        if isinstance(item, Exception):
            raise item
        yield item
