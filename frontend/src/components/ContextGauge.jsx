import { useEffect, useRef, useState } from "react";
import { useManualSSE } from "../hooks/useSSE";
import StatTile from "./StatTile";
import {
  MONO,
  disclaimer,
  formatCost,
  formatTokensPerSecond,
} from "../lib/ui";

const ACCENT = "#06d6a0";

/** Stable id so SNS alerts can be attributed to one browser session. */
const SESSION_ID = `sess_${Math.random().toString(36).slice(2, 10)}`;

function gaugeColor(percent, thresholdPct) {
  if (percent < thresholdPct * 0.625) return ACCENT;
  if (percent < thresholdPct) return "#ffd166";
  return "#ef476f";
}

function GaugeBar({ percent, limit, thresholdPct }) {
  const color = gaugeColor(percent, thresholdPct);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <span style={{ fontFamily: MONO, fontSize: "0.7rem", color: "#888" }}>
          CONTEXT USED
        </span>
        <span style={{ fontFamily: MONO, fontSize: "0.8rem", color, transition: "color 0.4s" }}>
          {percent.toFixed(3)}%
        </span>
      </div>

      <div
        style={{
          width: "100%",
          height: "12px",
          background: "#0d0d0d",
          border: "1px solid #2a2a2a",
          borderRadius: "6px",
          overflow: "hidden",
          position: "relative",
        }}
      >
        <div
          style={{
            height: "100%",
            // A visible sliver below 0.5% so the bar reads as "filling" rather
            // than broken; real context windows are enormous next to a chat turn.
            width: `${Math.min(Math.max(percent, percent > 0 ? 0.5 : 0), 100)}%`,
            background: `linear-gradient(90deg, ${ACCENT}, ${color})`,
            borderRadius: "6px",
            transition: "width 0.6s ease, background 0.6s ease",
            boxShadow: percent > thresholdPct ? `0 0 8px ${color}88` : "none",
          }}
        />
        <div
          title={`purge threshold — ${thresholdPct}%`}
          style={{
            position: "absolute",
            left: `${thresholdPct}%`,
            top: 0,
            bottom: 0,
            width: "1px",
            background: "#ef476f55",
          }}
        />
      </div>

      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <span style={{ fontFamily: MONO, fontSize: "0.5rem", color: "#555" }}>0</span>
        <span style={{ fontFamily: MONO, fontSize: "0.5rem", color: "#555" }}>
          {(limit / 1000).toFixed(0)}k tokens
        </span>
      </div>
    </div>
  );
}

function MessageBubble({ message, isPurged }) {
  const isUser = message.role === "user";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: isUser ? "flex-end" : "flex-start",
        opacity: isPurged ? 0.15 : 1,
        filter: isPurged ? "grayscale(100%)" : "none",
        transition: "opacity 0.8s ease, filter 0.8s ease",
      }}
    >
      <div
        style={{
          maxWidth: "85%",
          background: isUser ? "#1a1000" : "#0d0d0d",
          border: `1px solid ${isPurged ? "#1e1e1e" : isUser ? "#ff6b3533" : "#2a2a2a"}`,
          borderRadius: "4px",
          padding: "0.6rem 0.85rem",
        }}
      >
        <div
          style={{
            fontFamily: MONO,
            fontSize: "0.55rem",
            color: isPurged ? "#333" : isUser ? "#ff6b35" : "#888",
            marginBottom: "0.3rem",
            letterSpacing: "0.08em",
          }}
        >
          {isUser ? "YOU" : "GEMINI"} {isPurged && "— purged from context"}
        </div>
        <div
          style={{
            fontFamily: MONO,
            fontSize: "0.78rem",
            color: isPurged ? "#333" : "#ccc",
            lineHeight: "1.7",
            whiteSpace: "pre-wrap",
            transition: "color 0.8s",
          }}
        >
          {message.content}
        </div>
      </div>
    </div>
  );
}

/**
 * Panel 7 — a chat that meters its own context consumption.
 *
 * Tracks tokens/sec and cost per request live, publishes an SNS alert when the
 * conversation crosses the configured threshold, and simulates the purge every
 * production chat app eventually has to implement.
 */
