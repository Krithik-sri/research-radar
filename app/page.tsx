import { TOPICS } from "@/config/topics";

const SECTIONS = [
  { href: "/chat", emoji: "💬", title: "Chat", desc: "Ask the knowledge base in natural language — streamed, with citations." },
  { href: "/papers", emoji: "📄", title: "Papers", desc: "Browse & filter every ingested paper by topic, with summaries." },
  { href: "/graph", emoji: "🕸️", title: "Graph", desc: "Explore the knowledge graph — topics, papers, and their relations." },
  { href: "/admin", emoji: "⚙️", title: "Admin", desc: "Index a paper, crawl a month, and manage ingestion." },
];

export default function Home() {
  return (
    <main className="fade-in">
      {/* Hero */}
      <section style={{ padding: "44px 0 36px", textAlign: "center" }}>
        <span
          className="chip slide-up"
          style={{ marginBottom: 18 }}
        >
          ● Live · post-training research radar
        </span>
        <h1
          className="gradient-text slide-up"
          style={{ fontSize: 52, lineHeight: 1.05, margin: "14px auto 0", maxWidth: 760, animationDelay: "60ms" }}
        >
          Stay on top of post-training research
        </h1>
        <p
          className="slide-up"
          style={{
            color: "var(--muted)",
            fontSize: 17,
            maxWidth: 620,
            margin: "18px auto 0",
            animationDelay: "120ms",
          }}
        >
          An internal knowledge base that crawls arXiv, classifies and summarizes
          papers, and answers questions across RLHF, RLVR, reward modeling, reasoning,
          distillation and more — over web chat, Slack, and Discord.
        </p>
        <div
          className="slide-up"
          style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 28, animationDelay: "180ms" }}
        >
          <a href="/chat" className="btn btn-primary" style={{ padding: "11px 22px", fontSize: 15 }}>
            Open the chat →
          </a>
          <a href="/papers" className="btn" style={{ padding: "11px 22px", fontSize: 15 }}>
            Browse papers
          </a>
        </div>
      </section>

      {/* Feature cards */}
      <section
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))",
          gap: 16,
          margin: "8px 0 48px",
        }}
      >
        {SECTIONS.map((s, i) => (
          <a
            key={s.href}
            href={s.href}
            className="card card-hover fade-in"
            style={{
              display: "block",
              padding: 22,
              textDecoration: "none",
              color: "var(--text)",
              animationDelay: `${i * 70}ms`,
            }}
          >
            <div style={{ fontSize: 30, lineHeight: 1 }}>{s.emoji}</div>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 600, marginTop: 14 }}>
              {s.title}
            </div>
            <div style={{ color: "var(--muted)", fontSize: 14, marginTop: 6, lineHeight: 1.5 }}>{s.desc}</div>
          </a>
        ))}
      </section>

      {/* Topics */}
      <section>
        <h2 style={{ fontSize: 20, marginBottom: 16 }}>Tracked topics</h2>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          {TOPICS.map((t) => (
            <span key={t.slug} className="chip" title={t.description} style={{ padding: "7px 14px", fontSize: 13 }}>
              {t.name}
            </span>
          ))}
        </div>
      </section>
    </main>
  );
}
