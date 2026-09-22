import { useEffect, useRef, useState } from "react";
import { useSSE } from "../hooks/useSSE";
import StatTile from "./StatTile";
import {
  MONO,
  disclaimer,
  emptyState,
  formatCost,
  formatTokensPerSecond,
  sectionLabel,
  surface,
} from "../lib/ui";

const ACCENT = "#ff9f1c";

/**
 * Panel 2 — the raw generation stream, with live throughput and cost.
 *
 * Also the source of truth for the response text: the fact-check panel audits
 * whatever this panel finishes producing.
 */
export default function GenerationStream({ prompt, runId, onComplete }) {
  const [text, setText] = useState("");
  const [stats, setStats] = useState(null);
  const bottomRef = useRef(null);
  const textRef = useRef("");

  const { streaming, error } = useSSE({
    url: "/api/stream/generate",
    enabled: Boolean(prompt) && runId > 0,
    trigger: runId,
    getBody: () => ({ prompt }),
    onStart: () => {
      textRef.current = "";
      setText("");
      setStats(null);
    },
    onEvent: (evt) => {
      if (evt.type === "start") {
        setStats({ input_tokens: evt.input_tokens, output_tokens: 0 });
      } else if (evt.type === "token") {
        textRef.current += evt.text;
        setText(textRef.current);
        setStats(evt.metrics);
      } else if (evt.type === "metrics") {
        setStats(evt);
        onComplete?.(textRef.current);
      }
    },
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [text]);

  if (!prompt) {
    return <div style={emptyState}>run a prompt to stream a response</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.85rem", height: "100%" }}>
      <p style={disclaimer(ACCENT)}>
        The response is streamed over{" "}
        <span style={{ color: ACCENT }}>server-sent events</span>, one chunk at a
        time, exactly as the model emits it. Throughput and cost update live;
        the final figures use Gemini's own reported token usage rather than an
        estimate.
      </p>

      {stats && (
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <StatTile label="INPUT TOK" value={(stats.input_tokens ?? 0).toLocaleString()} color="#4D96FF" />
          <StatTile label="OUTPUT TOK" value={(stats.output_tokens ?? 0).toLocaleString()} color={ACCENT} />
          <StatTile label="TOKENS/SEC" value={formatTokensPerSecond(stats.tokens_per_second)} color="#06d6a0" />
          <StatTile label="COST/REQ" value={formatCost(stats.cost_usd)} color="#ffd166" />
        </div>
      )}

      <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
        <div style={sectionLabel}>
          OUTPUT {streaming && <span style={{ color: ACCENT }}>● streaming</span>}
        </div>
        <div
          style={{
            ...surface,
            flex: 1,
            overflowY: "auto",
            maxHeight: "220px",
            fontFamily: MONO,
            fontSize: "0.78rem",
            lineHeight: "1.8",
            color: "#ccc",
            whiteSpace: "pre-wrap",
          }}
        >
          {text}
          {streaming && (
            <span style={{ color: ACCENT, animation: "blink 1s infinite" }}>▌</span>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      {error && (
        <div style={{ fontFamily: MONO, fontSize: "0.65rem", color: "#ef476f" }}>
          stream error: {error}
        </div>
      )}

      <style>{`@keyframes blink { 0%,100% { opacity:1 } 50% { opacity:0 } }`}</style>
    </div>
  );
}
