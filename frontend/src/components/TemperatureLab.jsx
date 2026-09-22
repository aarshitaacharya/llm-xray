import { useState } from "react";
import { useManualSSE } from "../hooks/useSSE";
import { MONO, disclaimer, emptyState, formatCost } from "../lib/ui";

const ACCENT = "#ffd166";

const TEMP_META = {
  0.1: { label: "CONSERVATIVE", color: "#4D96FF", desc: "safe, predictable, repetitive" },
  0.7: { label: "BALANCED", color: "#06d6a0", desc: "default model behavior" },
  1.5: { label: "CHAOTIC", color: "#ef476f", desc: "creative, risky, unpredictable" },
};

function confidenceColor(score) {
  if (score >= 0.8) return "#06d6a0";
  if (score >= 0.5) return "#ffd166";
  return "#ef476f";
}

function ScoreBar({ score }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "4px" }}>
      <div style={{ flex: 1, height: "3px", background: "#1e1e1e", borderRadius: "2px", overflow: "hidden" }}>
        <div
          style={{
            width: `${score * 100}%`,
            height: "100%",
            background: confidenceColor(score),
            transition: "width 0.6s ease",
          }}
        />
      </div>
      <span style={{ fontFamily: MONO, fontSize: "0.5rem", color: confidenceColor(score), minWidth: "32px" }}>
        {(score * 100).toFixed(0)}%
      </span>
    </div>
  );
}

