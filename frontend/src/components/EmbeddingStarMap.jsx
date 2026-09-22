import { useState } from "react";
import Plot from "../lib/plot";
import { useSSE } from "../hooks/useSSE";
import { MONO, disclaimer, emptyState } from "../lib/ui";

const ACCENT = "#4D96FF";

/** Panel 3 — prompt and anchor concepts embedded, PCA-reduced to 3D. */
export default function EmbeddingStarMap({ prompt, runId }) {
  const [projection, setProjection] = useState(null);
  const [progress, setProgress] = useState({ completed: 0, total: 0, label: "" });

  const { streaming, error } = useSSE({
    url: "/api/stream/embeddings",
    enabled: Boolean(prompt) && runId > 0,
    trigger: runId,
    getBody: () => ({ prompt }),
    onStart: () => {
      setProjection(null);
      setProgress({ completed: 0, total: 0, label: "" });
    },
    onEvent: (evt) => {
      if (evt.type === "start") {
        setProgress({ completed: 0, total: evt.total, label: "" });
      } else if (evt.type === "progress") {
        setProgress({ completed: evt.completed, total: evt.total, label: evt.label });
      } else if (evt.type === "projection") {
        setProjection(evt);
      }
    },
  });

  if (!prompt) {
    return <div style={emptyState}>run a prompt to see its position in embedding space</div>;
  }

  if (!projection) {
    const pct = progress.total ? (progress.completed / progress.total) * 100 : 0;
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", padding: "1rem 0" }}>
        <div style={{ fontFamily: MONO, fontSize: "0.7rem", color: ACCENT }}>
          {error ? `stream error: ${error}` : `embedding ${progress.label || "…"}`}
        </div>
        <div
          style={{
            width: "100%",
            height: "6px",
            background: "#0d0d0d",
            border: "1px solid #1e1e1e",
            borderRadius: "3px",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${pct}%`,
              background: ACCENT,
              transition: "width 0.25s ease",
            }}
          />
        </div>
        <div style={{ fontFamily: MONO, fontSize: "0.6rem", color: "#555" }}>
          {progress.completed} / {progress.total || "?"} vectors
        </div>
      </div>
    );
  }

  const { prompt_point, anchors, variance_explained } = projection;
  const variancePct = (variance_explained.reduce((a, b) => a + b, 0) * 100).toFixed(1);

  const anchorTrace = {
    type: "scatter3d",
    mode: "markers+text",
    name: "Concepts",
    x: anchors.map((a) => a.x),
    y: anchors.map((a) => a.y),
    z: anchors.map((a) => a.z),
    text: anchors.map((a) => a.label),
    textposition: "top center",
    textfont: { family: "IBM Plex Mono", size: 9, color: "#888" },
    marker: {
      size: 5,
      color: "#2a2a2a",
      opacity: 0.85,
      line: { color: "#444", width: 1 },
    },
    hovertemplate: "<b>%{text}</b><extra></extra>",
  };

  // Faint spokes from the prompt to each anchor, purely as a depth cue.
  const lineTraces = anchors.map((a) => ({
    type: "scatter3d",
    mode: "lines",
    showlegend: false,
    hoverinfo: "skip",
    x: [prompt_point.x, a.x],
    y: [prompt_point.y, a.y],
    z: [prompt_point.z, a.z],
    line: { color: "#ff6b3515", width: 1 },
  }));

  const promptTrace = {
    type: "scatter3d",
    mode: "markers+text",
    name: "Your prompt",
    x: [prompt_point.x],
    y: [prompt_point.y],
    z: [prompt_point.z],
    text: ["▶ YOUR PROMPT"],
    textposition: "top center",
    textfont: { family: "IBM Plex Mono", size: 10, color: "#ff6b35" },
    marker: {
      size: 10,
      color: "#ff6b35",
      opacity: 1,
      line: { color: "#ff6b3580", width: 6 },
    },
    hovertemplate: "<b>Your Prompt</b><extra></extra>",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem", height: "100%" }}>
      <p style={disclaimer(ACCENT)}>
        Embeddings are high-dimensional numeric representations that capture the
        meaning of text. PCA reduces those vectors to three dimensions so they
        can be plotted, preserving{" "}
        <span style={{ color: ACCENT }}>{variancePct}% of the original variance</span>.
        Dots that sit closer together are more semantically related. Drag to
        rotate. {streaming && "Re-embedding…"}
      </p>

      <div style={{ flex: 1, minHeight: "360px" }}>
        <Plot
          data={[...lineTraces, anchorTrace, promptTrace]}
          layout={{
            paper_bgcolor: "#0d0d0d",
            plot_bgcolor: "#0d0d0d",
            margin: { l: 0, r: 0, t: 0, b: 0 },
            showlegend: false,
            scene: {
              bgcolor: "#0d0d0d",
              xaxis: { visible: false, showgrid: false, zeroline: false },
              yaxis: { visible: false, showgrid: false, zeroline: false },
              zaxis: { visible: false, showgrid: false, zeroline: false },
              camera: { eye: { x: 1.4, y: 1.4, z: 0.8 } },
            },
          }}
          config={{ displayModeBar: false, responsive: true }}
          style={{ width: "100%", height: "100%" }}
          useResizeHandler
        />
      </div>
    </div>
  );
}
