import { TOPICS } from "@/config/topics";

export default function Home() {
  return (
    <main>
      <h1>📡 Research Radar</h1>
      <p>
        Internal knowledge base for post-training research. Crawls arXiv,
        Semantic Scholar, and Hugging Face Papers; summarizes and classifies
        papers; serves a searchable KB via Slack/Discord <code>/ask</code>.
      </p>
      <h2>Tracked topics</h2>
      <ul>
        {TOPICS.map((t) => (
          <li key={t.slug}>
            <strong>{t.name}</strong> — {t.description}
          </li>
        ))}
      </ul>
      <p style={{ color: "#888", fontSize: 14 }}>
        Endpoints: <code>/api/inngest</code>, <code>/api/slack/commands</code>,{" "}
        <code>/api/discord/interactions</code>, <code>/api/health</code>
      </p>
    </main>
  );
}
