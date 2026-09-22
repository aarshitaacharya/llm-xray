"""LLM X-Ray backend.

Seven SSE-streaming endpoints, one per dashboard panel. Every endpoint pushes
incremental frames so each panel fills in as results arrive rather than blocking
on a complete response.
"""
import asyncio
import logging
import os
from typing import AsyncIterator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

import analysis
import config
import metrics
import notifications
import prompts
import streaming
from streaming import DONE, event

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("llm-xray")

app = FastAPI(title="LLM X-Ray", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=config.ALLOWED_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Service endpoints ────────────────────────────────────────────────────────

@app.get("/healthz")
def healthz():
    """Liveness probe for the ECS target group."""
    return {
        "status": "ok",
        "model": config.CHAT_MODEL,
        "alerts_enabled": notifications.is_enabled(),
    }


@app.get("/api/config")
def client_config():
    """Limits and rates the dashboard renders, kept in one place."""
    return {
        "context_limit": config.CONTEXT_LIMIT,
        "purge_threshold": config.PURGE_THRESHOLD,
        "purge_batch_size": config.PURGE_BATCH_SIZE,
        "input_cost_per_1m": config.INPUT_COST_PER_1M,
        "output_cost_per_1m": config.OUTPUT_COST_PER_1M,
        "model": config.CHAT_MODEL,
        "alerts_enabled": notifications.is_enabled(),
    }


# ── 1. Generation stream ─────────────────────────────────────────────────────

@app.post("/api/stream/generate")
async def stream_generate(data: dict):
    """Token-by-token generation with live throughput and cost accounting."""
    prompt = data.get("prompt", "")

    async def generator() -> AsyncIterator[str]:
        try:
            meter = metrics.RequestMeter()
            meter.input_tokens = await asyncio.to_thread(analysis.count_tokens, prompt)
            yield event("start", input_tokens=meter.input_tokens)

            model = analysis.get_model()
            final_usage = None

            async for chunk in streaming.iter_blocking(
                lambda: model.generate_content(prompt, stream=True)
            ):
                if getattr(chunk, "usage_metadata", None):
                    final_usage = chunk.usage_metadata
                text = analysis.chunk_text(chunk)
                if not text:
                    continue
                meter.observe_chunk(text)
                yield event("token", text=text, metrics=meter.snapshot())

            meter.observe_usage(final_usage)
            yield event("metrics", **meter.snapshot())
        except Exception as exc:
            logger.exception("generate stream failed")
            yield streaming.error_event(exc)
        yield DONE

    return streaming.sse_response(generator())


# ── 2. Tokenizer stream ──────────────────────────────────────────────────────

@app.post("/api/stream/tokenize")
async def stream_tokenize(data: dict):
    """Exact Gemini token count, then approximate chips streamed in order."""
    prompt = data.get("prompt", "")

    async def generator() -> AsyncIterator[str]:
        try:
            token_count = await asyncio.to_thread(analysis.count_tokens, prompt)
            chips = analysis.split_display_tokens(prompt)
            yield event("count", token_count=token_count, total_chips=len(chips))

            for index, chip in enumerate(chips):
                yield event("chip", index=index, text=chip)
                # Paced so the chips visibly land one by one rather than in a
                # single frame; short enough not to feel like latency.
                await asyncio.sleep(0.012)

            yield event("complete", token_count=token_count)
        except Exception as exc:
            logger.exception("tokenize stream failed")
            yield streaming.error_event(exc)
        yield DONE

    return streaming.sse_response(generator())


# ── 3. Embedding stream ──────────────────────────────────────────────────────

@app.post("/api/stream/embeddings")
async def stream_embeddings(data: dict):
    """Embed the prompt and every anchor, reporting progress, then PCA to 3D."""
    prompt = data.get("prompt", "")

    async def generator() -> AsyncIterator[str]:
        try:
            total = len(analysis.ANCHORS) + 1
            yield event("start", total=total, anchors_cached=analysis.anchors_are_cached())

            prompt_vector = await asyncio.to_thread(analysis.embed, prompt)
            yield event("progress", label="prompt", completed=1, total=total)

            anchor_vectors = []
            for i, label in enumerate(analysis.ANCHORS):
                vector = await asyncio.to_thread(analysis.anchor_embedding, i)
                anchor_vectors.append(vector)
                yield event("progress", label=label, completed=i + 2, total=total)

            analysis.store_anchor_cache(anchor_vectors)

            projection = await asyncio.to_thread(
                analysis.project_to_3d, prompt_vector, anchor_vectors
            )
            yield event("projection", **projection)
        except Exception as exc:
            logger.exception("embeddings stream failed")
            yield streaming.error_event(exc)
        yield DONE

    return streaming.sse_response(generator())


# ── 4. Attention stream ──────────────────────────────────────────────────────

@app.post("/api/stream/attention")
async def stream_attention(data: dict):
    """Stream generated words alongside their simulated attention over the prompt."""
    prompt = data.get("prompt", "")

    async def generator() -> AsyncIterator[str]:
        try:
            tokens = analysis.prompt_tokens(prompt)
            yield event("tokens", tokens=tokens)

            model = analysis.get_model()
            buffer = ""

            async for chunk in streaming.iter_blocking(
                lambda: model.generate_content(prompt, stream=True)
            ):
                text = analysis.chunk_text(chunk)
                if not text:
                    continue
                buffer += text
                words = buffer.split(" ")
                # Hold the trailing fragment; it may be half a word.
                for word in words[:-1]:
                    if not word.strip():
                        continue
                    yield event(
                        "word",
                        word=word + " ",
                        scores=analysis.compute_attention(word.strip(), tokens),
                    )
                buffer = words[-1]

            if buffer.strip():
                yield event(
                    "word",
                    word=buffer,
                    scores=analysis.compute_attention(buffer.strip(), tokens),
                )
        except Exception as exc:
            logger.exception("attention stream failed")
            yield streaming.error_event(exc)
        yield DONE

    return streaming.sse_response(generator())


# ── 5. Temperature stream ────────────────────────────────────────────────────

@app.post("/api/stream/temperature")
async def stream_temperature(data: dict):
    """Fire three concurrent calls at different temperatures, emitting each as it lands.

    The three requests run in parallel, so the column that finishes first renders
    first rather than all three waiting on the slowest.
    """
    prompt = data.get("prompt", "")

    async def generator() -> AsyncIterator[str]:
        temperatures = analysis.TEMPERATURES
        yield event("start", temperatures=temperatures)

        async def run(temperature: float) -> dict:
            meter = metrics.RequestMeter()
            model = analysis.get_model(temperature=temperature)
            response = await asyncio.to_thread(
                model.generate_content, prompts.confidence_prompt(prompt)
            )
            meter.observe_usage(getattr(response, "usage_metadata", None))
            sentences, scores = analysis.parse_confidence_response(response.text)
            return {
                "temperature": temperature,
                "sentences": sentences,
                "scores": scores,
                "metrics": meter.snapshot(),
            }

        tasks = {asyncio.create_task(run(t)): t for t in temperatures}
        try:
            for finished in asyncio.as_completed(list(tasks)):
                try:
                    yield event("result", **await finished)
                except Exception as exc:
                    logger.exception("temperature branch failed")
                    yield streaming.error_event(exc)
            yield event("complete")
        finally:
            for task in tasks:
                if not task.done():
                    task.cancel()
        yield DONE

    return streaming.sse_response(generator())


# ── 6. Fact-check stream ─────────────────────────────────────────────────────

@app.post("/api/stream/factcheck")
async def stream_factcheck(data: dict):
    """Audit generated text for hallucinations, emitting one claim at a time."""
    response_text = data.get("response_text", "")

    async def generator() -> AsyncIterator[str]:
        try:
            if not response_text.strip():
                yield event("complete", total=0)
                yield DONE
                return

            yield event("start")
            model = analysis.get_model(temperature=0.1)
            response = await asyncio.to_thread(
                model.generate_content, prompts.factcheck_prompt(response_text)
            )
            claims = analysis.parse_claims(response.text)

            for index, claim in enumerate(claims):
                yield event(
                    "claim",
                    index=index,
                    claim=claim.get("claim", ""),
                    verdict=claim.get("verdict", "uncertain"),
                    reason=claim.get("reason", ""),
                )
                await asyncio.sleep(0.15)

            yield event("complete", total=len(claims))
        except Exception as exc:
            logger.exception("factcheck stream failed")
            yield streaming.error_event(exc)
        yield DONE

    return streaming.sse_response(generator())


# ── 7. Chat / context fuel gauge stream ──────────────────────────────────────

@app.post("/api/stream/chat")
async def stream_chat(data: dict):
    """Streamed chat that reports live context consumption, fires SNS threshold
    alerts, and instructs the client to purge the oldest messages at capacity."""
    messages = data.get("messages", [])
    session_id = data.get("session_id")
    # The client tracks how many messages it has already dropped, so a session
    # that has purged before does not re-alert on every subsequent turn.
    already_purged = int(data.get("purged_count", 0))

    async def generator() -> AsyncIterator[str]:
        try:
            if not messages:
                yield event("complete")
                yield DONE
                return

            history = [
                {"role": m["role"], "parts": [m["content"]]} for m in messages[:-1]
            ]
            current_prompt = messages[-1]["content"]

            meter = metrics.RequestMeter()
            conversation_text = " ".join(m["content"] for m in messages)
            meter.input_tokens = await asyncio.to_thread(
                analysis.count_tokens, conversation_text
            )
            yield event("start", input_tokens=meter.input_tokens)

            model = analysis.get_model()
            chat = model.start_chat(history=history)
            reply_parts: list[str] = []
            final_usage = None

            async for chunk in streaming.iter_blocking(
                lambda: chat.send_message(current_prompt, stream=True)
            ):
                if getattr(chunk, "usage_metadata", None):
                    final_usage = chunk.usage_metadata
                text = analysis.chunk_text(chunk)
                if not text:
                    continue
                reply_parts.append(text)
                meter.observe_chunk(text)
                yield event("token", text=text, metrics=meter.snapshot())

            meter.observe_usage(final_usage)

            reply = "".join(reply_parts)
            total_tokens = await asyncio.to_thread(
                analysis.count_tokens, conversation_text + " " + reply
            )
            percent_used = (total_tokens / config.CONTEXT_LIMIT) * 100

            yield event(
                "usage",
                total_tokens=total_tokens,
                context_limit=config.CONTEXT_LIMIT,
                percent_used=round(percent_used, 4),
                threshold_percent=config.PURGE_THRESHOLD * 100,
                **meter.snapshot(),
            )

            if percent_used >= config.PURGE_THRESHOLD * 100:
                # `messages` is already the active slice — the client drops
                # purged turns before sending — so `already_purged` must not be
                # subtracted again here. It is only used to report the running
                # total in the alert.
                active_after_reply = len(messages) + 1
                # Always leave the current exchange intact.
                purgeable = max(0, active_after_reply - 2)
                purge_count = min(config.PURGE_BATCH_SIZE, purgeable)

                alert = await notifications.publish_threshold_alert(
                    percent_used=percent_used,
                    total_tokens=total_tokens,
                    purged=already_purged + purge_count,
                    session_id=session_id,
                )
                yield event(
                    "alert",
                    percent_used=round(percent_used, 4),
                    threshold_percent=config.PURGE_THRESHOLD * 100,
                    **alert,
                )
                if purge_count > 0:
                    yield event("purge", purge_count=purge_count)

            yield event("complete")
        except Exception as exc:
            logger.exception("chat stream failed")
            yield streaming.error_event(exc)
        yield DONE

    return streaming.sse_response(generator())


# ── Static frontend (present in the container image, absent in local dev) ────

if os.path.isdir(config.STATIC_DIR):
    app.mount(
        "/",
        StaticFiles(directory=config.STATIC_DIR, html=True),
        name="static",
    )
else:
    @app.get("/")
    def dev_root():
        return {"status": "running", "note": "frontend served by Vite in dev"}
