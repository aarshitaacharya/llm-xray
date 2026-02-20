import Plot from "react-plotly.js";

export default function EmbeddingStarMap({ data }) {
  if (!data) return (
    <div style={{
      flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: "'IBM Plex Mono', monospace", fontSize: "0.6rem", color: "#333",
    }}>
      run a prompt to see its position in embedding space
    </div>
  );

  const { prompt_point, anchors, variance_explained } = data;
  const variancePct = (variance_explained.reduce((a, b) => a + b, 0) * 100).toFixed(1);

  // Anchor dots
  const anchorTrace = {
    type: "scatter3d",
    mode: "markers+text",
    name: "Concepts",
    x: anchors.map(a => a.x),
    y: anchors.map(a => a.y),
    z: anchors.map(a => a.z),
    text: anchors.map(a => a.label),
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

  // Lines from prompt to each anchor (visual reference)
  const lineTraces = anchors.map(a => ({
    type: "scatter3d",
    mode: "lines",
    showlegend: false,
    hoverinfo: "skip",
    x: [prompt_point.x, a.x],
    y: [prompt_point.y, a.y],
    z: [prompt_point.z, a.z],
    line: { color: "#ff6b3515", width: 1 },
  }));

  // Prompt dot — glowing orange
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

      {/* Variance info */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <p style={{
          fontFamily: "'IBM Plex Mono', monospace", fontSize: "0.85rem",
          color: "#aaa", borderLeft: "2px solid #4D96FF", paddingLeft: "0.6rem", lineHeight: "1.7",
        }}>
          Embeddings are numeric representations (~768 dimensions) that capture the meaning of text.
  We use PCA to reduce these vectors to 3D so they can be visualized in space.{" "}
  <span style={{ color: "#4D96FF" }}>
    {variancePct}% of the original semantic information is preserved
  </span>
  . Dots that appear closer together represent concepts that are more semantically related. 
  You can drag the plot to explore different angles.
        </p>
      </div>

      {/* 3D Plot */}
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