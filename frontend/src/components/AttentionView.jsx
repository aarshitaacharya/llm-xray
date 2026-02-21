import { useEffect, useRef, useState } from "react";

const HEAT = (score) => {
  // Map 0–1 score to a color from dark → vivid purple
  const intensity = Math.min(1, score * 4); // amplify low scores
  const r = Math.round(80 + intensity * 120);
  const g = Math.round(20 + intensity * 20);
  const b = Math.round(180 + intensity * 75);
  const alpha = 0.15 + intensity * 0.75;
  return { bg: `rgba(${r},${g},${b},${alpha})`, intensity };
};

export default function AttentionView({ prompt, isAnalyzing }) {
  const [responseWords, setResponseWords] = useState([]);
  const [promptTokens, setPromptTokens] = useState([]);
  const [activeScores, setActiveScores] = useState([]);
  const [activeWordIdx, setActiveWordIdx] = useState(null);
  const [streaming, setStreaming] = useState(false);
  const esRef = useRef(null);
  const bottomRef = useRef(null);

  useEffect(() => {
    if (!isAnalyzing || !prompt) return;

    setResponseWords([]);
    setPromptTokens([]);
    setActiveScores([]);
    setActiveWordIdx(null);
    setStreaming(true);

    if (esRef.current) esRef.current.close();

    const ctrl = new AbortController();

    const run = async () => {
      try {
        const res = await fetch("/api/attention-stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt }),
          signal: ctrl.signal,
        });

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        const accumulated = []; // local only, never triggers renders

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop();

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const raw = line.slice(6).trim();
            if (raw === "[DONE]") break;

            try {
              const { word, scores, tokens } = JSON.parse(raw);
              accumulated.push({ word, scores });

              // Single setState call per chunk — no cascading
              const snapshot = [...accumulated];
              const lastScores = scores;
              const lastIdx = snapshot.length - 1;
              const currentTokens = tokens;

              setPromptTokens(currentTokens);
              setResponseWords(snapshot);
              setActiveWordIdx(lastIdx);
              setActiveScores(lastScores);

            } catch (err) {
              console.warn("Failed to parse SSE chunk:", err.message);
            }
          }
        }
      } catch (err) {
        if (err.name !== "AbortError") {
          console.error("Attention stream failed:", err.message);
        }
      } finally {
        setStreaming(false);
      }
    };

    run();
    return () => ctrl.abort();
  }, [isAnalyzing, prompt]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [responseWords]);

  if (!prompt) return (
    <div style={emptyStyle}>run a prompt to see simulated attention</div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.85rem", height: "100%" }}>

      {/* Disclaimer */}
      <p style={{
        fontFamily: "'IBM Plex Mono', monospace", fontSize: "0.85rem",
        color: "#aaa", borderLeft: "2px solid #c77dff",
        paddingLeft: "0.6rem", lineHeight: "1.7",
      }}>
        Gemini’s internal attention weights are proprietary and not exposed.  
  This panel shows a <span style={{ color: "#c77dff" }}>simulated attention view </span>  
  that approximates which input tokens the model might focus on, using n-gram similarity between the input and output.  
  Hover over any word in the response to freeze and explore its attention pattern, helping you understand the model’s token-level reasoning.
      </p>

      {/* Prompt tokens with heat overlay */}
      <div>
        <div style={sectionLabel}>PROMPT — attention heat map</div>
        <div style={{
          background: "#0d0d0d", border: "1px solid #1e1e1e",
          borderRadius: "4px", padding: "0.75rem",
          display: "flex", flexWrap: "wrap", gap: "5px",
        }}>
          {promptTokens.length === 0 ? (
            <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: "0.65rem", color: "#333" }}>
              waiting...
            </span>
          ) : promptTokens.map((token, i) => {
            const score = activeScores[i] ?? 0;
            const { bg, intensity } = HEAT(score);
            return (
              <span key={i} style={{
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: "0.75rem",
                padding: "3px 8px",
                borderRadius: "3px",
                background: bg,
                color: intensity > 0.5 ? "#fff" : "#aaa",
                border: `1px solid rgba(180,80,255,${intensity * 0.6})`,
                transition: "background 0.3s, color 0.3s",
              }}>
                {token}
              </span>
            );
          })}
        </div>
      </div>

      {/* Streaming response */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        <div style={sectionLabel}>
          RESPONSE — {streaming && <span style={{ color: "#c77dff" }}>● streaming</span>}
        </div>
        <div style={{
          background: "#0d0d0d", border: "1px solid #1e1e1e",
          borderRadius: "4px", padding: "0.75rem",
          flex: 1, overflowY: "auto", maxHeight: "200px",
          display: "flex", flexWrap: "wrap", gap: "3px", alignContent: "start",
        }}>
          {responseWords.map(({ word, scores }, i) => (
            <span
              key={i}
              onMouseEnter={() => { setActiveWordIdx(i); setActiveScores(scores); }}
              onMouseLeave={() => {
                const last = responseWords[responseWords.length - 1];
                setActiveScores(last?.scores ?? []);
                setActiveWordIdx(responseWords.length - 1);
              }}
              style={{
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: "0.75rem",
                color: i === activeWordIdx ? "#c77dff" : "#ccc",
                cursor: "default",
                padding: "1px 2px",
                borderRadius: "2px",
                background: i === activeWordIdx ? "#c77dff18" : "transparent",
                transition: "color 0.15s",
                whiteSpace: "pre",
              }}
            >
              {word}
            </span>
          ))}
          {streaming && (
            <span style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: "0.75rem", color: "#c77dff",
              animation: "blink 1s infinite",
            }}>▌</span>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      <style>{`@keyframes blink { 0%,100% { opacity:1 } 50% { opacity:0 } }`}</style>
    </div>
  );
}

const emptyStyle = {
  flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
  fontFamily: "'IBM Plex Mono', monospace", fontSize: "0.6rem", color: "#333",
};

const sectionLabel = {
  fontFamily: "'IBM Plex Mono', monospace", fontSize: "0.55rem",
  color: "#888", letterSpacing: "0.08em", marginBottom: "0.4rem",
};