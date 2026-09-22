import { MONO } from "../lib/ui";

const clip = {
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

/** Small labelled readout used across the metric rows. */
export default function StatTile({ label, value, color }) {
  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        background: "#0d0d0d",
        border: "1px solid #1e1e1e",
        borderRadius: "4px",
        padding: "0.4rem 0.6rem",
        display: "flex",
        flexDirection: "column",
        gap: "2px",
      }}
    >
      <span style={{ ...clip, fontFamily: MONO, fontSize: "0.55rem", color: "#555", letterSpacing: "0.08em" }}>
        {label}
      </span>
      <span style={{ ...clip, fontFamily: MONO, fontSize: "0.8rem", color, fontWeight: 600 }}>
        {value}
      </span>
    </div>
  );
}
