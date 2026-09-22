/** Style primitives shared by the panels. */

export const MONO = "'IBM Plex Mono', monospace";

export const emptyState = {
  flex: 1,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontFamily: MONO,
  fontSize: "0.7rem",
  color: "#333",
  minHeight: "80px",
  textAlign: "center",
};

export const sectionLabel = {
  fontFamily: MONO,
  fontSize: "0.55rem",
  color: "#888",
  letterSpacing: "0.08em",
  marginBottom: "0.4rem",
};

export const disclaimer = (accent) => ({
  fontFamily: MONO,
  fontSize: "0.85rem",
  color: "#aaa",
  borderLeft: `2px solid ${accent}`,
  paddingLeft: "0.6rem",
  lineHeight: "1.7",
  margin: 0,
});

export const surface = {
  background: "#0d0d0d",
  border: "1px solid #1e1e1e",
  borderRadius: "4px",
  padding: "0.75rem",
};

/** Formats a cost that is usually a fraction of a cent. */
export function formatCost(usd) {
  if (!usd) return "$0.000000";
  if (usd < 0.000001) return "<$0.000001";
  return `$${usd.toFixed(6)}`;
}

export function formatTokensPerSecond(value) {
  if (!value || !Number.isFinite(value)) return "0.0";
  return value.toFixed(1);
}
