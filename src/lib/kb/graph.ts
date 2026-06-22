import { and, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { papers, paperRelations } from "@/lib/db/schema";
import { nearestPapers } from "./search";

/**
 * Insert citation edges (type "cites") from `paperId` to any referenced arXiv
 * ids that already exist in the KB. Idempotent via the unique (from,to,type) index.
 */
export async function buildCitationEdges(
  paperId: number,
  referenceArxivIds: string[],
): Promise<number> {
  if (referenceArxivIds.length === 0) return 0;

  const targets = await db
    .select({ id: papers.id, arxivId: papers.arxivId })
    .from(papers)
    .where(inArray(papers.arxivId, referenceArxivIds));

  if (targets.length === 0) return 0;

  await db
    .insert(paperRelations)
    .values(
      targets.map((t) => ({
        fromPaper: paperId,
        toPaper: t.id,
        type: "cites" as const,
        weight: 1,
      })),
    )
    .onConflictDoNothing();

  return targets.length;
}

/**
 * Insert similarity edges (type "similar") between `paperId` and its top-k
 * nearest neighbors above a threshold. Edges are stored both directions-agnostic
 * (we always store from the new paper outward).
 */
export async function buildSimilarityEdges(
  paperId: number,
  embedding: number[],
  opts: { k?: number; minSimilarity?: number } = {},
): Promise<number> {
  const { k = 5, minSimilarity = 0.78 } = opts;
  const neighbors = await nearestPapers(embedding, {
    limit: k,
    excludeId: paperId,
    minSimilarity,
  });
  if (neighbors.length === 0) return 0;

  await db
    .insert(paperRelations)
    .values(
      neighbors.map((n) => ({
        fromPaper: paperId,
        toPaper: n.id,
        type: "similar" as const,
        weight: n.similarity,
      })),
    )
    .onConflictDoNothing();

  return neighbors.length;
}

export interface GraphNeighbor {
  id: number;
  arxivId: string;
  title: string;
  type: string;
  weight: number;
}

/** Fetch immediate graph neighbors of a paper (both incoming and outgoing). */
export async function neighborsOf(paperId: number, limit = 20): Promise<GraphNeighbor[]> {
  const rows = await db
    .select({
      id: papers.id,
      arxivId: papers.arxivId,
      title: papers.title,
      type: paperRelations.type,
      weight: paperRelations.weight,
    })
    .from(paperRelations)
    .innerJoin(
      papers,
      or(
        and(eq(paperRelations.fromPaper, paperId), eq(papers.id, paperRelations.toPaper)),
        and(eq(paperRelations.toPaper, paperId), eq(papers.id, paperRelations.fromPaper)),
      ),
    )
    .where(or(eq(paperRelations.fromPaper, paperId), eq(paperRelations.toPaper, paperId)))
    .orderBy(sql`${paperRelations.weight} DESC`)
    .limit(limit);

  return rows;
}
