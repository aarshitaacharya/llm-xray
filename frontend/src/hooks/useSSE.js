import { useCallback, useEffect, useRef, useState } from "react";
import { streamSSE } from "../lib/sse";

/**
 * Opens an SSE stream whenever `trigger` changes while `enabled` is true.
 *
 * Handlers are held in refs so a component can close over fresh state without
 * the effect tearing down and restarting the stream on every render.
 */
export function useSSE({ url, getBody, enabled, trigger, onEvent, onStart }) {
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState(null);

  const handlers = useRef({ getBody, onEvent, onStart });

  // Declared before the stream effect so the refs hold this render's handlers
  // by the time the stream below (re)starts in the same commit.
  useEffect(() => {
    handlers.current = { getBody, onEvent, onStart };
  });

  useEffect(() => {
    if (!enabled) return undefined;

    const controller = new AbortController();
    let cancelled = false;

    // The first state update is deferred by a microtask so it lands outside the
    // effect body rather than cascading a synchronous re-render. It still
    // flushes before paint, so nothing stale is visible.
    const run = async () => {
      await Promise.resolve();
      if (cancelled) return;

      setStreaming(true);
      setError(null);
      handlers.current.onStart?.();

      try {
        await streamSSE(
          url,
          handlers.current.getBody?.() ?? {},
          (evt) => {
            if (cancelled) return;
            if (evt.type === "error") {
              setError(evt.message);
              return;
            }
            handlers.current.onEvent?.(evt);
          },
          controller.signal,
        );
      } catch (err) {
        if (!cancelled && err.name !== "AbortError") setError(err.message);
      } finally {
        if (!cancelled) setStreaming(false);
      }
    };

    run();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [url, enabled, trigger]);

  return { streaming, error };
}

/**
 * Same transport, but fired imperatively — for panels driven by a button or a
 * chat box rather than by the global "run analysis" trigger.
 */
export function useManualSSE(url) {
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState(null);
  const controllerRef = useRef(null);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const run = useCallback(
    async (body, onEvent) => {
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;

      setStreaming(true);
      setError(null);
      try {
        await streamSSE(
          url,
          body,
          (evt) => {
            if (evt.type === "error") {
              setError(evt.message);
              return;
            }
            onEvent(evt);
          },
          controller.signal,
        );
      } catch (err) {
        if (err.name !== "AbortError") setError(err.message);
      } finally {
        if (controllerRef.current === controller) setStreaming(false);
      }
    },
    [url],
  );

  return { run, streaming, error };
}
