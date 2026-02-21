import { useState } from "react";
import axios from "axios";

const CONTEXT_LIMIT = 1048576;

function GaugeBar({ percent }) {
  const color = percent < 50 ? "#06d6a0"
    : percent < 80 ? "#ffd166"
    : "#ef476f";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <span style={{
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: "0.85rem", color: "#888",
        }}>
          CONTEXT USED
        </span>
        <span style={{
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: "0.85rem", color,
          transition: "color 0.4s",
        }}>
          {percent.toFixed(1)}%
        </span>
      </div>

      {/* Gauge track */}
      <div style={{
        width: "100%", height: "12px",
        background: "#0d0d0d",
        border: "1px solid #2a2a2a",
        borderRadius: "6px",
        overflow: "hidden",
        position: "relative",
      }}>
        <div style={{
          height: "100%",
          width: `${Math.min(percent, 100)}%`,
          background: `linear-gradient(90deg, #06d6a0, ${color})`,
          borderRadius: "6px",
          transition: "width 0.6s ease, background 0.6s ease",
          boxShadow: percent > 80 ? `0 0 8px ${color}88` : "none",
        }} />

        {/* Danger threshold marker at 80% */}
        <div style={{
          position: "absolute",
          left: "80%", top: 0, bottom: 0,
          width: "1px",
          background: "#ef476f55",
        }} />
      </div>

      {/* Token count */}
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <span style={{
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: "0.5rem", color: "#555",
        }}>
          0
        </span>
        <span style={{
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: "0.5rem", color: "#555",
        }}>
          {(CONTEXT_LIMIT / 1000).toFixed(0)}k tokens
        </span>
      </div>
    </div>
  );
}

function MessageBubble({ message, isPurged, isAging }) {
  const isUser = message.role === "user";

  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      alignItems: isUser ? "flex-end" : "flex-start",
      opacity: isPurged ? 0.15 : isAging ? 0.45 : 1,
      filter: isPurged ? "grayscale(100%)" : "none",
      transition: "opacity 0.8s ease, filter 0.8s ease",
      position: "relative",
    }}>
      <div style={{
        maxWidth: "85%",
        background: isUser ? "#1a1000" : "#0d0d0d",
        border: `1px solid ${isPurged ? "#1e1e1e" : isUser ? "#ff6b3533" : "#2a2a2a"}`,
        borderRadius: "4px",
        padding: "0.6rem 0.85rem",
      }}>
        <div style={{
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: "0.85rem",
          color: isPurged ? "#333" : isUser ? "#ff6b35" : "#888",
          marginBottom: "0.3rem",
          letterSpacing: "0.08em",
        }}>
          {isUser ? "YOU" : "GEMINI"} {isPurged && "— purged from context"}
        </div>
        <div style={{
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: "0.8rem",
          color: isPurged ? "#333" : "#ccc",
          lineHeight: "1.7",
          transition: "color 0.8s",
        }}>
          {message.content}
        </div>
      </div>
    </div>
  );
}

