"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { TOPICS } from "@/config/topics";

interface PaperRow {
  id: number;
  arxivId: string;
  title: string;
  authors: string[];
  summary: string | null;
  citationCount: number;
  publishedAt: string | null;
  url: string;
  topics: string[];
}

const PAGE_SIZE = 50;

function fmtDate(d: string | null): string {
  if (!d) return "—";
  const parsed = new Date(d);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toISOString().slice(0, 10);
}

const th: React.CSSProperties = {
  padding: "11px 14px",
  textAlign: "left",
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "var(--muted)",
  background: "var(--surface-2)",
  borderBottom: "1px solid var(--border)",
  position: "sticky",
  top: 0,
};

const td: React.CSSProperties = {
  padding: "12px 14px",
  borderBottom: "1px solid var(--border)",
  verticalAlign: "top",
};

function PapersInner() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const [topic, setTopic] = useState<string>(searchParams.get("topic") ?? "");
  const [query, setQuery] = useState<string>(searchParams.get("q") ?? "");
  const [input, setInput] = useState<string>(searchParams.get("q") ?? "");
  const [offset, setOffset] = useState(0);

  const [rows, setRows] = useState<PaperRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const params = new URLSearchParams();
    if (topic) params.set("topic", topic);
    if (query) params.set("q", query);
    params.set("limit", String(PAGE_SIZE));
    params.set("offset", String(offset));

    fetch(`/api/papers?${params.toString()}`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data: { papers: PaperRow[]; total: number }) => {
        if (cancelled) return;
        setRows(data.papers ?? []);
        setTotal(data.total ?? 0);
      })
      .catch(() => {
        if (cancelled) return;
        setError("Couldn't load papers. Is the server running?");
        setRows([]);
        setTotal(0);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [topic, query, offset]);

  const runSearch = () => {
    setOffset(0);
    setQuery(input.trim());
  };

  const onTopicChange = (slug: string) => {
    setOffset(0);
    setTopic(slug);
    // Keep the URL in sync so the filter is shareable.
    const params = new URLSearchParams();
    if (slug) params.set("topic", slug);
    router.replace(`/papers${params.toString() ? `?${params.toString()}` : ""}`);
  };

  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + rows.length, total);
  const canPrev = offset > 0;
  const canNext = offset + PAGE_SIZE < total;

  return (
    <main className="container" style={{ paddingTop: 8 }}>
      <header className="slide-up" style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: 26, margin: "0 0 2px" }}>📄 Papers</h1>
        <p style={{ color: "var(--muted)", fontSize: 14, margin: 0 }}>
          Browse the post-training paper knowledge base.
        </p>
      </header>

      {/* Controls */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 10,
          alignItems: "center",
          margin: "0 0 18px",
        }}
      >
        <select
          className="input"
          value={topic}
          onChange={(e) => onTopicChange(e.target.value)}
        >
          <option value="">All topics</option>
          {TOPICS.map((t) => (
            <option key={t.slug} value={t.slug}>
              {t.name}
            </option>
          ))}
        </select>

        <input
          className="input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") runSearch();
          }}
          placeholder="Search titles & abstracts…"
          style={{ flex: 1, minWidth: 220 }}
        />
        <button className="btn" onClick={runSearch}>
          Search
        </button>

        <span style={{ color: "var(--muted)", fontSize: 13, marginLeft: "auto" }}>
          {total > 0 ? `Showing ${from}–${to} of ${total}` : "—"}
        </span>
      </div>

      {/* Error state */}
      {error && (
        <div
          className="card fade-in"
          style={{
            padding: "16px 18px",
            color: "var(--danger)",
            fontSize: 14,
            borderColor: "rgba(248,113,113,0.35)",
          }}
        >
          {error}
        </div>
      )}

      {/* Table card */}
      {!error && (
        <div
          className="card"
          style={{ overflow: "hidden" }}
        >
          {loading ? (
            <div style={{ padding: "6px 0" }}>
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  style={{
                    padding: "16px 14px",
                    borderBottom:
                      i < 5 ? "1px solid var(--border)" : "none",
                    display: "flex",
                    alignItems: "center",
                    gap: 14,
                  }}
                >
                  <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
                    <div
                      className="skeleton"
                      style={{ height: 13, width: `${70 - (i % 3) * 10}%` }}
                    />
                    <div
                      className="skeleton"
                      style={{ height: 10, width: `${90 - (i % 4) * 8}%` }}
                    />
                  </div>
                  <div className="skeleton" style={{ height: 12, width: 90, borderRadius: 999 }} />
                  <div className="skeleton" style={{ height: 12, width: 48 }} />
                  <div className="skeleton" style={{ height: 12, width: 72 }} />
                </div>
              ))}
            </div>
          ) : rows.length === 0 ? (
            <div
              className="fade-in"
              style={{
                padding: "48px 16px",
                textAlign: "center",
                color: "var(--muted)",
                fontSize: 14,
              }}
            >
              No papers match.
            </div>
          ) : (
            <table style={{ fontSize: 14 }}>
              <thead>
                <tr>
                  <th style={th}>Title</th>
                  <th style={th}>Topics</th>
                  <th style={{ ...th, textAlign: "right", whiteSpace: "nowrap" }}>
                    Citations
                  </th>
                  <th style={{ ...th, whiteSpace: "nowrap" }}>Published</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr
                    key={p.id}
                    className="fade-in paper-row"
                    style={{ transition: "background 0.15s ease" }}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.background = "var(--surface-2)")
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.background = "transparent")
                    }
                  >
                    <td style={{ ...td, maxWidth: 440 }}>
                      <a
                        href={p.url}
                        target="_blank"
                        rel="noreferrer"
                        style={{
                          color: "var(--accent-hover)",
                          fontWeight: 600,
                          textDecoration: "none",
                        }}
                      >
                        {p.title}
                      </a>
                      {p.summary && (
                        <div
                          style={{
                            color: "var(--muted)",
                            fontSize: 12.5,
                            marginTop: 4,
                            lineHeight: 1.45,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {p.summary}
                        </div>
                      )}
                    </td>
                    <td style={td}>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {p.topics.map((name) => (
                          <span key={name} className="chip" style={{ whiteSpace: "nowrap" }}>
                            {name}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td
                      style={{
                        ...td,
                        textAlign: "right",
                        whiteSpace: "nowrap",
                        fontVariantNumeric: "tabular-nums",
                        color: "var(--text)",
                      }}
                    >
                      {p.citationCount}
                    </td>
                    <td
                      style={{
                        ...td,
                        whiteSpace: "nowrap",
                        color: "var(--muted)",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {fmtDate(p.publishedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Pagination */}
      {!error && total > 0 && (
        <div
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            marginTop: 18,
          }}
        >
          <button
            className="btn"
            onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
            disabled={!canPrev}
          >
            ‹ Prev
          </button>
          <button
            className="btn"
            onClick={() => setOffset((o) => o + PAGE_SIZE)}
            disabled={!canNext}
          >
            Next ›
          </button>
          <span style={{ color: "var(--muted)", fontSize: 13, marginLeft: 4 }}>
            {from}–{to} of {total}
          </span>
        </div>
      )}
    </main>
  );
}

export default function PapersPage() {
  return (
    <Suspense
      fallback={
        <div style={{ color: "var(--muted)", padding: 24, fontSize: 14 }}>
          Loading…
        </div>
      }
    >
      <PapersInner />
    </Suspense>
  );
}
