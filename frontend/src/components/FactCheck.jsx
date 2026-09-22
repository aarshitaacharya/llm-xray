import { useRef, useState } from "react";
import { useSSE } from "../hooks/useSSE";
import { MONO, disclaimer, emptyState } from "../lib/ui";

const ACCENT = "#ef476f";

const VERDICT = {
  verified: { color: "#06d6a0", icon: "✓", label: "VERIFIED", bg: "#06d6a018" },
  uncertain: { color: "#ffd166", icon: "?", label: "UNCERTAIN", bg: "#ffd16618" },
  hallucination: { color: "#ef476f", icon: "✗", label: "HALLUCINATION", bg: "#ef476f18" },
};

/**
 * Splits the response into spans, marking any stretch a claim matched.
 *
 * Claims are applied in order and never re-split an already-marked span, so
 * overlapping claims resolve to whichever matched first rather than nesting.
 */
function highlight(text, claims) {
  if (!claims.length) return [{ part: text, verdict: null }];

  let result = [{ part: text, verdict: null }];

  for (const { claim, verdict } of claims) {
    if (!claim) continue;
    const next = [];
    for (const segment of result) {
      if (segment.verdict !== null) {
        next.push(segment);
        continue;
      }
      const idx = segment.part.toLowerCase().indexOf(claim.toLowerCase());
      if (idx === -1) {
        next.push(segment);
        continue;
      }
      if (idx > 0) {
        next.push({ part: segment.part.slice(0, idx), verdict: null });
      }
      next.push({ part: segment.part.slice(idx, idx + claim.length), verdict });
      if (idx + claim.length < segment.part.length) {
        next.push({ part: segment.part.slice(idx + claim.length), verdict: null });
      }
    }
    result = next;
  }

  return result;
}

/** Panel 6 — a second model call audits the first response for hallucinations. */
export default function FactCheck({ responseText, runId }) {
  const [claims, setClaims] = useState([]);
  const [done, setDone] = useState(false);
  const claimsRef = useRef([]);

  const { streaming, error } = useSSE({
    url: "/api/stream/factcheck",
    enabled: Boolean(responseText),
    trigger: `${runId}:${responseText?.length ?? 0}`,
    getBody: () => ({ response_text: responseText }),
    onStart: () => {
      claimsRef.current = [];
      setClaims([]);
      setDone(false);
    },
    onEvent: (evt) => {
      if (evt.type === "claim") {
        claimsRef.current = [
          ...claimsRef.current,
          { claim: evt.claim, verdict: evt.verdict, reason: evt.reason },
        ];
        setClaims(claimsRef.current);
      } else if (evt.type === "complete") {
        setDone(true);
      }
    },
  });

  if (!responseText) {
    return <div style={emptyState}>run a prompt to fact-check the response</div>;
  }

  const counts = {
    verified: claims.filter((c) => c.verdict === "verified").length,
    uncertain: claims.filter((c) => c.verdict === "uncertain").length,
    hallucination: claims.filter((c) => c.verdict === "hallucination").length,
  };

  const segments = highlight(responseText, claims);
  const showResults = claims.length > 0 || done;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.85rem", height: "100%" }}>
      <p style={disclaimer(ACCENT)}>
        A second Gemini call audits the first response, streaming each suspicious
        claim back as it is found.{" "}
        <span style={{ color: ACCENT }}>AI fact-checking AI</span> is a useful
        signal, not ground truth — verify anything important yourself.
      </p>

      {streaming && (
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontFamily: MONO, fontSize: "0.7rem", color: "#555" }}>
          <span style={{ color: ACCENT, animation: "pulse 1.2s infinite" }}>●</span>
          auditing response for hallucinations… {claims.length > 0 && `(${claims.length} claims)`}
        </div>
      )}

      {error && (
        <div style={{ fontFamily: MONO, fontSize: "0.65rem", color: ACCENT }}>
          stream error: {error}
        </div>
      )}

      {showResults && (
        <div style={{ display: "flex", gap: "0.5rem" }}>
          {Object.entries(counts).map(([verdict, count]) => {
            const meta = VERDICT[verdict];
            return (
              <div
                key={verdict}
                style={{
                  flex: 1,
                  background: meta.bg,
                  border: `1px solid ${meta.color}44`,
                  borderRadius: "4px",
                  padding: "0.5rem 0.75rem",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: "2px",
                }}
              >
                <span style={{ fontFamily: MONO, fontSize: "1.1rem", color: meta.color, fontWeight: 600 }}>
                  {count}
                </span>
                <span style={{ fontFamily: MONO, fontSize: "0.55rem", color: meta.color, letterSpacing: "0.08em" }}>
                  {meta.label}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {showResults && (
        <div
          style={{
            background: "#0d0d0d",
            border: "1px solid #1e1e1e",
            borderRadius: "4px",
            padding: "0.85rem",
            fontFamily: MONO,
            fontSize: "0.78rem",
            lineHeight: "1.9",
            color: "#ccc",
            overflowY: "auto",
            maxHeight: "200px",
            whiteSpace: "pre-wrap",
          }}
        >
          {segments.map((seg, i) => {
            if (!seg.verdict) return <span key={i}>{seg.part}</span>;
            const meta = VERDICT[seg.verdict] ?? VERDICT.uncertain;
            const match = claims.find(
              (c) => c.claim && seg.part.toLowerCase().includes(c.claim.toLowerCase()),
            );
            return (
              <span
                key={i}
                title={`${meta.label}: ${match?.reason ?? ""}`}
                style={{
                  background: meta.bg,
                  color: meta.color,
                  borderBottom: `2px solid ${meta.color}`,
                  padding: "1px 3px",
                  borderRadius: "2px",
                  cursor: "help",
                }}
              >
                {seg.part}
              </span>
            );
          })}
        </div>
      )}

      {claims.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem", overflowY: "auto" }}>
          <div style={{ fontFamily: MONO, fontSize: "0.55rem", color: "#555", letterSpacing: "0.08em" }}>
            CLAIMS BREAKDOWN
          </div>
          {claims.map((claim, i) => {
            const meta = VERDICT[claim.verdict] ?? VERDICT.uncertain;
            return (
              <div
                key={i}
                style={{
                  display: "flex",
                  gap: "0.6rem",
                  alignItems: "start",
                  background: "#111",
                  border: "1px solid #1e1e1e",
                  borderLeft: `3px solid ${meta.color}`,
                  borderRadius: "4px",
                  padding: "0.5rem 0.75rem",
                  animation: "fadein 0.4s ease",
                }}
              >
                <span style={{ color: meta.color, fontFamily: MONO, fontSize: "0.8rem", fontWeight: 600, minWidth: "12px" }}>
                  {meta.icon}
                </span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: MONO, fontSize: "0.78rem", color: "#ddd" }}>
                    "{claim.claim}"
                  </div>
                  <div style={{ fontFamily: MONO, fontSize: "0.7rem", color: "#666", marginTop: "2px" }}>
                    {claim.reason}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {done && claims.length === 0 && (
        <div style={{ fontFamily: MONO, fontSize: "0.7rem", color: "#555" }}>
          no distinct factual claims extracted from this response.
        </div>
      )}

      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
        @keyframes fadein { from { opacity:0; transform: translateY(-3px) } to { opacity:1; transform:none } }
      `}</style>
    </div>
  );
}
