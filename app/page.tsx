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
      <header style={{ margin: "8px 0 28px" }}>
        <h1 style={{ fontSize: 30, marginBottom: 10 }}>📡 Research Radar</h1>
        <p style={{ color: "var(--muted)", fontSize: 15, maxWidth: 720, marginTop: 0 }}>
          Internal knowledge base for post-training research. Crawls arXiv,
          Semantic Scholar, and Hugging Face Papers; classifies and summarizes
          papers; serves a searchable KB via a web chat, Slack, and Discord{" "}
          <code>/ask</code>.
        </p>
      </header>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 14,
          margin: "20px 0 36px",
        }}
      >
        {SECTIONS.map((s, i) => (
          <a
            key={s.href}
            href={s.href}
            className="card card-hover fade-in"
            style={{
              display: "block",
              padding: 20,
              textDecoration: "none",
              color: "var(--text)",
              animationDelay: `${i * 60}ms`,
            }}
          >
            <div style={{ fontSize: 32, lineHeight: 1 }}>{s.emoji}</div>
            <div style={{ fontSize: 18, fontWeight: 600, marginTop: 12 }}>
              {s.title}
            </div>
            <div style={{ color: "var(--muted)", fontSize: 14, marginTop: 6 }}>
              {s.desc}
            </div>
          </a>
        ))}
      </div>

      <h2 style={{ fontSize: 19, marginBottom: 14 }}>Tracked topics</h2>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {TOPICS.map((t) => (
          <div
            key={t.slug}
            className="card"
            style={{
              padding: "12px 16px",
              display: "flex",
              flexWrap: "wrap",
              alignItems: "baseline",
              gap: 10,
            }}
          >
            <span className="chip">{t.name}</span>
            <span style={{ color: "var(--muted)", fontSize: 14 }}>
              {t.description}
            </span>
          </div>
        ))}
      </div>
    </main>
  );
}
