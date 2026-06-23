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
  padding: "13px 16px",
  textAlign: "left",
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: "0.07em",
  textTransform: "uppercase",
  color: "var(--muted)",
  background: "rgba(23, 26, 37, 0.85)",
  backdropFilter: "blur(8px)",
  WebkitBackdropFilter: "blur(8px)",
  borderBottom: "1px solid var(--border)",
  position: "sticky",
  top: 0,
  zIndex: 1,
};

const td: React.CSSProperties = {
  padding: "14px 16px",
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
      <header className="slide-up" style={{ marginBottom: 22 }}>
        <h1
          className="gradient-text"
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 30,
            fontWeight: 700,
            letterSpacing: "-0.025em",
            margin: "0 0 4px",
          }}
        >
          Papers
        </h1>
        <p style={{ color: "var(--muted)", fontSize: 14.5, margin: 0 }}>
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

        <span
          style={{
            color: "var(--muted)",
            fontSize: 13,
            marginLeft: "auto",
            textAlign: "right",
            fontVariantNumeric: "tabular-nums",
            whiteSpace: "nowrap",
          }}
        >
          {total > 0 ? `Showing ${from}–${to} of ${total}` : "—"}
        </span>
      </div>

      {/* Error state */}
      {error && (
        <div
          className="card fade-in"
          style={{
            padding: "18px 20px",
            color: "var(--danger)",
            fontSize: 14,
            display: "flex",
            alignItems: "center",
            gap: 10,
            background: "rgba(251, 113, 133, 0.06)",
            borderColor: "rgba(251, 113, 133, 0.35)",
          }}
        >
          <span aria-hidden style={{ fontSize: 16, lineHeight: 1 }}>
            ⚠
          </span>
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
                padding: "60px 16px",
                textAlign: "center",
                color: "var(--muted)",
                fontSize: 14,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 8,
              }}
            >
              <span aria-hidden style={{ fontSize: 26, opacity: 0.6 }}>
                🔍
              </span>
              <span style={{ fontFamily: "var(--font-display)", fontWeight: 500, color: "var(--text)" }}>
                No papers match
              </span>
              <span style={{ fontSize: 13 }}>
                Try a different topic or search term.
              </span>
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
                      (e.currentTarget.style.background =
                        "rgba(255, 255, 255, 0.03)")
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.background = "transparent")
                    }
                  >
                    <td style={{ ...td, maxWidth: 460 }}>
                      <a
                        href={p.url}
                        target="_blank"
                        rel="noreferrer"
                        style={{
                          color: "var(--accent-hover)",
                          fontFamily: "var(--font-display)",
                          fontWeight: 500,
                          fontSize: 14.5,
                          letterSpacing: "-0.01em",
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
            gap: 10,
            alignItems: "center",
            marginTop: 20,
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
          <span
            style={{
              color: "var(--muted)",
              fontSize: 13,
              marginLeft: "auto",
              fontVariantNumeric: "tabular-nums",
              whiteSpace: "nowrap",
            }}
          >
            Page {Math.floor(offset / PAGE_SIZE) + 1} of{" "}
            {Math.max(1, Math.ceil(total / PAGE_SIZE))}
            <span style={{ opacity: 0.5 }}> · </span>
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
