import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { papers, topics, paperTopics, paperRelations } from "@/lib/db/schema";
import { and, eq, inArray, sql } from "drizzle-orm";

export const runtime = "nodejs";

type GraphNode = {
  id: string;
  label: string;
  type: "topic" | "paper";
  topic: string | null;
  citations?: number;
  url?: string;
};

type GraphEdge = {
  source: string;
  target: string;
  kind: string;
};

/**
 * GET /api/graph?limit=120
 *
 * Returns a knowledge graph of the most-recent relevant papers, their single
 * top-confidence topic, topic-membership edges, and paper<->paper relations.
 */
export async function GET(req: NextRequest) {
  const rawLimit = Number(req.nextUrl.searchParams.get("limit"));
  const limit = Number.isFinite(rawLimit)
    ? Math.min(200, Math.max(20, Math.trunc(rawLimit)))
    : 120;

  // 1. Most-recent relevant papers.
  const paperRows = await db
    .select({
      id: papers.id,
      title: papers.title,
      citationCount: papers.citationCount,
      publishedAt: papers.publishedAt,
      url: papers.url,
    })
    .from(papers)
    .where(eq(papers.relevant, true))
    .orderBy(sql`${papers.publishedAt} DESC NULLS LAST`)
    .limit(limit);

  if (paperRows.length === 0) {
    return NextResponse.json({ nodes: [], edges: [] });
  }

  const paperIds = paperRows.map((p) => p.id);

  // 2. Topic assignments for those papers; pick highest-confidence topic each.
  const topicRows = await db
    .select({
      paperId: paperTopics.paperId,
      confidence: paperTopics.confidence,
      slug: topics.slug,
      name: topics.name,
    })
    .from(paperTopics)
    .innerJoin(topics, eq(paperTopics.topicId, topics.id))
    .where(inArray(paperTopics.paperId, paperIds));

  // paperId -> { slug, name, confidence } (best confidence wins)
  const topTopicByPaper = new Map<number, { slug: string; name: string; confidence: number }>();
  for (const r of topicRows) {
    const cur = topTopicByPaper.get(r.paperId);
    if (!cur || r.confidence > cur.confidence) {
      topTopicByPaper.set(r.paperId, { slug: r.slug, name: r.name, confidence: r.confidence });
    }
  }

  // 3. Build nodes.
  const nodes: GraphNode[] = [];

  // Topic nodes: only topics that are the top-topic of >=1 included paper.
  const topicNodeBySlug = new Map<string, string>(); // slug -> name
  for (const { slug, name } of topTopicByPaper.values()) {
    if (!topicNodeBySlug.has(slug)) topicNodeBySlug.set(slug, name);
  }
  for (const [slug, name] of topicNodeBySlug) {
    nodes.push({ id: "t:" + slug, label: name, type: "topic", topic: slug });
  }

  // Paper nodes.
  for (const p of paperRows) {
    const top = topTopicByPaper.get(p.id);
    nodes.push({
      id: "p:" + p.id,
      label: p.title,
      type: "paper",
      topic: top ? top.slug : null,
      citations: p.citationCount,
      url: p.url,
    });
  }

  // 4. Build edges.
  const edges: GraphEdge[] = [];

  // Membership edges: topic -> paper.
  for (const p of paperRows) {
    const top = topTopicByPaper.get(p.id);
    if (top) {
      edges.push({ source: "t:" + top.slug, target: "p:" + p.id, kind: "topic" });
    }
  }

  // Relation edges: paper -> paper (both endpoints within the included set).
  const relationRows = await db
    .select({
      fromPaper: paperRelations.fromPaper,
      toPaper: paperRelations.toPaper,
      type: paperRelations.type,
    })
    .from(paperRelations)
    .where(
      and(
        inArray(paperRelations.fromPaper, paperIds),
        inArray(paperRelations.toPaper, paperIds),
      ),
    );

  for (const r of relationRows) {
    edges.push({
      source: "p:" + r.fromPaper,
      target: "p:" + r.toPaper,
      kind: r.type,
    });
  }

  return NextResponse.json({ nodes, edges });
}
