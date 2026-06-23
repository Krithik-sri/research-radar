import { NextRequest, NextResponse } from "next/server";
import { and, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { papers, paperTopics, topics } from "@/lib/db/schema";

export const runtime = "nodejs";

/**
 * GET /api/papers?topic=<slug|empty>&q=<text>&limit=50&offset=0
 *
 * Lists relevant papers, optionally filtered by topic slug and/or a free-text
 * query over title/abstract. Returns a page of papers (each with its topic
 * names) plus the total count of matching rows.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const topic = (searchParams.get("topic") ?? "").trim();
  const q = (searchParams.get("q") ?? "").trim();

  const limit = Math.min(100, Math.max(1, Number(searchParams.get("limit")) || 50));
  const offset = Math.max(0, Number(searchParams.get("offset")) || 0);

  // Shared filters for both the page query and the total count.
  const conds = [eq(papers.relevant, true)];

  if (topic) {
    conds.push(
      sql`EXISTS (
        SELECT 1 FROM ${paperTopics} pt
        JOIN ${topics} t ON t.id = pt.topic_id
        WHERE pt.paper_id = ${papers.id} AND t.slug = ${topic}
      )`,
    );
  }

  if (q) {
    const like = `%${q}%`;
    conds.push(or(ilike(papers.title, like), ilike(papers.abstract, like))!);
  }

  const where = and(...conds);

  const [page, [{ total }]] = await Promise.all([
    db
      .select({
        id: papers.id,
        arxivId: papers.arxivId,
        title: papers.title,
        authors: papers.authors,
        summary: papers.summary,
        citationCount: papers.citationCount,
        publishedAt: papers.publishedAt,
        url: papers.url,
      })
      .from(papers)
      .where(where)
      .orderBy(sql`${papers.publishedAt} DESC NULLS LAST`)
      .limit(limit)
      .offset(offset),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(papers)
      .where(where),
  ]);

  // Fetch topic names for the page of papers, grouped by paper id.
  const pageIds = page.map((p) => p.id);
  const topicRows = pageIds.length
    ? await db
        .select({ paperId: paperTopics.paperId, name: topics.name })
        .from(paperTopics)
        .innerJoin(topics, eq(topics.id, paperTopics.topicId))
        .where(inArray(paperTopics.paperId, pageIds))
    : [];

  const topicsByPaper = new Map<number, string[]>();
  for (const row of topicRows) {
    const list = topicsByPaper.get(row.paperId);
    if (list) list.push(row.name);
    else topicsByPaper.set(row.paperId, [row.name]);
  }

  const result = page.map((p) => ({
    id: p.id,
    arxivId: p.arxivId,
    title: p.title,
    authors: p.authors,
    summary: p.summary,
    citationCount: p.citationCount,
    publishedAt: p.publishedAt,
    url: p.url,
    topics: topicsByPaper.get(p.id) ?? [],
  }));

  return NextResponse.json({ papers: result, total });
}
