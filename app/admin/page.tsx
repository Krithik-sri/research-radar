"use client";

import { useEffect, useState } from "react";
import { TOPICS } from "@/config/topics";

interface Overview {
  total: number;
  relevant: number;
  latest: string | null;
}

function Pre({ value }: { value: unknown }) {
  return (
    <pre
      style={{
        background: "var(--surface-2)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        padding: 14,
        fontSize: 12.5,
        color: "var(--text)",
        overflowX: "auto",
        marginTop: 14,
        marginBottom: 0,
        whiteSpace: "pre-wrap",
        fontFamily:
          "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
      }}
    >
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

export default function AdminPage() {
  const [overview, setOverview] = useState<Overview | null>(null);

  // Index a paper state
  const [arxivId, setArxivId] = useState("");
  const [indexing, setIndexing] = useState(false);
  const [indexResult, setIndexResult] = useState<unknown>(null);
  const [indexError, setIndexError] = useState<string | null>(null);

  // Crawl a month state
  const [ym, setYm] = useState("");
  const [maxPapers, setMaxPapers] = useState(60);
  const [crawling, setCrawling] = useState(false);
  const [crawlResult, setCrawlResult] = useState<unknown>(null);
  const [crawlError, setCrawlError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/overview")
      .then((r) => r.json())
      .then((d) => {
        if (!d.error) setOverview(d);
      })
      .catch(() => {});
  }, []);

  async function runIndex() {
    setIndexing(true);
    setIndexResult(null);
    setIndexError(null);
    try {
      const res = await fetch("/api/admin/index-paper", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ arxivId: arxivId.trim() }),
      });
      const data = await res.json();
      if (!res.ok) setIndexError(data.error ?? `Request failed (${res.status})`);
      else setIndexResult(data);
    } catch (err) {
      setIndexError(err instanceof Error ? err.message : String(err));
    } finally {
      setIndexing(false);
    }
  }

  async function runCrawl() {
    setCrawling(true);
    setCrawlResult(null);
    setCrawlError(null);
    try {
      const res = await fetch("/api/admin/crawl", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ym: ym.trim(), maxPapers }),
      });
      const data = await res.json();
      if (!res.ok) setCrawlError(data.error ?? `Request failed (${res.status})`);
      else setCrawlResult(data);
    } catch (err) {
      setCrawlError(err instanceof Error ? err.message : String(err));
    } finally {
      setCrawling(false);
    }
  }

  const sectionStyle: React.CSSProperties = {
    padding: 22,
    marginBottom: 20,
  };
  const sectionTitle: React.CSSProperties = {
    fontSize: 17,
    marginTop: 0,
    marginBottom: 6,
  };
  const sectionDesc: React.CSSProperties = {
    color: "var(--muted)",
    fontSize: 13,
    marginTop: 0,
    marginBottom: 14,
  };
  const errStyle: React.CSSProperties = {
    color: "var(--danger)",
    fontSize: 13,
    marginBottom: 0,
  };

  return (
    <main
      style={{
        maxWidth: 720,
        margin: "0 auto",
        padding: "8px 0 80px",
      }}
    >
      <h1 style={{ fontSize: 26, marginBottom: 4 }}>Research Radar — Admin</h1>
      <p style={{ color: "var(--muted)", fontSize: 14, marginTop: 0 }}>
        {overview
          ? `${overview.relevant} relevant papers · latest ${overview.latest ?? "—"}`
          : "Loading overview…"}
      </p>

      <div
        style={{
          background: "rgba(248,113,113,.1)",
          border: "1px solid rgba(248,113,113,.3)",
          borderRadius: "var(--radius)",
          padding: 14,
          fontSize: 13,
          color: "var(--text)",
          margin: "20px 0 28px",
        }}
      >
        These actions crawl arXiv and call the LLM/embedding APIs — they spend
        free-tier quota and can take 30–90s.
      </div>

      {/* Index a paper */}
      <section className="card fade-in" style={sectionStyle}>
        <h2 style={sectionTitle}>Index a paper</h2>
        <p style={sectionDesc}>
          Fetch a single paper from arXiv by id and run it through the pipeline.
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input
            className="input"
            style={{ flex: 1, minWidth: 200 }}
            placeholder="2506.01234"
            value={arxivId}
            onChange={(e) => setArxivId(e.target.value)}
            disabled={indexing}
          />
          <button
            className="btn btn-primary"
            onClick={runIndex}
            disabled={indexing || !arxivId.trim()}
          >
            {indexing ? (
              <>
                <span className="spinner" style={{ marginRight: 8 }} />
                Indexing…
              </>
            ) : (
              "Index"
            )}
          </button>
        </div>
        {indexError && <p style={errStyle}>Error: {indexError}</p>}
        {indexResult != null && <Pre value={indexResult} />}
      </section>

      {/* Crawl a month */}
      <section className="card fade-in" style={sectionStyle}>
        <h2 style={sectionTitle}>Crawl a month</h2>
        <p style={sectionDesc}>
          Fetch a month of arXiv submissions in the configured categories and
          ingest them.
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input
            className="input"
            style={{ flex: 1, minWidth: 140 }}
            type="text"
            placeholder="YYYY-MM"
            value={ym}
            onChange={(e) => setYm(e.target.value)}
            disabled={crawling}
          />
          <input
            className="input"
            style={{ width: 110 }}
            type="number"
            min={1}
            max={150}
            value={maxPapers}
            onChange={(e) => setMaxPapers(Number(e.target.value))}
            disabled={crawling}
          />
          <button
            className="btn btn-primary"
            onClick={runCrawl}
            disabled={crawling || !ym.trim()}
          >
            {crawling ? (
              <>
                <span className="spinner" style={{ marginRight: 8 }} />
                Crawling…
              </>
            ) : (
              "Crawl"
            )}
          </button>
        </div>
        {crawlError && <p style={errStyle}>Error: {crawlError}</p>}
        {crawlResult != null && <Pre value={crawlResult} />}
      </section>

      {/* Browse by topic */}
      <section className="card fade-in" style={sectionStyle}>
        <h2 style={sectionTitle}>Browse by topic</h2>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
          {TOPICS.map((t) => (
            <a key={t.slug} href={`/papers?topic=${t.slug}`} className="chip">
              {t.name}
            </a>
          ))}
        </div>
      </section>
    </main>
  );
}
