const COLORS = [
  "#ff6b35", "#ffd166", "#06d6a0", "#4D96FF",
  "#c77dff", "#ef476f", "#00C9A7", "#f7c59f",
];

export default function TokenHighlighter({ tokens, tokenCount }) {
  if (!tokens.length) return (
    <div style={{
      flex: 1,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontFamily: "'IBM Plex Mono', monospace",
      fontSize: "0.6rem",
      color: "#333",
    }}>
      run a prompt to see tokens
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem"}}>

      {/* Count badge + disclaimer row */}
      <div style={{ display: "flex", alignItems: "start", justifyContent: "space-between", gap: "1rem" }}>
        <p style={{
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: "0.85rem",
          color: "#aaa",
          lineHeight: "1.8",
          borderLeft: "2px solid #ff6b35",
          paddingLeft: "0.6rem",
        }}>
          Tokenization is the process of breaking text into small pieces (“tokens”) that
        a language model reads and reasons over.

        The count shown is the true Gemini token cost for this prompt. The colored
        blocks are a visual approximation to help you see how text structure maps to
        tokens—actual model boundaries may differ.
        </p>
        <span style={{
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: "0.8rem",
          color: "#ff6b35",
          background: "#1a0a00",
          border: "1px solid #3a1a00",
          padding: "0.2rem 0.6rem",
          borderRadius: "3px",
          whiteSpace: "nowrap",
        }}>
          {tokenCount} tokens
        </span>
      </div>

      {/* Chips */}
      <div style={{
        display: "flex",
        flexWrap: "wrap",
        gap: "5px",
        background: "#0d0d0d",
        border: "1px solid #1e1e1e",
        borderRadius: "4px",
        padding: "0.85rem",
      }}>
        {tokens.map((token, i) => {
          if (/^\s+$/.test(token)) return <span key={i} style={{ width: "6px" }} />;
          const color = COLORS[i % COLORS.length];
          return (
            <span
              key={i}
              title={`~Token ${i + 1}: "${token}" (approximate)`}
              style={{
                color,
                border: `1px solid ${color}66`,
                background: `${color}18`,
                padding: "3px 10px",
                borderRadius: "3px",
                fontSize: "0.75rem",
                fontFamily: "'IBM Plex Mono', monospace",
                cursor: "default",
                display: "inline-block",
                transition: "transform 0.1s, background 0.1s",
              }}
              onMouseEnter={e => {
                e.currentTarget.style.transform = "translateY(-2px)";
                e.currentTarget.style.background = `${color}30`;
              }}
              onMouseLeave={e => {
                e.currentTarget.style.transform = "translateY(0)";
                e.currentTarget.style.background = `${color}18`;
              }}
            >
              {token}
            </span>
          );
        })}
      </div>
    </div>
  );
}