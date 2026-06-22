import { RawPaper, canonicalArxivId } from "./types";

const HF_DAILY = "https://huggingface.co/api/daily_papers";

interface HfDailyItem {
  paper?: {
    id?: string; // arxiv id
    title?: string;
    summary?: string;
    authors?: { name?: string }[];
    publishedAt?: string;
    upvotes?: number;
  };
  title?: string;
  publishedAt?: string;
}

function toRawPaper(item: HfDailyItem): RawPaper | null {
  const id = item.paper?.id;
  if (!id) return null;
  const arxivId = canonicalArxivId(id);
  return {
    arxivId,
    title: (item.paper?.title ?? item.title ?? "").replace(/\s+/g, " ").trim(),
    authors: (item.paper?.authors ?? []).map((a) => a.name ?? "").filter(Boolean),
    abstract: (item.paper?.summary ?? "").replace(/\s+/g, " ").trim(),
    publishedAt: item.paper?.publishedAt
      ? new Date(item.paper.publishedAt)
      : item.publishedAt
        ? new Date(item.publishedAt)
        : null,
    updatedAt: null,
    url: `https://arxiv.org/abs/${arxivId}`,
    pdfUrl: `https://arxiv.org/pdf/${arxivId}`,
    categories: [],
    source: "huggingface",
  };
}

/**
 * Fetch Hugging Face "Daily Papers" for a given date (YYYY-MM-DD).
 * These are community-curated/trending — used as an `hfTrending` signal.
 */
export async function fetchHfDailyPapers(dateYYYYMMDD: string): Promise<RawPaper[]> {
  const res = await fetch(`${HF_DAILY}?date=${dateYYYYMMDD}`, {
    headers: { "User-Agent": "research-radar/0.1" },
  });
  if (!res.ok) {
    if (res.status === 404) return [];
    throw new Error(`HF daily_papers ${res.status}`);
  }
  const items: HfDailyItem[] = await res.json();
  return items.map(toRawPaper).filter((p): p is RawPaper => !!p);
}

/** Return the set of arXiv ids HF flagged as trending across a date range. */
export async function fetchHfTrendingIds(dates: string[]): Promise<Set<string>> {
  const ids = new Set<string>();
  for (const d of dates) {
    try {
      const papers = await fetchHfDailyPapers(d);
      papers.forEach((p) => ids.add(p.arxivId));
    } catch {
      // Non-fatal: HF trending is a best-effort signal.
    }
  }
  return ids;
}
