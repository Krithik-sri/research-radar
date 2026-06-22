import { chatJSON } from "@/lib/llm/openrouter";
import { nearestPapers } from "./search";

export type Novelty = "novel" | "incremental" | "duplicate" | "unknown";

export interface DedupResult {
  novelty: Novelty;
  /** Id of the most similar existing paper, if similar enough to relate. */
  nearestId?: number;
  nearestSimilarity?: number;
}

// Above this cosine similarity we treat papers as potential duplicates/follow-ups
// and ask the LLM to adjudicate.
const SIMILAR_THRESHOLD = 0.82;
// Above this we short-circuit to "duplicate" without an LLM call.
const DUPLICATE_THRESHOLD = 0.97;

/**
 * Decide whether a freshly-embedded paper is novel, an incremental follow-up,
 * or a near-duplicate of something already in the KB. Cheap path first: if the
 * nearest neighbor is far away, it's novel with no LLM call.
 */
export async function assessNovelty(
  embedding: number[],
  paper: { title: string; abstract: string },
  excludeId?: number,
): Promise<DedupResult> {
  const [nearest] = await nearestPapers(embedding, { limit: 1, excludeId });

  if (!nearest || nearest.similarity < SIMILAR_THRESHOLD) {
    return { novelty: "novel", nearestId: nearest?.id, nearestSimilarity: nearest?.similarity };
  }
  if (nearest.similarity >= DUPLICATE_THRESHOLD) {
    return { novelty: "duplicate", nearestId: nearest.id, nearestSimilarity: nearest.similarity };
  }

  // Borderline: ask the fast model to judge novelty vs the nearest paper.
  try {
    const verdict = await chatJSON<{ novelty: Novelty }>(
      [
        {
          role: "system",
          content:
            "Compare two post-training papers. Decide if the NEW paper is a near-duplicate " +
            "of the EXISTING one, an incremental follow-up, or substantively novel.",
        },
        {
          role: "user",
          content:
            `EXISTING (similar by embedding): ${nearest.title}\n\n` +
            `NEW: ${paper.title}\n${paper.abstract}\n\n` +
            `Respond JSON: {"novelty": "duplicate" | "incremental" | "novel"}.`,
        },
      ],
      { tier: "fast", temperature: 0 },
    );
    const n = verdict.novelty;
    return {
      novelty: n === "duplicate" || n === "incremental" || n === "novel" ? n : "incremental",
      nearestId: nearest.id,
      nearestSimilarity: nearest.similarity,
    };
  } catch {
    return { novelty: "incremental", nearestId: nearest.id, nearestSimilarity: nearest.similarity };
  }
}
