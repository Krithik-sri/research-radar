import { XMLParser } from "fast-xml-parser";
import { RawPaper, canonicalArxivId } from "./types";

const ARXIV_API = "http://export.arxiv.org/api/query";
const PAGE_SIZE = 100;
// arXiv asks for ~3s between requests; be polite to avoid throttling.
const REQUEST_DELAY_MS = 3500;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  isArray: (name) => ["entry", "author", "category", "link"].includes(name),
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function fmtDate(d: Date): string {
  // arXiv submittedDate format: YYYYMMDDHHMM
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(
    d.getUTCHours(),
  )}${p(d.getUTCMinutes())}`;
}

interface ArxivEntry {
  id: string;
  title: string;
  summary: string;
  published: string;
  updated: string;
  author?: { name: string }[];
  category?: { "@_term": string }[];
  link?: { "@_href": string; "@_title"?: string; "@_type"?: string }[];
}

function toRawPaper(entry: ArxivEntry): RawPaper {
  const arxivId = canonicalArxivId(entry.id);
  const pdf =
    entry.link?.find((l) => l["@_title"] === "pdf" || l["@_type"] === "application/pdf")?.[
      "@_href"
    ] ?? `https://arxiv.org/pdf/${arxivId}`;
  return {
    arxivId,
    title: (entry.title ?? "").replace(/\s+/g, " ").trim(),
    authors: (entry.author ?? []).map((a) => a.name).filter(Boolean),
    abstract: (entry.summary ?? "").replace(/\s+/g, " ").trim(),
    publishedAt: entry.published ? new Date(entry.published) : null,
    updatedAt: entry.updated ? new Date(entry.updated) : null,
    url: `https://arxiv.org/abs/${arxivId}`,
    pdfUrl: pdf,
    categories: (entry.category ?? []).map((c) => c["@_term"]).filter(Boolean),
    source: "arxiv",
  };
}

/**
 * Fetch all arXiv papers in the given categories submitted within [start, end).
 * Paginates through the API and stops when a page returns fewer than PAGE_SIZE
 * results. Returns deduped-by-id papers.
 */
export async function fetchArxivWindow(opts: {
  categories: string[];
  start: Date;
  end: Date;
  maxPages?: number;
  /** Optional progress logger (e.g. console.log) for the backfill. */
  log?: (msg: string) => void;
}): Promise<RawPaper[]> {
  const { categories, start, end, maxPages = 50, log } = opts;
  const catClause = categories.map((c) => `cat:${c}`).join("+OR+");
  const dateClause = `submittedDate:[${fmtDate(start)}+TO+${fmtDate(end)}]`;
  const searchQuery = `(${catClause})+AND+${dateClause}`;

  const byId = new Map<string, RawPaper>();

  for (let page = 0; page < maxPages; page++) {
    const url =
      `${ARXIV_API}?search_query=${searchQuery}` +
      `&start=${page * PAGE_SIZE}&max_results=${PAGE_SIZE}` +
      `&sortBy=submittedDate&sortOrder=descending`;

    const res = await fetch(url, { headers: { "User-Agent": "research-radar/0.1" } });
    if (!res.ok) throw new Error(`arXiv API ${res.status}: ${await res.text()}`);
    const xml = await res.text();
    const feed = parser.parse(xml)?.feed;
    const entries: ArxivEntry[] = feed?.entry ?? [];

    if (entries.length === 0) break;
    for (const e of entries) {
      const p = toRawPaper(e);
      if (p.arxivId) byId.set(p.arxivId, p);
    }
    log?.(`     arXiv page ${page + 1}: +${entries.length} (running total ${byId.size})`);
    if (entries.length < PAGE_SIZE) break;
    await sleep(REQUEST_DELAY_MS);
  }

  return [...byId.values()];
}

/** Fetch a single paper by arXiv id (used by /summarize). */
export async function fetchArxivById(arxivId: string): Promise<RawPaper | null> {
  const id = canonicalArxivId(arxivId);
  const url = `${ARXIV_API}?id_list=${id}&max_results=1`;
  const res = await fetch(url, { headers: { "User-Agent": "research-radar/0.1" } });
  if (!res.ok) throw new Error(`arXiv API ${res.status}`);
  const entries: ArxivEntry[] = parser.parse(await res.text())?.feed?.entry ?? [];
  return entries.length ? toRawPaper(entries[0]) : null;
}