export default function ContextGauge() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [tokenInfo, setTokenInfo] = useState({ total: 0, percent: 0 });
  const [purgedCount, setPurgedCount] = useState(0);

  const activeMessages = messages.slice(purgedCount);
  const percentUsed = tokenInfo.percent;

  const handleSend = async () => {
    if (!input.trim() || loading) return;

    const userMsg = { role: "user", content: input.trim() };
    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);
    setInput("");
    setLoading(true);

    try {
      const res = await axios.post("/api/chat", {
        messages: updatedMessages.slice(purgedCount), // only send active context
      });

      const assistantMsg = { role: "model", content: res.data.response };
      const withResponse = [...updatedMessages, assistantMsg];
      setMessages(withResponse);
      setTokenInfo({
        total: res.data.total_tokens,
        percent: res.data.percent_used,
      });

      // Auto-purge oldest 2 messages if over 80%
      if (res.data.percent_used > 80) {
        setTimeout(() => {
          setPurgedCount(prev => Math.min(prev + 2, withResponse.length - 2));
        }, 1200); // delay so user sees the gray-out first
      }

    } catch (err) {
      console.error("Chat failed:", err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleReset = () => {
    setMessages([]);
    setPurgedCount(0);
    setTokenInfo({ total: 0, percent: 0 });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.85rem", height: "100%" }}>

      {/* Disclaimer */}
      <p style={{
        fontFamily: "'IBM Plex Mono', monospace", fontSize: "0.85rem",
        color: "#aaa", borderLeft: "2px solid #06d6a0",
        paddingLeft: "0.6rem", lineHeight: "1.7",
      }}>
        This is an independent chat that tracks context usage.{" "}
        <span style={{ color: "#06d6a0" }}>Oldest messages gray out</span> and get
        purged from the active context when you exceed 80% capacity.
      </p>

      {/* Gauge */}
      <GaugeBar percent={percentUsed} />

      {/* Token stats row */}
      {tokenInfo.total > 0 && (
        <div style={{ display: "flex", gap: "0.5rem" }}>
          {[
            { label: "TOKENS USED", value: tokenInfo.total.toLocaleString(), color: "#06d6a0" },
            { label: "PURGED MSGS", value: purgedCount, color: "#ef476f" },
            { label: "ACTIVE MSGS", value: activeMessages.length, color: "#4D96FF" },
          ].map(({ label, value, color }) => (
            <div key={label} style={{
              flex: 1, background: "#0d0d0d",
              border: "1px solid #1e1e1e", borderRadius: "4px",
              padding: "0.4rem 0.6rem",
              display: "flex", flexDirection: "column", gap: "2px",
            }}>
              <span style={{
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: "0.75rem", color: "#555", letterSpacing: "0.08em",
              }}>
                {label}
              </span>
              <span style={{
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: "0.85rem", color, fontWeight: 600,
              }}>
                {value}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Message history */}
      <div style={{
        flex: 1, overflowY: "auto", maxHeight: "260px",
        display: "flex", flexDirection: "column", gap: "0.5rem",
        padding: "0.5rem 0",
      }}>
        {messages.length === 0 && (
          <div style={{
            flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
            fontFamily: "'IBM Plex Mono', monospace", fontSize: "0.8rem", color: "#333",
          }}>
            start chatting to watch the gauge fill
          </div>
        )}
        {messages.map((msg, i) => (
          <MessageBubble
            key={i}
            message={msg}
            isPurged={i < purgedCount}
            isAging={i < purgedCount + 2 && i >= purgedCount && percentUsed > 60}
          />
        ))}
        {loading && (
          <div style={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: "0.6rem", color: "#06d6a0",
            animation: "pulse 1.2s infinite",
          }}>
            ● gemini is thinking...
          </div>
        )}
      </div>

      {/* Input row */}
      <div style={{ display: "flex", gap: "0.5rem" }}>
        <textarea
          rows={2}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Chat here... (Enter to send)"
          style={{
            flex: 1,
            background: "#0d0d0d",
            border: "1px solid #2a2a2a",
            borderRadius: "4px",
            padding: "0.6rem",
            color: "#e8e6e3",
            fontSize: "0.75rem",
            fontFamily: "'IBM Plex Mono', monospace",
            resize: "none", outline: "none",
          }}
          onFocus={e => e.target.style.borderColor = "#06d6a0"}
          onBlur={e => e.target.style.borderColor = "#2a2a2a"}
        />
        <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
          <button
            onClick={handleSend}
            disabled={loading || !input.trim()}
            style={{
              flex: 1,
              padding: "0 1rem",
              background: loading ? "#1a1a1a" : "#06d6a0",
              color: loading ? "#555" : "#0d0d0d",
              border: "none", borderRadius: "4px",
              cursor: loading ? "not-allowed" : "pointer",
              fontSize: "0.6rem",
              fontFamily: "'IBM Plex Mono', monospace",
              fontWeight: 600,
            }}
          >
            SEND
          </button>
          <button
            onClick={handleReset}
            style={{
              padding: "0.3rem 1rem",
              background: "transparent",
              color: "#444",
              border: "1px solid #222", borderRadius: "4px",
              cursor: "pointer",
              fontSize: "0.55rem",
              fontFamily: "'IBM Plex Mono', monospace",
            }}
          >
            RESET
          </button>
        </div>
      </div>

      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }`}</style>
    </div>
  );
}