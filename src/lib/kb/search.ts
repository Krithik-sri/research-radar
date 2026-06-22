import { and, desc, eq, isNotNull, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { papers, paperTopics, topics } from "@/lib/db/schema";
import { embed } from "@/lib/embeddings";
import { chat } from "@/lib/llm/openrouter";

/** Format a JS number[] as a pgvector literal: "[1,2,3]". */
export function toVectorLiteral(v: number[]): string {
  return `[${v.join(",")}]`;
}

export interface Neighbor {
  id: number;
  arxivId: string;
  title: string;
  similarity: number;
}

/**
 * Cosine nearest-neighbor search over the embedding column (pgvector HNSW).
 * Returns papers ordered most-similar first.
 */
export async function nearestPapers(
  embedding: number[],
  opts: { limit?: number; excludeId?: number; minSimilarity?: number } = {},
): Promise<Neighbor[]> {
  const { limit = 10, excludeId, minSimilarity } = opts;
  const vec = toVectorLiteral(embedding);
  const similarity = sql<number>`1 - (${papers.embedding} <=> ${vec}::vector)`;

  const conds = [isNotNull(papers.embedding)];
  if (excludeId !== undefined) conds.push(ne(papers.id, excludeId));

  const rows = await db
    .select({
      id: papers.id,
      arxivId: papers.arxivId,
      title: papers.title,
      similarity,
    })
    .from(papers)
    .where(and(...conds))
    .orderBy(sql`${papers.embedding} <=> ${vec}::vector`)
    .limit(limit);

  return minSimilarity ? rows.filter((r) => r.similarity >= minSimilarity) : rows;
}

export interface SearchHit {
  id: number;
  arxivId: string;
  title: string;
  url: string;
  summary: string | null;
  citationCount: number;
  publishedAt: Date | null;
  similarity: number;
}

/**
 * Semantic search for /ask. Embeds the query, retrieves top-k papers
 * (optionally filtered to a topic slug), returns rich hits for RAG.
 */
export async function semanticSearch(
  query: string,
  opts: { limit?: number; topicSlug?: string } = {},
): Promise<SearchHit[]> {
  const { limit = 8, topicSlug } = opts;
  const queryEmbedding = await embed(query);
  const vec = toVectorLiteral(queryEmbedding);
  const similarity = sql<number>`1 - (${papers.embedding} <=> ${vec}::vector)`;

  const conds = [isNotNull(papers.embedding), eq(papers.relevant, true)];

  // Optional topic filter via EXISTS against the join table.
  if (topicSlug) {
    conds.push(
      sql`EXISTS (
        SELECT 1 FROM ${paperTopics} pt
        JOIN ${topics} t ON t.id = pt.topic_id
        WHERE pt.paper_id = ${papers.id} AND t.slug = ${topicSlug}
      )`,
    );
  }

  const rows = await db
    .select({
      id: papers.id,
      arxivId: papers.arxivId,
      title: papers.title,
      url: papers.url,
      summary: papers.summary,
      citationCount: papers.citationCount,
      publishedAt: papers.publishedAt,
      similarity,
    })
    .from(papers)
    .where(and(...conds))
    .orderBy(sql`${papers.embedding} <=> ${vec}::vector`)
    .limit(limit);

  return rows;
}

/**
 * Full RAG answer for /ask: retrieve relevant papers, then have the smart
 * model answer the question grounded in them with inline [n] citations.
 */
export async function askKnowledgeBase(
  question: string,
  opts: { topicSlug?: string } = {},
): Promise<{ answer: string; sources: SearchHit[] }> {
  const sources = await semanticSearch(question, { limit: 8, topicSlug: opts.topicSlug });

  if (sources.length === 0) {
    return {
      answer:
        "I couldn't find anything relevant in the knowledge base yet. The crawler may not have ingested papers on this topic.",
      sources: [],
    };
  }

  const context = sources
    .map(
      (s, i) =>
        `[${i + 1}] ${s.title} (arXiv:${s.arxivId}, ${s.citationCount} citations)\n${s.summary ?? ""}`,
    )
    .join("\n\n");

  const system =
    "You answer questions about recent post-training research using ONLY the provided " +
    "paper context. Cite sources inline as [n] matching the numbered context. Be concise " +
    "and technical. If the context doesn't cover the question, say so honestly.";

  const answer = await chat(
    [
      { role: "system", content: system },
      { role: "user", content: `Question: ${question}\n\nPapers:\n${context}` },
    ],
    { tier: "smart", temperature: 0.3, maxTokens: 900 },
  );

  return { answer, sources };
}
