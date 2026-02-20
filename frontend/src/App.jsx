import { useState } from "react";
import axios from "axios";
import TokenHighlighter from "./components/TokenHighlighter";

export default function App() {
  const [prompt, setPrompt] = useState("");
  const [response, setResponse] = useState("");
  const [tokens, setTokens] = useState([]);
  const [tokenCount, setTokenCount] = useState(0);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!prompt.trim()) return;
    setLoading(true);
    const [genRes, tokenRes] = await Promise.all([
      axios.post("/api/generate", { prompt }),
      axios.post("/api/tokenize", { prompt }),
    ]);
    setResponse(genRes.data.text);
    setTokens(tokenRes.data.tokens);
    setTokenCount(tokenRes.data.token_count);
    setLoading(false);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh"}}>

      {/* ── Top Bar ── */}
      <header style={{
        borderBottom: "1px solid #222",
        padding: "0.75rem 1.5rem",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        background: "#111",
        position: "sticky",
        top: 0,
        zIndex: 100,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <span style={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: "1rem",
            fontWeight: 600,
            color: "#ff6b35",
          }}>
            // LLM X-RAY
          </span>
          <span style={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: "0.6rem",
            color: "#555",
            borderLeft: "1px solid #333",
            paddingLeft: "0.75rem",
          }}>
            visual debugger
          </span>
        </div>
        <div style={{
          width: "8px", height: "8px", borderRadius: "50%",
          background: loading ? "#ffd166" : "#06d6a0",
          boxShadow: loading ? "0 0 6px #ffd166" : "0 0 6px #06d6a0",
          transition: "all 0.3s",
        }} />
      </header>

      {/* ── Main Layout ── */}
      <div style={{ display: "flex", flex: 1 }}>

        {/* ── Left Sidebar: Input ── */}
        <aside style={{
          width: "320px",
          minWidth: "320px",
          borderRight: "1px solid #222",
          padding: "1.25rem",
          display: "flex",
          flexDirection: "column",
          gap: "1rem",
          background: "#111",
        }}>
          <Label>PROMPT INPUT</Label>
          <textarea
            rows={8}
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            placeholder="Enter a prompt to analyze..."
            style={{
              width: "100%",
              background: "#0d0d0d",
              border: "1px solid #2a2a2a",
              borderRadius: "4px",
              padding: "0.85rem",
              color: "#e8e6e3",
              fontSize: "0.85rem",
              fontFamily: "'IBM Plex Mono', monospace",
              resize: "vertical",
              outline: "none",
              lineHeight: "1.7",
              transition: "border-color 0.2s",
            }}
            onFocus={e => e.target.style.borderColor = "#ff6b35"}
            onBlur={e => e.target.style.borderColor = "#2a2a2a"}
          />

          <button
            onClick={handleSubmit}
            disabled={loading}
            style={{
              padding: "0.7rem",
              background: loading ? "#1a1a1a" : "#ff6b35",
              color: loading ? "#555" : "#0d0d0d",
              border: "1px solid " + (loading ? "#2a2a2a" : "#ff6b35"),
              borderRadius: "4px",
              cursor: loading ? "not-allowed" : "pointer",
              fontSize: "0.7rem",
              fontFamily: "'IBM Plex Mono', monospace",
              fontWeight: 600,
              letterSpacing: "0.08em",
              transition: "all 0.2s",
            }}
          >
            {loading ? "ANALYZING..." : "RUN ANALYSIS →"}
          </button>

          {/* Model output lives in the sidebar too */}
          {response && (
            <div style={{ marginTop: "0.5rem" }}>
              <Label>MODEL OUTPUT</Label>
              <div style={{
                background: "#0d0d0d",
                border: "1px solid #2a2a2a",
                borderRadius: "4px",
                padding: "0.85rem",
                fontSize: "0.8rem",
                lineHeight: "1.8",
                color: "#c8c4be",
                whiteSpace: "pre-wrap",
                fontFamily: "'IBM Plex Mono', monospace",
                maxHeight: "340px",
                overflowY: "auto",
              }}>
                {response}
              </div>
            </div>
          )}
        </aside>

        {/* ── Dashboard Grid ── */}
        <main style={{
          flex: 1,
          padding: "1.25rem",
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gridTemplateRows: "auto auto auto",
          gap: "1rem",
          alignContent: "start",
        }}>

          {/* Panel 1 — Tokens */}
          <Panel title="TOKENIZER" tag="part 2" accent="#ff6b35" span={2}>
            <TokenHighlighter tokens={tokens} tokenCount={tokenCount} />
          </Panel>

          {/* Panel 2 — Embeddings (coming soon) */}
          <Panel title="EMBEDDING STAR MAP" tag="part 3" accent="#4D96FF" locked />

          {/* Panel 3 — Attention (coming soon) */}
          <Panel title="ATTENTION VIEW" tag="part 4" accent="#c77dff" locked />

          {/* Panel 4 — Temperature Lab (coming soon) */}
          <Panel title="PROBABILITY LAB" tag="part 5" accent="#ffd166" locked />

          {/* Panel 5 — Hallucination (coming soon) */}
          <Panel title="FACT-CHECK" tag="part 6" accent="#ef476f" locked />

          {/* Panel 6 — Context Window (coming soon) */}
          <Panel title="CONTEXT FUEL GAUGE" tag="part 7" accent="#06d6a0" locked />

        </main>
      </div>
    </div>
  );
}

// ── Reusable Panel shell ──
function Panel({ title, tag, accent, children, locked = false, span = 1 }) {
  return (
    <div style={{
      background: "#111",
      border: `1px solid ${locked ? "#1e1e1e" : "#2a2a2a"}`,
      borderTop: `2px solid ${locked ? "#222" : accent}`,
      borderRadius: "4px",
      padding: "1rem",
      gridColumn: span === 2 ? "span 2" : "span 1",
      minHeight: "160px",
      display: "flex",
      flexDirection: "column",
      opacity: locked ? 0.5 : 1,
    }}>
      {/* Panel header */}
      <div style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: locked ? 0 : "0.85rem",
      }}>
        <span style={{
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: "0.6rem",
          fontWeight: 600,
          color: locked ? "#444" : accent,
          letterSpacing: "0.1em",
        }}>
          {title}
        </span>
        <span style={{
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: "0.55rem",
          color: "#444",
          background: "#1a1a1a",
          padding: "0.15rem 0.5rem",
          borderRadius: "3px",
        }}>
          {tag}
        </span>
      </div>

      {locked ? (
        <div style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: "0.6rem",
          color: "#333",
          letterSpacing: "0.1em",
        }}>
          [ COMING SOON ]
        </div>
      ) : (
        <div style={{ flex: 1 }}>{children}</div>
      )}
    </div>
  );
}

// ── Reusable label ──
function Label({ children }) {
  return (
    <span style={{
      fontFamily: "'IBM Plex Mono', monospace",
      fontSize: "0.6rem",
      color: "#888",
      letterSpacing: "0.1em",
      display: "block",
    }}>
      {children}
    </span>
  );
}