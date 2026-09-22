import { useEffect, useState } from "react";
import TokenHighlighter from "./components/TokenHighlighter";
import GenerationStream from "./components/GenerationStream";
import EmbeddingStarMap from "./components/EmbeddingStarMap";
import AttentionView from "./components/AttentionView";
import TemperatureLab from "./components/TemperatureLab";
import FactCheck from "./components/FactCheck";
import ContextGauge from "./components/ContextGauge";
import { MONO } from "./lib/ui";

export default function App() {
  const [draft, setDraft] = useState("");
  // The prompt the panels are analysing, committed only on submit so typing
  // does not restart six streams on every keystroke.
  const [prompt, setPrompt] = useState("");
  // Incremented per submit; panels key their streams off it so re-running the
  // same prompt still re-triggers every panel.
  const [runId, setRunId] = useState(0);
  const [response, setResponse] = useState("");
  const [settings, setSettings] = useState(null);

  useEffect(() => {
    fetch("/api/config")
      .then((res) => (res.ok ? res.json() : null))
      .then(setSettings)
      .catch(() => setSettings(null));
  }, []);

  const handleSubmit = () => {
    const text = draft.trim();
    if (!text) return;
    setResponse("");
    setPrompt(text);
    setRunId((n) => n + 1);
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
      <header
        style={{
          borderBottom: "1px solid #222",
          padding: "0.75rem 1.5rem",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          background: "#111",
          position: "sticky",
          top: 0,
          zIndex: 100,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <span style={{ fontFamily: MONO, fontSize: "1rem", fontWeight: 600, color: "#ff6b35" }}>
            // LLM X-RAY
          </span>
          <span
            style={{
              fontFamily: MONO,
              fontSize: "0.6rem",
              color: "#555",
              borderLeft: "1px solid #333",
              paddingLeft: "0.75rem",
            }}
          >
            visual debugger
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          {settings && (
            <span style={{ fontFamily: MONO, fontSize: "0.55rem", color: "#555" }}>
              {settings.model} · alerts {settings.alerts_enabled ? "on" : "off"}
            </span>
          )}
          <div
            style={{
              width: "8px",
              height: "8px",
              borderRadius: "50%",
              background: "#06d6a0",
              boxShadow: "0 0 6px #06d6a0",
            }}
          />
        </div>
      </header>

      <div style={{ display: "flex", flex: 1 }}>
        <aside
          style={{
            width: "320px",
            minWidth: "320px",
            borderRight: "1px solid #222",
            padding: "1.25rem",
            display: "flex",
            flexDirection: "column",
            gap: "1rem",
            background: "#111",
          }}
        >
          <Label>PROMPT INPUT</Label>
          <textarea
            rows={8}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Enter a prompt to analyze..."
            style={{
              width: "100%",
              background: "#0d0d0d",
              border: "1px solid #2a2a2a",
              borderRadius: "4px",
              padding: "0.85rem",
              color: "#e8e6e3",
              fontSize: "0.85rem",
              fontFamily: MONO,
              resize: "vertical",
              outline: "none",
              lineHeight: "1.7",
              transition: "border-color 0.2s",
            }}
            onFocus={(e) => (e.target.style.borderColor = "#ff6b35")}
            onBlur={(e) => (e.target.style.borderColor = "#2a2a2a")}
          />

          <button
            onClick={handleSubmit}
            disabled={!draft.trim()}
            style={{
              padding: "0.7rem",
              background: draft.trim() ? "#ff6b35" : "#1a1a1a",
              color: draft.trim() ? "#0d0d0d" : "#555",
              border: `1px solid ${draft.trim() ? "#ff6b35" : "#2a2a2a"}`,
              borderRadius: "4px",
              cursor: draft.trim() ? "pointer" : "not-allowed",
              fontSize: "0.7rem",
              fontFamily: MONO,
              fontWeight: 600,
              letterSpacing: "0.08em",
              transition: "all 0.2s",
            }}
          >
            RUN ANALYSIS →
          </button>

          <span style={{ fontFamily: MONO, fontSize: "0.55rem", color: "#444" }}>
            ⌘/Ctrl + Enter to run
          </span>

          <div
            style={{
              marginTop: "auto",
              paddingTop: "1rem",
              borderTop: "1px solid #1e1e1e",
              fontFamily: MONO,
              fontSize: "0.55rem",
              color: "#444",
              lineHeight: "1.9",
            }}
          >
            <div>7 panels · 7 SSE endpoints</div>
            {settings && (
              <>
                <div>ctx limit {(settings.context_limit / 1000).toFixed(0)}k</div>
                <div>purge at {(settings.purge_threshold * 100).toFixed(0)}%</div>
              </>
            )}
          </div>
        </aside>

        <main
          style={{
            flex: 1,
            padding: "1.25rem",
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "1rem",
            alignContent: "start",
          }}
        >
          <Panel title="TOKENIZER" tag="panel 1" accent="#ff6b35" span={2}>
            <TokenHighlighter prompt={prompt} runId={runId} />
          </Panel>

          <Panel title="GENERATION STREAM" tag="panel 2" accent="#ff9f1c">
            <GenerationStream prompt={prompt} runId={runId} onComplete={setResponse} />
          </Panel>

          <Panel title="EMBEDDING STAR MAP" tag="panel 3" accent="#4D96FF">
            <EmbeddingStarMap prompt={prompt} runId={runId} />
          </Panel>

          <Panel title="ATTENTION VIEW" tag="panel 4" accent="#c77dff">
            <AttentionView prompt={prompt} runId={runId} />
          </Panel>

          <Panel title="FACT-CHECK" tag="panel 6" accent="#ef476f">
            <FactCheck responseText={response} runId={runId} />
          </Panel>

          <Panel title="PROBABILITY LAB" tag="panel 5" accent="#ffd166" span={2}>
            <TemperatureLab initialPrompt={prompt} />
          </Panel>

          <Panel title="CONTEXT FUEL GAUGE" tag="panel 7" accent="#06d6a0" span={2}>
            <ContextGauge settings={settings} />
          </Panel>
        </main>
      </div>
    </div>
  );
}

function Panel({ title, tag, accent, children, span = 1 }) {
  return (
    <div
      style={{
        background: "#111",
        border: "1px solid #2a2a2a",
        borderTop: `2px solid ${accent}`,
        borderRadius: "4px",
        padding: "1rem",
        gridColumn: span === 2 ? "span 2" : "span 1",
        minHeight: "160px",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "0.85rem",
        }}
      >
        <span
          style={{
            fontFamily: MONO,
            fontSize: "0.6rem",
            fontWeight: 600,
            color: accent,
            letterSpacing: "0.1em",
          }}
        >
          {title}
        </span>
        <span
          style={{
            fontFamily: MONO,
            fontSize: "0.55rem",
            color: "#444",
            background: "#1a1a1a",
            padding: "0.15rem 0.5rem",
            borderRadius: "3px",
          }}
        >
          {tag}
        </span>
      </div>
      <div style={{ flex: 1 }}>{children}</div>
    </div>
  );
}

function Label({ children }) {
  return (
    <span
      style={{
        fontFamily: MONO,
        fontSize: "0.6rem",
        color: "#888",
        letterSpacing: "0.1em",
        display: "block",
      }}
    >
      {children}
    </span>
  );
}
