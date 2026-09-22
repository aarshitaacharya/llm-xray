import { useRef, useState } from "react";
import { useSSE } from "../hooks/useSSE";
import { MONO, disclaimer, emptyState } from "../lib/ui";

const ACCENT = "#ff6b35";

const COLORS = [
  "#ff6b35", "#ffd166", "#06d6a0", "#4D96FF",
  "#c77dff", "#ef476f", "#00C9A7", "#f7c59f",
];

/** Panel 1 — exact token count from Gemini, chips streamed in as they parse. */
export default function TokenHighlighter({ prompt, runId }) {
  const [chips, setChips] = useState([]);
  const [tokenCount, setTokenCount] = useState(0);
  const chipsRef = useRef([]);

  const { streaming, error } = useSSE({
    url: "/api/stream/tokenize",
    enabled: Boolean(prompt) && runId > 0,
    trigger: runId,
    getBody: () => ({ prompt }),
    onStart: () => {
      chipsRef.current = [];
      setChips([]);
      setTokenCount(0);
    },
    onEvent: (evt) => {
      if (evt.type === "count") {
        setTokenCount(evt.token_count);
      } else if (evt.type === "chip") {
        chipsRef.current = [...chipsRef.current, evt.text];
        setChips(chipsRef.current);
      }
    },
  });

  if (!prompt) return <div style={emptyState}>run a prompt to see tokens</div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      <div style={{ display: "flex", alignItems: "start", justifyContent: "space-between", gap: "1rem" }}>
        <p style={disclaimer(ACCENT)}>
          Tokenization breaks text into the small pieces (“tokens”) a language
          model actually reads. The count is the true Gemini token cost for this
          prompt. The colored blocks are a visual approximation — Gemini does not
          expose its exact token boundaries, so the chips may not align with them.
        </p>
        <span
          style={{
            fontFamily: MONO,
            fontSize: "0.8rem",
            color: ACCENT,
            background: "#1a0a00",
            border: "1px solid #3a1a00",
            padding: "0.2rem 0.6rem",
            borderRadius: "3px",
            whiteSpace: "nowrap",
          }}
        >
          {tokenCount} tokens
        </span>
      </div>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "5px",
          background: "#0d0d0d",
          border: "1px solid #1e1e1e",
          borderRadius: "4px",
          padding: "0.85rem",
          minHeight: "44px",
          alignItems: "flex-start",
        }}
      >
        {chips.map((token, i) => {
          if (/^\s+$/.test(token)) return <span key={i} style={{ width: "6px" }} />;
          const color = COLORS[i % COLORS.length];
          return (
            <span
              key={i}
              title={`~Token ${i + 1}: "${token}" (approximate)`}
              style={{
                color,
                border: `1px solid ${color}66`,
                background: `${color}18`,
                padding: "3px 10px",
                borderRadius: "3px",
                fontSize: "0.75rem",
                fontFamily: MONO,
                cursor: "default",
                display: "inline-block",
                transition: "transform 0.1s, background 0.1s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = "translateY(-2px)";
                e.currentTarget.style.background = `${color}30`;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = "translateY(0)";
                e.currentTarget.style.background = `${color}18`;
              }}
            >
              {token}
            </span>
          );
        })}
        {streaming && (
          <span style={{ fontFamily: MONO, fontSize: "0.7rem", color: ACCENT }}>▌</span>
        )}
      </div>

      {error && (
        <div style={{ fontFamily: MONO, fontSize: "0.65rem", color: "#ef476f" }}>
          stream error: {error}
        </div>
      )}
    </div>
  );
}
