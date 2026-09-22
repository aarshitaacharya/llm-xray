/**
 * Minimal SSE client for the backend's seven streaming endpoints.
 *
 * EventSource only speaks GET, and every panel posts a JSON body, so this reads
 * the fetch response body directly and parses the same `data: {...}` frames.
 */
export async function streamSSE(url, body, onEvent, signal) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
    signal,
  });

  if (!res.ok) throw new Error(`${url} responded ${res.status}`);
  if (!res.body) throw new Error(`${url} returned no body`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      // The last element is whatever arrived after the final newline; it may be
      // a partial frame, so it stays in the buffer until more bytes land.
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const raw = line.slice(6).trim();
        if (!raw) continue;
        if (raw === "[DONE]") return;

        try {
          onEvent(JSON.parse(raw));
        } catch {
          console.warn("Discarded malformed SSE frame:", raw.slice(0, 120));
        }
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }
}
