/** Normalized paper shape that every source adapter produces. */
export interface RawPaper {
  /** Canonical arXiv id WITHOUT version suffix, e.g. "2401.01234". */
  arxivId: string;
  title: string;
  authors: string[];
  abstract: string;
  publishedAt: Date | null;
  updatedAt: Date | null;
  url: string;
  pdfUrl: string;
  categories: string[];
  source: "arxiv" | "huggingface" | "semanticscholar";
}

/** Strip version suffix and any URL prefix to get a canonical arXiv id. */
export function canonicalArxivId(raw: string): string {
  const m = raw
    .trim()
    .replace(/^https?:\/\/arxiv\.org\/(abs|pdf)\//i, "")
    .replace(/\.pdf$/i, "")
    .replace(/^arxiv:/i, "")
    .match(/(\d{4}\.\d{4,5})(v\d+)?/);
  if (m) return m[1];
  // Old-style ids like "cs/0309040"
  const old = raw.match(/([a-z\-]+\/\d{7})(v\d+)?/i);
  return old ? old[1] : raw.trim();
}

export interface MonthWindow {
  /** Inclusive start of the month (UTC). */
  start: Date;
  /** Exclusive end of the month (UTC). */
  end: Date;
  /** "YYYY-MM" label. */
  label: string;
}

/** Build the list of month windows from `sinceYYYYMM` up to and including `now`'s month, newest first. */
export function monthWindows(sinceYYYYMM: string, now: Date): MonthWindow[] {
  const [sy, sm] = sinceYYYYMM.split("-").map(Number);
  const windows: MonthWindow[] = [];
  let y = now.getUTCFullYear();
  let m = now.getUTCMonth(); // 0-based
  while (y > sy || (y === sy && m >= sm - 1)) {
    const start = new Date(Date.UTC(y, m, 1));
    const end = new Date(Date.UTC(y, m + 1, 1));
    const label = `${y}-${String(m + 1).padStart(2, "0")}`;
    windows.push({ start, end, label });
    m -= 1;
    if (m < 0) {
      m = 11;
      y -= 1;
    }
  }
  return windows;
}
