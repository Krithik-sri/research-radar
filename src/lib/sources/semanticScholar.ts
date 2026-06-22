import { env } from "@/config/env";
import { canonicalArxivId } from "./types";

const S2_BASE = "https://api.semanticscholar.org/graph/v1";

export interface S2Enrichment {
  arxivId: string;
  citationCount: number;
  influentialCitationCount: number;
  /** arXiv ids of papers this paper references (for citation graph edges). */
  referenceArxivIds: string[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function headers(): HeadersInit {
  const h: Record<string, string> = { "User-Agent": "research-radar/0.1" };
  if (env.s2Key) h["x-api-key"] = env.s2Key;
  return h;
}

interface S2Paper {
  externalIds?: { ArXiv?: string };
  citationCount?: number;
  influentialCitationCount?: number;
  references?: { externalIds?: { ArXiv?: string } | null }[];
}

function mapEnrichment(reqArxivId: string, p: S2Paper | null): S2Enrichment {
  const refIds = (p?.references ?? [])
    .map((r) => r.externalIds?.ArXiv)
    .filter((x): x is string => !!x)
    .map(canonicalArxivId);
  return {
    arxivId: reqArxivId,
    citationCount: p?.citationCount ?? 0,
    influentialCitationCount: p?.influentialCitationCount ?? 0,
    referenceArxivIds: [...new Set(refIds)],
  };
}

const FIELDS = "citationCount,influentialCitationCount,references.externalIds";

/**
 * Enrich up to 500 papers per call via the S2 batch endpoint.
 * Free tier is heavily rate-limited; callers should batch and pace.
 */
export async function enrichWithS2(arxivIds: string[]): Promise<Map<string, S2Enrichment>> {
  const out = new Map<string, S2Enrichment>();
  if (arxivIds.length === 0) return out;

  const ids = arxivIds.map((id) => `ARXIV:${canonicalArxivId(id)}`);
  const url = `${S2_BASE}/paper/batch?fields=${FIELDS}`;

  // Retry once on 429 with backoff.
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { ...headers(), "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    });

    if (res.status === 429) {
      await sleep(2000 * (attempt + 1));
      continue;
    }
    if (!res.ok) throw new Error(`S2 batch ${res.status}: ${await res.text()}`);

    const data: (S2Paper | null)[] = await res.json();
    data.forEach((p, i) => {
      const reqId = canonicalArxivId(arxivIds[i]);
      out.set(reqId, mapEnrichment(reqId, p));
    });
    return out;
  }

  // Rate-limited twice: return empty enrichment rather than failing the pipeline.
  for (const id of arxivIds) {
    const reqId = canonicalArxivId(id);
    out.set(reqId, mapEnrichment(reqId, null));
  }
  return out;
}
