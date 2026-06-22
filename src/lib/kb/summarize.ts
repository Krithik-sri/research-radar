import { chatJSON } from "@/lib/llm/openrouter";

export interface PaperSummary {
  oneLiner: string;
  method: string;
  results: string;
  whyItMatters: string;
  tags: string[];
}

/**
 * Produce a structured, skimmable summary of a paper from title + abstract.
 * Uses the fast model (called once per paper during ingestion).
 */
export async function summarizePaper(title: string, abstract: string): Promise<PaperSummary> {
  const system =
    "You summarize ML post-training papers for a team of researchers who want the " +
    "signal fast. Be concrete and technical; name methods, datasets, and numbers when " +
    "present. No hype, no filler.";

  const user =
    `Title: ${title}\n\nAbstract: ${abstract}\n\n` +
    `Respond as JSON with keys: ` +
    `"oneLiner" (<=160 chars, what they did + key result), ` +
    `"method" (2-3 sentences on the approach), ` +
    `"results" (2-3 sentences on findings/numbers), ` +
    `"whyItMatters" (1-2 sentences on significance for post-training research), ` +
    `"tags" (3-6 short technical keywords).`;

  const s = await chatJSON<PaperSummary>(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    { tier: "fast", temperature: 0.2 },
  );

  return {
    oneLiner: s.oneLiner ?? "",
    method: s.method ?? "",
    results: s.results ?? "",
    whyItMatters: s.whyItMatters ?? "",
    tags: Array.isArray(s.tags) ? s.tags.slice(0, 6) : [],
  };
}

/** Text used to compute a paper's embedding: title + abstract + summary signal. */
export function embeddingText(title: string, abstract: string, summary?: PaperSummary): string {
  const parts = [title, abstract];
  if (summary) parts.push(summary.oneLiner, summary.method, summary.tags.join(", "));
  return parts.filter(Boolean).join("\n");
}
