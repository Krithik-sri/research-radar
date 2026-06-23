"use client";

import { useEffect, useRef, useState } from "react";

interface Source {
  arxivId: string;
  title: string;
  url: string;
}
interface Msg {
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
}

const SUGGESTIONS = [
  "What's new in RLVR lately?",
  "How does GRPO compare to PPO?",
  "How many reward-modeling papers do you have?",
  "Summarize recent work on reasoning",
];

export default function ChatPage() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function send(text?: string) {
    const q = (text ?? input).trim();
    if (!q || loading) return;
    const base: Msg[] = [...messages, { role: "user", content: q }];
    setMessages([...base, { role: "assistant", content: "", sources: [] }]);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: base.map(({ role, content }) => ({ role, content })) }),
      });
      if (!res.body) throw new Error("no stream");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let content = "";
      let sources: Source[] = [];
      const flush = () => setMessages([...base, { role: "assistant", content, sources }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const ev = JSON.parse(line);
            if (ev.type === "sources") sources = ev.sources ?? [];
            else if (ev.type === "text") content += ev.value;
          } catch {
            /* ignore partial line */
          }
        }
        flush();
      }
      flush();
    } catch {
      setMessages([...base, { role: "assistant", content: "Couldn't reach the server. Is it running?" }]);
    } finally {
      setLoading(false);
    }
  }

  const lastIsEmpty = !messages[messages.length - 1]?.content;

  return (
    <main
      style={{
        display: "flex",
        flexDirection: "column",
        height: "calc(100vh - 130px)",
        maxWidth: 760,
        margin: "0 auto",
        padding: "0 16px",
      }}
    >
      <div style={{ paddingTop: 4, paddingBottom: 10 }}>
        <h1 style={{ fontSize: 22, margin: 0, display: "flex", alignItems: "center", gap: 8 }}>
          <span aria-hidden>📡</span> Research Radar — Chat
        </h1>
        <p style={{ color: "var(--muted)", fontSize: 13, margin: "4px 0 0" }}>
          Conversational search over the post-training paper knowledge base.
        </p>
      </div>

      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "8px 4px 16px",
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        {messages.length === 0 && (
          <div className="fade-in" style={{ marginTop: 8 }}>
            <p style={{ color: "var(--muted)", fontSize: 14, margin: "0 0 12px" }}>
              Try one of these:
            </p>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                gap: 12,
              }}
            >
              {SUGGESTIONS.map((s, i) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="card card-hover fade-in"
                  style={{
                    animationDelay: `${i * 0.06}s`,
                    padding: "14px 16px",
                    cursor: "pointer",
                    textAlign: "left",
                    color: "var(--text)",
                    font: "inherit",
                    fontSize: 14,
                    lineHeight: 1.4,
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => {
          // Skip the empty assistant placeholder (the thinking indicator covers it).
          if (m.role === "assistant" && !m.content && (!m.sources || m.sources.length === 0)) {
            return null;
          }
          const isUser = m.role === "user";
          return (
            <div
              key={i}
              className="slide-up"
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: isUser ? "flex-end" : "flex-start",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  marginBottom: 5,
                  fontSize: 12,
                  fontWeight: 600,
                  color: "var(--muted)",
                  flexDirection: isUser ? "row-reverse" : "row",
                }}
              >
                <span
                  aria-hidden
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: "50%",
                    background: isUser ? "var(--accent)" : "var(--success)",
                    display: "inline-block",
                  }}
                />
                {isUser ? "You" : "Radar"}
              </div>
              <div
                style={{
                  maxWidth: "86%",
                  padding: "11px 14px",
                  borderRadius: 14,
                  borderTopRightRadius: isUser ? 4 : 14,
                  borderTopLeftRadius: isUser ? 14 : 4,
                  background: isUser ? "rgba(99,102,241,.15)" : "var(--surface)",
                  border: isUser
                    ? "1px solid rgba(99,102,241,.3)"
                    : "1px solid var(--border)",
                  whiteSpace: "pre-wrap",
                  lineHeight: 1.55,
                  fontSize: 15,
                }}
              >
                {m.content}
                {m.sources && m.sources.length > 0 && (
                  <div
                    style={{
                      marginTop: 12,
                      fontSize: 13,
                      borderLeft: "2px solid var(--accent)",
                      paddingLeft: 12,
                      background: "var(--surface-2)",
                      borderRadius: "0 8px 8px 0",
                      padding: "8px 12px",
                    }}
                  >
                    <div
                      style={{
                        fontSize: 11,
                        textTransform: "uppercase",
                        letterSpacing: ".04em",
                        color: "var(--muted)",
                        marginBottom: 4,
                      }}
                    >
                      Sources
                    </div>
                    {m.sources.map((s, j) => (
                      <div key={j} style={{ margin: "3px 0" }}>
                        <span style={{ color: "var(--muted)" }}>[{j + 1}]</span>{" "}
                        <a href={s.url} target="_blank" rel="noreferrer">
                          {s.title}
                        </a>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {loading && lastIsEmpty && (
          <div
            className="slide-up"
            style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                marginBottom: 5,
                fontSize: 12,
                fontWeight: 600,
                color: "var(--muted)",
              }}
            >
              <span
                aria-hidden
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  background: "var(--success)",
                  display: "inline-block",
                }}
              />
              Radar
            </div>
            <div
              style={{
                padding: "11px 14px",
                borderRadius: 14,
                borderTopLeftRadius: 4,
                background: "var(--surface)",
                border: "1px solid var(--border)",
                color: "var(--muted)",
                fontSize: 15,
              }}
            >
              <span className="dots">
                Radar is thinking<span>.</span><span>.</span><span>.</span>
              </span>
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div
        style={{
          display: "flex",
          gap: 10,
          padding: "14px 0",
          borderTop: "1px solid var(--border)",
        }}
      >
        <input
          className="input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") send();
          }}
          placeholder="Ask the knowledge base…"
          style={{ flex: 1 }}
        />
        <button
          onClick={() => send()}
          disabled={loading}
          className="btn btn-primary"
          style={{
            minWidth: 90,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
          }}
        >
          {loading ? <span className="spinner" /> : "Send"}
        </button>
      </div>
    </main>
  );
}
