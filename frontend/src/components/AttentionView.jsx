import { useEffect, useRef, useState } from "react";
import { useSSE } from "../hooks/useSSE";
import { MONO, disclaimer, emptyState, sectionLabel, surface } from "../lib/ui";

const ACCENT = "#c77dff";

/** Maps a 0–1 attention score to a purple heat colour. */
const heat = (score) => {
  // Scores are normalised across the whole prompt, so a "hot" token is often
  // well under 0.25. Amplify before mapping or the map reads as uniformly cold.
  const intensity = Math.min(1, score * 4);
  return {
    bg: `rgba(${Math.round(80 + intensity * 120)},${Math.round(20 + intensity * 20)},${Math.round(180 + intensity * 75)},${0.15 + intensity * 0.75})`,
    intensity,
  };
};

/** Panel 4 — simulated attention from each generated word back onto the prompt. */
export default function AttentionView({ prompt, runId }) {
  const [words, setWords] = useState([]);
  const [tokens, setTokens] = useState([]);
  const [activeScores, setActiveScores] = useState([]);
  const [activeIdx, setActiveIdx] = useState(null);
  const wordsRef = useRef([]);
  const bottomRef = useRef(null);

  const { streaming, error } = useSSE({
    url: "/api/stream/attention",
    enabled: Boolean(prompt) && runId > 0,
    trigger: runId,
    getBody: () => ({ prompt }),
    onStart: () => {
      wordsRef.current = [];
      setWords([]);
      setTokens([]);
      setActiveScores([]);
      setActiveIdx(null);
    },
    onEvent: (evt) => {
      if (evt.type === "tokens") {
        setTokens(evt.tokens);
      } else if (evt.type === "word") {
        wordsRef.current = [...wordsRef.current, { word: evt.word, scores: evt.scores }];
        setWords(wordsRef.current);
        setActiveIdx(wordsRef.current.length - 1);
        setActiveScores(evt.scores);
      }
    },
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [words]);

  if (!prompt) return <div style={emptyState}>run a prompt to see simulated attention</div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.85rem", height: "100%" }}>
      <p style={disclaimer(ACCENT)}>
        Gemini's internal attention weights are proprietary and not exposed. This
        panel shows a <span style={{ color: ACCENT }}>simulated attention view</span>{" "}
        that approximates which input tokens each output word relates to, using
        character n-gram similarity. Hover any word in the response to freeze and
        explore its pattern.
      </p>

      <div>
        <div style={sectionLabel}>PROMPT — attention heat map</div>
        <div style={{ ...surface, display: "flex", flexWrap: "wrap", gap: "5px" }}>
          {tokens.length === 0 ? (
            <span style={{ fontFamily: MONO, fontSize: "0.65rem", color: "#333" }}>
              waiting...
            </span>
          ) : (
            tokens.map((token, i) => {
              const { bg, intensity } = heat(activeScores[i] ?? 0);
              return (
                <span
                  key={i}
                  style={{
                    fontFamily: MONO,
                    fontSize: "0.75rem",
                    padding: "3px 8px",
                    borderRadius: "3px",
                    background: bg,
                    color: intensity > 0.5 ? "#fff" : "#aaa",
                    border: `1px solid rgba(180,80,255,${intensity * 0.6})`,
                    transition: "background 0.3s, color 0.3s",
                  }}
                >
                  {token}
                </span>
              );
            })
          )}
        </div>
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
        <div style={sectionLabel}>
          RESPONSE {streaming && <span style={{ color: ACCENT }}>● streaming</span>}
        </div>
        <div
          style={{
            ...surface,
            flex: 1,
            overflowY: "auto",
            maxHeight: "200px",
            display: "flex",
            flexWrap: "wrap",
            gap: "3px",
            alignContent: "start",
          }}
        >
          {words.map(({ word, scores }, i) => (
            <span
              key={i}
              onMouseEnter={() => {
                setActiveIdx(i);
                setActiveScores(scores);
              }}
              onMouseLeave={() => {
                const last = wordsRef.current[wordsRef.current.length - 1];
                setActiveScores(last?.scores ?? []);
                setActiveIdx(wordsRef.current.length - 1);
              }}
              style={{
                fontFamily: MONO,
                fontSize: "0.75rem",
                color: i === activeIdx ? ACCENT : "#ccc",
                cursor: "default",
                padding: "1px 2px",
                borderRadius: "2px",
                background: i === activeIdx ? `${ACCENT}18` : "transparent",
                transition: "color 0.15s",
                whiteSpace: "pre",
              }}
            >
              {word}
            </span>
          ))}
          {streaming && (
            <span style={{ fontFamily: MONO, fontSize: "0.75rem", color: ACCENT, animation: "blink 1s infinite" }}>
              ▌
            </span>
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
