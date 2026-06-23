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
        maxWidth: 800,
        margin: "0 auto",
        padding: "0 16px",
      }}
    >
      <header style={{ paddingTop: 6, paddingBottom: 14 }}>
        <h1
          className="gradient-text"
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 38,
            lineHeight: 1.1,
            margin: 0,
            fontWeight: 700,
            letterSpacing: "-0.03em",
          }}
        >
          Research Radar
        </h1>
        <p style={{ color: "var(--muted)", fontSize: 14.5, margin: "8px 0 0", maxWidth: 540 }}>
          Conversational search over the post-training paper knowledge base.
        </p>
      </header>

      <div
        style={{
          flex: 1,
          overflowY: "auto",
          scrollBehavior: "smooth",
          padding: "8px 4px 20px",
          display: "flex",
          flexDirection: "column",
          gap: 18,
        }}
      >
        {messages.length === 0 && (
          <div className="fade-in" style={{ marginTop: 12 }}>
            <p
              style={{
                color: "var(--muted)",
                fontSize: 12,
                textTransform: "uppercase",
                letterSpacing: ".08em",
                fontWeight: 600,
                margin: "0 0 14px",
              }}
            >
              Try one of these
            </p>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))",
                gap: 14,
              }}
            >
              {SUGGESTIONS.map((s, i) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="card card-hover fade-in"
                  style={{
                    animationDelay: `${i * 0.07}s`,
                    padding: "18px 18px",
                    cursor: "pointer",
                    textAlign: "left",
                    color: "var(--text)",
                    font: "inherit",
                    fontSize: 14.5,
                    lineHeight: 1.45,
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                  }}
                >
                  <span
                    aria-hidden
                    style={{
                      flex: "none",
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: "var(--grad)",
                      boxShadow: "0 0 10px rgba(124,140,255,.6)",
                    }}
                  />
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
                  gap: 7,
                  marginBottom: 7,
                  fontSize: 11.5,
                  fontWeight: 600,
                  letterSpacing: ".02em",
                  color: "var(--muted)",
                  flexDirection: isUser ? "row-reverse" : "row",
                }}
              >
                <span
                  aria-hidden
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: isUser ? "var(--accent)" : "var(--grad)",
                    boxShadow: isUser
                      ? "0 0 8px rgba(124,140,255,.55)"
                      : "0 0 8px rgba(42,215,208,.55)",
                    display: "inline-block",
                  }}
                />
                {isUser ? "You" : "Radar"}
              </div>
              <div
                className={isUser ? undefined : "glass"}
                style={{
                  maxWidth: "86%",
                  padding: "13px 16px",
                  borderRadius: "var(--radius)",
                  borderTopRightRadius: isUser ? 5 : "var(--radius)",
                  borderTopLeftRadius: isUser ? "var(--radius)" : 5,
                  ...(isUser
                    ? {
                        background: "rgba(124,140,255,.16)",
                        border: "1px solid rgba(124,140,255,.32)",
                      }
                    : { boxShadow: "var(--shadow)" }),
                  whiteSpace: "pre-wrap",
                  lineHeight: 1.6,
                  fontSize: 15,
                  color: "var(--text)",
                }}
              >
                {m.content}
                {m.sources && m.sources.length > 0 && (
                  <div
                    style={{
                      marginTop: 14,
                      fontSize: 13.5,
                      borderLeft: "2px solid var(--accent)",
                      background: "rgba(255,255,255,.025)",
                      borderRadius: "0 10px 10px 0",
                      padding: "10px 14px",
                    }}
                  >
                    <div
                      style={{
                        fontSize: 10.5,
                        textTransform: "uppercase",
                        letterSpacing: ".09em",
                        fontWeight: 600,
                        color: "var(--muted)",
                        marginBottom: 6,
                      }}
                    >
                      Sources
                    </div>
                    {m.sources.map((s, j) => (
                      <div key={j} style={{ margin: "5px 0", display: "flex", gap: 7 }}>
                        <span style={{ color: "var(--accent)", fontWeight: 600 }}>
                          {j + 1}.
                        </span>
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
                gap: 7,
                marginBottom: 7,
                fontSize: 11.5,
                fontWeight: 600,
                letterSpacing: ".02em",
                color: "var(--muted)",
              }}
            >
              <span
                aria-hidden
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: "var(--grad)",
                  boxShadow: "0 0 8px rgba(42,215,208,.55)",
                  display: "inline-block",
                }}
              />
              Radar
            </div>
            <div
              className="glass"
              style={{
                padding: "13px 16px",
                borderRadius: "var(--radius)",
                borderTopLeftRadius: 5,
                boxShadow: "var(--shadow)",
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
        className="glass"
        style={{
          display: "flex",
          gap: 10,
          padding: 10,
          marginBottom: 14,
          borderRadius: 999,
          boxShadow: "var(--shadow)",
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
          style={{ flex: 1, borderRadius: 999, background: "transparent" }}
        />
        <button
          onClick={() => send()}
          disabled={loading}
          className="btn btn-primary"
          style={{
            minWidth: 96,
            borderRadius: 999,
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