export default function ContextGauge({ settings }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [purgedCount, setPurgedCount] = useState(0);
  const [usage, setUsage] = useState(null);
  const [liveMetrics, setLiveMetrics] = useState(null);
  const [draft, setDraft] = useState("");
  const [alert, setAlert] = useState(null);
  const bottomRef = useRef(null);

  const { run, streaming, error } = useManualSSE("/api/stream/chat");

  const limit = settings?.context_limit ?? 1_048_576;
  const thresholdPct = (settings?.purge_threshold ?? 0.8) * 100;
  const percentUsed = usage?.percent_used ?? 0;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages, draft]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || streaming) return;

    const withUser = [...messages, { role: "user", content: text }];
    setMessages(withUser);
    setInput("");
    setDraft("");
    setAlert(null);
    setLiveMetrics(null);

    let reply = "";
    let pendingPurge = 0;

    await run(
      {
        messages: withUser.slice(purgedCount),
        purged_count: purgedCount,
        session_id: SESSION_ID,
      },
      (evt) => {
        if (evt.type === "token") {
          reply += evt.text;
          setDraft(reply);
          setLiveMetrics(evt.metrics);
        } else if (evt.type === "usage") {
          setUsage(evt);
          setLiveMetrics(evt);
        } else if (evt.type === "alert") {
          setAlert(evt);
        } else if (evt.type === "purge") {
          pendingPurge = evt.purge_count;
        }
      },
    );

    setDraft("");
    if (reply) {
      setMessages((prev) => [...prev, { role: "model", content: reply }]);
    }

    if (pendingPurge > 0) {
      // Delay so the oldest messages visibly gray out before they drop.
      setTimeout(() => setPurgedCount((prev) => prev + pendingPurge), 1200);
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
    setUsage(null);
    setLiveMetrics(null);
    setAlert(null);
    setDraft("");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.85rem", height: "100%" }}>
      <p style={disclaimer(ACCENT)}>
        An independent chat that meters its own context. Tokens per second and
        cost update live as the reply streams.{" "}
        <span style={{ color: ACCENT }}>Oldest messages gray out and drop</span>{" "}
        from the active context past {thresholdPct}% capacity, and crossing that
        line publishes an SNS notification
        {settings && !settings.alerts_enabled && " (disabled — no topic configured)"}.
      </p>

      <GaugeBar percent={percentUsed} limit={limit} thresholdPct={thresholdPct} />

      {(usage || liveMetrics) && (
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <StatTile label="CTX TOKENS" value={(usage?.total_tokens ?? 0).toLocaleString()} color={ACCENT} />
          <StatTile label="TOKENS/SEC" value={formatTokensPerSecond(liveMetrics?.tokens_per_second)} color="#ff9f1c" />
          <StatTile label="COST/REQ" value={formatCost(liveMetrics?.cost_usd)} color="#ffd166" />
          <StatTile label="PURGED" value={purgedCount} color="#ef476f" />
          <StatTile label="ACTIVE" value={Math.max(messages.length - purgedCount, 0)} color="#4D96FF" />
        </div>
      )}

      {alert && (
        <div
          style={{
            fontFamily: MONO,
            fontSize: "0.65rem",
            lineHeight: "1.6",
            color: alert.sent ? "#ef476f" : "#666",
            background: alert.sent ? "#ef476f12" : "#0d0d0d",
            border: `1px solid ${alert.sent ? "#ef476f44" : "#1e1e1e"}`,
            borderRadius: "4px",
            padding: "0.5rem 0.75rem",
          }}
        >
          {alert.sent ? (
            <>
              ▲ SNS alert published at {alert.percent_used.toFixed(2)}% — message{" "}
              {alert.message_id?.slice(0, 8)}…
            </>
          ) : (
            <>▲ threshold crossed at {alert.percent_used.toFixed(2)}% — SNS alert not sent ({alert.reason})</>
          )}
        </div>
      )}

      {error && (
        <div style={{ fontFamily: MONO, fontSize: "0.65rem", color: "#ef476f" }}>
          stream error: {error}
        </div>
      )}

      <div
        style={{
          flex: 1,
          overflowY: "auto",
          maxHeight: "260px",
          display: "flex",
          flexDirection: "column",
          gap: "0.5rem",
          padding: "0.5rem 0",
        }}
      >
        {messages.length === 0 && !draft && (
          <div
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: MONO,
              fontSize: "0.75rem",
              color: "#333",
            }}
          >
            start chatting to watch the gauge fill
          </div>
        )}
        {messages.map((msg, i) => (
          <MessageBubble key={i} message={msg} isPurged={i < purgedCount} />
        ))}
        {draft && <MessageBubble message={{ role: "model", content: draft }} isPurged={false} />}
        {streaming && !draft && (
          <div style={{ fontFamily: MONO, fontSize: "0.6rem", color: ACCENT, animation: "pulse 1.2s infinite" }}>
            ● gemini is thinking...
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div style={{ display: "flex", gap: "0.5rem" }}>
        <textarea
          rows={2}
          value={input}
          onChange={(e) => setInput(e.target.value)}
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
            fontFamily: MONO,
            resize: "none",
            outline: "none",
          }}
          onFocus={(e) => (e.target.style.borderColor = ACCENT)}
          onBlur={(e) => (e.target.style.borderColor = "#2a2a2a")}
        />
        <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
          <button
            onClick={handleSend}
            disabled={streaming || !input.trim()}
            style={{
              flex: 1,
              padding: "0 1rem",
              background: streaming || !input.trim() ? "#1a1a1a" : ACCENT,
              color: streaming || !input.trim() ? "#555" : "#0d0d0d",
              border: "none",
              borderRadius: "4px",
              cursor: streaming || !input.trim() ? "not-allowed" : "pointer",
              fontSize: "0.6rem",
              fontFamily: MONO,
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
              border: "1px solid #222",
              borderRadius: "4px",
              cursor: "pointer",
              fontSize: "0.55rem",
              fontFamily: MONO,
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