/** One temperature's column. Renders a pending shell until its call lands. */
function TempColumn({ temperature, result }) {
  const meta = TEMP_META[temperature];
  const scores = result?.scores ?? [];
  const avgScore = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;

  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        background: "#0d0d0d",
        border: `1px solid ${meta.color}33`,
        borderTop: `2px solid ${meta.color}`,
        borderRadius: "4px",
        padding: "0.85rem",
        display: "flex",
        flexDirection: "column",
        gap: "0.6rem",
        opacity: result ? 1 : 0.55,
        transition: "opacity 0.4s ease",
      }}
    >
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontFamily: MONO, fontSize: "0.8rem", fontWeight: 600, color: meta.color }}>
            {meta.label}
          </span>
          <span
            style={{
              fontFamily: MONO,
              fontSize: "0.75rem",
              color: meta.color,
              background: `${meta.color}18`,
              padding: "2px 8px",
              borderRadius: "3px",
              border: `1px solid ${meta.color}44`,
            }}
          >
            T={temperature}
          </span>
        </div>
        <div style={{ fontFamily: MONO, fontSize: "0.7rem", color: "#555", marginTop: "3px" }}>
          {meta.desc}
        </div>

        <div style={{ marginTop: "0.5rem" }}>
          <div style={{ fontFamily: MONO, fontSize: "0.7rem", color: "#666", marginBottom: "3px" }}>
            avg confidence
          </div>
          <ScoreBar score={avgScore} />
        </div>
      </div>

      <div style={{ width: "100%", height: "1px", background: "#1e1e1e" }} />

      {!result ? (
        <div
          style={{
            fontFamily: MONO,
            fontSize: "0.65rem",
            color: meta.color,
            animation: "pulse 1.2s infinite",
            padding: "1rem 0",
          }}
        >
          ● awaiting response…
        </div>
      ) : (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.65rem", overflowY: "auto", maxHeight: "240px" }}>
            {result.sentences.map((sentence, i) => (
              <div key={i}>
                <p style={{ fontFamily: MONO, fontSize: "0.78rem", color: "#ccc", lineHeight: "1.7", margin: 0 }}>
                  {sentence}
                </p>
                <ScoreBar score={result.scores[i] ?? 0.5} />
              </div>
            ))}
          </div>
          {result.metrics && (
            <div style={{ fontFamily: MONO, fontSize: "0.55rem", color: "#444", borderTop: "1px solid #1e1e1e", paddingTop: "0.4rem" }}>
              {result.metrics.output_tokens} tok · {formatCost(result.metrics.cost_usd)}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Panel 5 — the same prompt at three temperatures, run concurrently. */
export default function TemperatureLab({ initialPrompt }) {
  const [customPrompt, setCustomPrompt] = useState("");
  const [temperatures, setTemperatures] = useState([]);
  const [results, setResults] = useState({});
  const [started, setStarted] = useState(false);

  const { run, streaming, error } = useManualSSE("/api/stream/temperature");
  const effectivePrompt = customPrompt.trim() || initialPrompt;

  const handleRun = () => {
    if (!effectivePrompt || streaming) return;
    setStarted(true);
    setResults({});
    setTemperatures([]);

    run({ prompt: effectivePrompt }, (evt) => {
      if (evt.type === "start") {
        setTemperatures(evt.temperatures);
      } else if (evt.type === "result") {
        // Columns fill in completion order, not temperature order.
        setResults((prev) => ({ ...prev, [evt.temperature]: evt }));
      }
    });
  };

  const pending = temperatures.filter((t) => !results[t]).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", height: "100%" }}>
      <p style={disclaimer(ACCENT)}>
        Same prompt, three temperatures, fired as three concurrent inference
        calls — each column renders the moment its own call returns. Confidence
        scores are{" "}
        <span style={{ color: ACCENT }}>self-reported by the model</span>: a useful
        signal, not ground truth. Higher temperature means more variance.
      </p>

      <div style={{ display: "flex", gap: "0.5rem", alignItems: "start" }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: MONO, fontSize: "0.55rem", color: "#888", marginBottom: "0.35rem" }}>
            CUSTOM PROMPT (leave blank to use main prompt)
          </div>
          <textarea
            rows={2}
            value={customPrompt}
            onChange={(e) => setCustomPrompt(e.target.value)}
            placeholder={initialPrompt || "Enter a prompt..."}
            style={{
              width: "100%",
              background: "#0d0d0d",
              border: "1px solid #2a2a2a",
              borderRadius: "4px",
              padding: "0.6rem",
              color: "#e8e6e3",
              fontSize: "0.75rem",
              fontFamily: MONO,
              resize: "none",
              outline: "none",
            }}
            onFocus={(e) => (e.target.style.borderColor = ACCENT)}
            onBlur={(e) => (e.target.style.borderColor = "#2a2a2a")}
          />
        </div>
        <button
          onClick={handleRun}
          disabled={streaming || !effectivePrompt}
          style={{
            marginTop: "1.35rem",
            padding: "0.55rem 1rem",
            background: streaming || !effectivePrompt ? "#1a1a1a" : ACCENT,
            color: streaming || !effectivePrompt ? "#555" : "#0d0d0d",
            border: "none",
            borderRadius: "4px",
            cursor: streaming || !effectivePrompt ? "not-allowed" : "pointer",
            fontSize: "0.6rem",
            fontFamily: MONO,
            fontWeight: 600,
            whiteSpace: "nowrap",
          }}
        >
          {streaming ? "RUNNING..." : "RUN LAB →"}
        </button>
      </div>

      {streaming && (
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontFamily: MONO, fontSize: "0.6rem", color: "#555" }}>
          <span style={{ color: ACCENT }}>●</span>
          {temperatures.length
            ? `${temperatures.length - pending}/${temperatures.length} calls returned`
            : "firing 3 parallel Gemini calls…"}
        </div>
      )}

      {error && (
        <div style={{ fontFamily: MONO, fontSize: "0.65rem", color: "#ef476f" }}>
          stream error: {error}
        </div>
      )}

      {temperatures.length > 0 ? (
        <div style={{ display: "flex", gap: "0.75rem", flex: 1 }}>
          {temperatures.map((t) => (
            <TempColumn key={t} temperature={t} result={results[t]} />
          ))}
        </div>
      ) : (
        !started && <div style={emptyState}>hit RUN LAB to compare temperatures</div>
      )}

      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }`}</style>
    </div>
  );
}
