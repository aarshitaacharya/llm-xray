import { useState } from "react";
import axios from "axios";

const TEMP_META = {
  0.1: { label: "CONSERVATIVE", color: "#4D96FF", desc: "safe, predictable, repetitive" },
  0.7: { label: "BALANCED",     color: "#06d6a0", desc: "default model behavior" },
  1.5: { label: "CHAOTIC",      color: "#ef476f", desc: "creative, risky, unpredictable" },
};

function confidenceColor(score) {
  if (score >= 0.8) return "#06d6a0";
  if (score >= 0.5) return "#ffd166";
  return "#ef476f";
}

function ScoreBar({ score }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "4px" }}>
      <div style={{
        flex: 1, height: "3px", background: "#1e1e1e", borderRadius: "2px", overflow: "hidden",
      }}>
        <div style={{
          width: `${score * 100}%`,
          height: "100%",
          background: confidenceColor(score),
          transition: "width 0.6s ease",
        }} />
      </div>
      <span style={{
        fontFamily: "'IBM Plex Mono', monospace",
        fontSize: "0.5rem",
        color: confidenceColor(score),
        minWidth: "32px",
      }}>
        {(score * 100).toFixed(0)}%
      </span>
    </div>
  );
}

function TempColumn({ result }) {
  if (!result) return null;
  const { temperature, sentences, scores } = result;
  const meta = TEMP_META[temperature];
  const avgScore = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;

  return (
    <div style={{
      flex: 1,
      background: "#0d0d0d",
      border: `1px solid ${meta.color}33`,
      borderTop: `2px solid ${meta.color}`,
      borderRadius: "4px",
      padding: "0.85rem",
      display: "flex",
      flexDirection: "column",
      gap: "0.6rem",
    }}>
      {/* Column header */}
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: "0.85rem", fontWeight: 600,
            color: meta.color,
          }}>
            {meta.label}
          </span>
          <span style={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: "0.85rem",
            color: meta.color,
            background: `${meta.color}18`,
            padding: "2px 8px",
            borderRadius: "3px",
            border: `1px solid ${meta.color}44`,
          }}>
            T={temperature}
          </span>
        </div>
        <div style={{
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: "0.85rem", color: "#555", marginTop: "3px",
        }}>
          {meta.desc}
        </div>

        {/* Avg confidence */}
        <div style={{ marginTop: "0.5rem" }}>
          <div style={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: "0.85rem", color: "#666", marginBottom: "3px",
          }}>
            avg confidence
          </div>
          <ScoreBar score={avgScore} />
        </div>
      </div>

      <div style={{ width: "100%", height: "1px", background: "#1e1e1e" }} />

      {/* Sentences with scores */}
      <div style={{ display: "flex", flexDirection: "column", gap: "0.65rem", overflowY: "auto", maxHeight: "260px" }}>
        {sentences.map((sentence, i) => (
          <div key={i}>
            <p style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: "0.8rem",
              color: "#ccc",
              lineHeight: "1.7",
              margin: 0,
            }}>
              {sentence}
            </p>
            <ScoreBar score={scores[i] ?? 0.5} />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function TemperatureLab({ initialPrompt }) {
  const [prompt, setPrompt] = useState("");
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);

  const effectivePrompt = prompt.trim() || initialPrompt;

  const handleRun = async () => {
    if (!effectivePrompt) return;
    setLoading(true);
    setResults(null);
    try {
      const res = await axios.post("/api/temperature-lab", { prompt: effectivePrompt });
      setResults(res.data.results);
    } catch (err) {
      console.error("Temperature lab failed:", err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", height: "100%" }}>

      {/* Disclaimer */}
      <p style={{
        fontFamily: "'IBM Plex Mono', monospace", fontSize: "0.85rem",
        color: "#aaa", borderLeft: "2px solid #ffd166",
        paddingLeft: "0.6rem", lineHeight: "1.7",
      }}>
        Same prompt, 3 temperatures. Confidence scores are{" "}
        <span style={{ color: "#ffd166" }}>self-reported by the model</span> — a useful
        signal, not ground truth. High temp = more variance in scores.
      </p>

      {/* Optional custom prompt */}
      <div style={{ display: "flex", gap: "0.5rem", alignItems: "start" }}>
        <div style={{ flex: 1 }}>
          <div style={{
            fontFamily: "'IBM Plex Mono', monospace", fontSize: "0.55rem",
            color: "#888", marginBottom: "0.35rem",
          }}>
            CUSTOM PROMPT (leave blank to use main prompt)
          </div>
          <textarea
            rows={2}
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            placeholder={initialPrompt || "Enter a prompt..."}
            style={{
              width: "100%",
              background: "#0d0d0d",
              border: "1px solid #2a2a2a",
              borderRadius: "4px",
              padding: "0.6rem",
              color: "#e8e6e3",
              fontSize: "0.75rem",
              fontFamily: "'IBM Plex Mono', monospace",
              resize: "none",
              outline: "none",
            }}
            onFocus={e => e.target.style.borderColor = "#ffd166"}
            onBlur={e => e.target.style.borderColor = "#2a2a2a"}
          />
        </div>
        <button
          onClick={handleRun}
          disabled={loading || !effectivePrompt}
          style={{
            marginTop: "1.35rem",
            padding: "0.55rem 1rem",
            background: loading ? "#1a1a1a" : "#ffd166",
            color: loading ? "#555" : "#0d0d0d",
            border: "none", borderRadius: "4px",
            cursor: loading ? "not-allowed" : "pointer",
            fontSize: "0.6rem",
            fontFamily: "'IBM Plex Mono', monospace",
            fontWeight: 600, whiteSpace: "nowrap",
          }}
        >
          {loading ? "RUNNING..." : "RUN LAB →"}
        </button>
      </div>

      {/* Loading state */}
      {loading && (
        <div style={{
          display: "flex", alignItems: "center", gap: "0.5rem",
          fontFamily: "'IBM Plex Mono', monospace", fontSize: "0.6rem", color: "#555",
        }}>
          <span style={{ color: "#ffd166" }}>●</span>
          firing 3 parallel Gemini calls at different temperatures...
        </div>
      )}

      {/* Three columns */}
      {results && (
        <div style={{ display: "flex", gap: "0.75rem", flex: 1 }}>
          {results.map(result => (
            <TempColumn key={result.temperature} result={result} />
          ))}
        </div>
      )}

      {!results && !loading && (
        <div style={{
          flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
          fontFamily: "'IBM Plex Mono', monospace", fontSize: "0.6rem", color: "#333",
        }}>
          hit RUN LAB to compare temperatures
        </div>
      )}
    </div>
  );
}