import { useEffect, useState } from "react";
import axios from "axios";

const VERDICT = {
  verified:      { color: "#06d6a0", icon: "✓", label: "VERIFIED",      bg: "#06d6a018" },
  uncertain:     { color: "#ffd166", icon: "?", label: "UNCERTAIN",     bg: "#ffd16618" },
  hallucination: { color: "#ef476f", icon: "✗", label: "HALLUCINATION", bg: "#ef476f18" },
};

function highlight(text, claims) {
  if (!claims.length) return [{ part: text, verdict: null }];

  let result = [{ part: text, verdict: null }];

  for (const { claim, verdict } of claims) {
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
      if (idx > 0) next.push({ part: segment.part.slice(0, idx), verdict: null });
      next.push({ part: segment.part.slice(idx, idx + claim.length), verdict });
      if (idx + claim.length < segment.part.length) {
        next.push({ part: segment.part.slice(idx + claim.length), verdict: null });
      }
    }
    result = next;
  }

  return result;
}

export default function FactCheck({ responseText, autoRun }) {
  const [claims, setClaims] = useState([]);
  const [loading, setLoading] = useState(false);
  const [ran, setRan] = useState(false);

  useEffect(() => {
    if (!autoRun || !responseText) return;

    const run = async () => {
      setLoading(true);
      setClaims([]);
      setRan(false);
      try {
        const res = await axios.post("/api/factcheck", { response_text: responseText });
        setClaims(res.data.claims);
        setRan(true);
      } catch (err) {
        console.error("Fact check failed:", err.message);
      } finally {
        setLoading(false);
      }
    };

    run();
  }, [autoRun, responseText]);

  const counts = {
    verified:      claims.filter(c => c.verdict === "verified").length,
    uncertain:     claims.filter(c => c.verdict === "uncertain").length,
    hallucination: claims.filter(c => c.verdict === "hallucination").length,
  };

  const segments = highlight(responseText || "", claims);

  if (!responseText && !loading) return (
    <div style={emptyStyle}>run a prompt to fact-check the response</div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.85rem", height: "100%" }}>

      {/* Disclaimer */}
      <p style={{
        fontFamily: "'IBM Plex Mono', monospace", fontSize: "0.85rem",
        color: "#aaa", borderLeft: "2px solid #ef476f",
        paddingLeft: "0.6rem", lineHeight: "1.7",
      }}>
        A second Gemini call audits the first response for suspicious claims.{" "}
        <span style={{ color: "#ef476f" }}>AI fact-checking AI</span> — useful signal,
        not ground truth. Always verify important claims yourself.
      </p>

      {/* Loading */}
      {loading && (
        <div style={{
          display: "flex", alignItems: "center", gap: "0.5rem",
          fontFamily: "'IBM Plex Mono', monospace", fontSize: "0.8rem", color: "#555",
        }}>
          <span style={{ color: "#ef476f", animation: "pulse 1.2s infinite" }}>●</span>
          auditing response for hallucinations...
        </div>
      )}

      {/* Score summary */}
      {ran && (
        <div style={{ display: "flex", gap: "0.5rem" }}>
          {Object.entries(counts).map(([verdict, count]) => {
            const meta = VERDICT[verdict];
            return (
              <div key={verdict} style={{
                flex: 1,
                background: meta.bg,
                border: `1px solid ${meta.color}44`,
                borderRadius: "4px",
                padding: "0.5rem 0.75rem",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: "2px",
              }}>
                <span style={{
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: "1.1rem", color: meta.color, fontWeight: 600,
                }}>
                  {count}
                </span>
                <span style={{
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: "0.8rem", color: meta.color, letterSpacing: "0.08em",
                }}>
                  {meta.label}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Highlighted response text */}
      {ran && (
        <div style={{
          background: "#0d0d0d", border: "1px solid #1e1e1e",
          borderRadius: "4px", padding: "0.85rem",
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: "0.85rem", lineHeight: "1.9",
          color: "#ccc", overflowY: "auto", maxHeight: "200px",
        }}>
          {segments.map((seg, i) => {
            if (!seg.verdict) return <span key={i}>{seg.part}</span>;
            const meta = VERDICT[seg.verdict];
            return (
              <span
                key={i}
                title={`${meta.label}: ${claims.find(c => c.verdict === seg.verdict && seg.part.toLowerCase().includes(c.claim.toLowerCase()))?.reason ?? ""}`}
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

      {/* Claims breakdown */}
      {ran && claims.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem", overflowY: "auto" }}>
          <div style={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: "0.85rem", color: "#555", letterSpacing: "0.08em",
          }}>
            CLAIMS BREAKDOWN
          </div>
          {claims.map((claim, i) => {
            const meta = VERDICT[claim.verdict] ?? VERDICT.uncertain;
            return (
              <div key={i} style={{
                display: "flex", gap: "0.6rem", alignItems: "start",
                background: "#111", border: `1px solid #1e1e1e`,
                borderLeft: `3px solid ${meta.color}`,
                borderRadius: "4px", padding: "0.5rem 0.75rem",
              }}>
                <span style={{
                  color: meta.color,
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: "0.8rem", fontWeight: 600, minWidth: "12px",
                }}>
                  {meta.icon}
                </span>
                <div style={{ flex: 1 }}>
                  <div style={{
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: "0.85rem", color: "#ddd",
                  }}>
                    "{claim.claim}"
                  </div>
                  <div style={{
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: "0.75rem", color: "#666", marginTop: "2px",
                  }}>
                    {claim.reason}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }`}</style>
    </div>
  );
}

const emptyStyle = {
  flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
  fontFamily: "'IBM Plex Mono', monospace", fontSize: "0.6rem", color: "#333",
};