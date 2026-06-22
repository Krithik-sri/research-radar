/**
 * The ingestion orchestrator — the glue that turns crawled RawPapers into
 * knowledge-base rows:
 *
 *   keyword gate → classify → summarize → embed → upsert paper
 *                → topic edges → similarity edges → (S2) citation edges
 *
 * Designed for the strictly-free, throttled backfill:
 *  - Papers already processed (processedAt set) are skipped up-front, so a
 *    resumed run never re-spends LLM/embedding quota on the same paper.
 *  - The cheap keyword gate runs before any paid call.
 *  - Irrelevant (gate-passing but classifier-rejected) papers are recorded as
 *    lightweight stub rows so they aren't re-classified on the next pass.
 */
import { and, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { papers, paperTopics, topics } from "@/lib/db/schema";
import type { RawPaper } from "@/lib/sources/types";
import { passesKeywordGate, classifyPaper } from "./classify";
import { summarizePaper, embeddingText } from "./summarize";
import { embed } from "@/lib/embeddings";
import { buildSimilarityEdges, buildCitationEdges } from "./graph";
import { enrichWithS2 } from "@/lib/sources/semanticScholar";

export interface IngestStats {
  found: number; // raw papers handed in
  alreadyDone: number; // skipped — already processed in a prior run
  gated: number; // passed the cheap keyword gate
  classified: number; // sent to the LLM classifier
  relevant: number; // classifier said relevant
  upserted: number; // fully ingested (summary + embedding + edges)
}

export interface IngestOptions {
  /** Build similarity edges in the knowledge graph (default true). */
  withSimilarityEdges?: boolean;
  /** Enrich with Semantic Scholar citations + reference edges (default true). */
  withS2?: boolean;
  /** Optional progress logger (e.g. console.log) for the backfill. */
  log?: (msg: string) => void;
}

/** Map a RawPaper to the columns shared by stub and full inserts. */
function baseValues(r: RawPaper) {
  return {
    arxivId: r.arxivId,
    title: r.title,
    authors: r.authors,
    abstract: r.abstract,
    publishedAt: r.publishedAt,
    updatedAtSource: r.updatedAt,
    url: r.url,
    pdfUrl: r.pdfUrl,
    categories: r.categories,
    source: r.source,
  };
}

export async function ingestPapers(
  raws: RawPaper[],
  opts: IngestOptions = {},
): Promise<IngestStats> {
  const withSimilarityEdges = opts.withSimilarityEdges ?? true;
  const withS2 = opts.withS2 ?? true;
  const log = opts.log ?? (() => {});

  const stats: IngestStats = {
    found: raws.length,
    alreadyDone: 0,
    gated: 0,
    classified: 0,
    relevant: 0,
    upserted: 0,
  };

  // De-duplicate within the batch by arXiv id.
  const byId = new Map<string, RawPaper>();
  for (const r of raws) if (!byId.has(r.arxivId)) byId.set(r.arxivId, r);
  const unique = [...byId.values()];
  if (!unique.length) return stats;

  // Skip anything already processed in a previous (possibly interrupted) run.
  const ids = unique.map((r) => r.arxivId);
  const doneRows: { arxivId: string }[] = [];
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const rows = await db
      .select({ arxivId: papers.arxivId })
      .from(papers)
      .where(and(inArray(papers.arxivId, chunk), isNotNull(papers.processedAt)));
    doneRows.push(...rows);
  }
  const done = new Set(doneRows.map((r) => r.arxivId));
  stats.alreadyDone = done.size;
  const todo = unique.filter((r) => !done.has(r.arxivId));
  log(`  ingest: ${unique.length} unique · ${stats.alreadyDone} already done · ${todo.length} to scan`);

  // Topic slug -> id lookup (table is seeded once via scripts/seed-topics).
  const topicRows = await db.select({ id: topics.id, slug: topics.slug }).from(topics);
  const topicIdBySlug = new Map(topicRows.map((t) => [t.slug, t.id]));

  const relevantIds: string[] = [];
  const paperIdByArxiv = new Map<string, number>();

  for (const r of todo) {
    // 1. Cheap keyword gate — no paid call for obviously-irrelevant papers.
    if (!passesKeywordGate(r.title, r.abstract)) continue;
    stats.gated += 1;
    log(`  [${stats.gated}] ${r.arxivId} — "${r.title.slice(0, 70)}"`);

    // 2. LLM relevance + topic classification.
    const classification = await classifyPaper(r.title, r.abstract);
    stats.classified += 1;

    if (!classification.relevant) {
      // Record a lightweight stub so we don't re-classify next pass.
      await db
        .insert(papers)
        .values({ ...baseValues(r), relevant: false, processedAt: new Date() })
        .onConflictDoUpdate({
          target: papers.arxivId,
          set: { relevant: false, processedAt: new Date() },
        });
      log(`        ↳ off-topic, skipped`);
      continue;
    }
    stats.relevant += 1;
    log(`        ↳ relevant (${classification.topics.map((t) => t.slug).join(", ")}) — summarizing + embedding…`);

    // 3. Summarize + 4. embed.
    const summary = await summarizePaper(r.title, r.abstract);
    const vector = await embed(embeddingText(r.title, r.abstract, summary));

    // 5. Upsert the full paper row.
    const full = {
      ...baseValues(r),
      relevant: true,
      summary: summary.oneLiner,
      summaryStruct: {
        method: summary.method,
        results: summary.results,
        whyItMatters: summary.whyItMatters,
        tags: summary.tags,
      },
      embedding: vector,
      processedAt: new Date(),
    };
    const [row] = await db
      .insert(papers)
      .values(full)
      .onConflictDoUpdate({
        target: papers.arxivId,
        set: {
          relevant: true,
          summary: full.summary,
          summaryStruct: full.summaryStruct,
          embedding: full.embedding,
          processedAt: full.processedAt,
        },
      })
      .returning({ id: papers.id });
    const paperId = row.id;
    paperIdByArxiv.set(r.arxivId, paperId);
    relevantIds.push(r.arxivId);

    // 6. Topic edges.
    for (const t of classification.topics) {
      const topicId = topicIdBySlug.get(t.slug);
      if (!topicId) continue;
      await db
        .insert(paperTopics)
        .values({ paperId, topicId, confidence: t.confidence })
        .onConflictDoNothing();
    }

    // 7. Similarity edges in the knowledge graph.
    if (withSimilarityEdges) {
      try {
        await buildSimilarityEdges(paperId, vector);
      } catch (err) {
        console.warn(`similarity edges failed for ${r.arxivId}:`, err);
      }
    }

    stats.upserted += 1;
    log(`        ↳ stored ✓`);
  }

  // 8. Semantic Scholar enrichment → citation edges (best-effort, batched).
  if (withS2 && relevantIds.length) {
    log(`  enriching ${relevantIds.length} paper(s) via Semantic Scholar…`);
    try {
      const enrichment = await enrichWithS2(relevantIds);
      for (const [arxivId, e] of enrichment) {
        const paperId = paperIdByArxiv.get(arxivId);
        if (!paperId) continue;
        await db
          .update(papers)
          .set({ citationCount: e.citationCount })
          .where(inArray(papers.arxivId, [arxivId]));
        if (e.referenceArxivIds?.length) {
          await buildCitationEdges(paperId, e.referenceArxivIds);
        }
      }
    } catch (err) {
      console.warn("S2 enrichment failed (continuing):", err);
    }
  }

  return stats;
}
