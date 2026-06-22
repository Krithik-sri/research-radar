/**
 * Digest builders. Daily = grouped roundup of papers ingested in the last 24h.
 * Weekly = LLM trend synthesis ("what's hot in post-training") over the week.
 * Both return plain markdown that posts cleanly to Slack and Discord, and are
 * recorded in the `digests` table.
 */
import { and, eq, gte, isNotNull, lt } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { papers, paperTopics, topics, digests } from "@/lib/db/schema";
import { chat } from "@/lib/llm/openrouter";

export interface DigestResult {
  period: string;
  content: string;
  paperIds: number[];
}

interface DigestPaper {
  id: number;
  arxivId: string;
  title: string;
  url: string;
  summary: string | null;
  citationCount: number;
  topicName: string;
  confidence: number;
}

/** Relevant papers processed in [since, until), collapsed to their top topic. */
async function papersInWindow(since: Date, until: Date): Promise<DigestPaper[]> {
  const rows = await db
    .select({
      id: papers.id,
      arxivId: papers.arxivId,
      title: papers.title,
      url: papers.url,
      summary: papers.summary,
      citationCount: papers.citationCount,
      topicName: topics.name,
      confidence: paperTopics.confidence,
    })
    .from(papers)
    .leftJoin(paperTopics, eq(paperTopics.paperId, papers.id))
    .leftJoin(topics, eq(topics.id, paperTopics.topicId))
    .where(
      and(
        eq(papers.relevant, true),
        isNotNull(papers.processedAt),
        gte(papers.processedAt, since),
        lt(papers.processedAt, until),
      ),
    );

  const best = new Map<number, DigestPaper>();
  for (const r of rows) {
    const conf = r.confidence ?? 0;
    const prev = best.get(r.id);
    if (!prev || conf > prev.confidence) {
      best.set(r.id, {
        id: r.id,
        arxivId: r.arxivId,
        title: r.title,
        url: r.url,
        summary: r.summary,
        citationCount: r.citationCount,
        topicName: r.topicName ?? "Other Post-Training",
        confidence: conf,
      });
    }
  }
  return [...best.values()];
}

function renderRoundup(header: string, papers: DigestPaper[]): string {
  const byTopic = new Map<string, DigestPaper[]>();
  for (const p of papers) {
    const arr = byTopic.get(p.topicName) ?? [];
    arr.push(p);
    byTopic.set(p.topicName, arr);
  }

  const sections = [...byTopic.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([topic, ps]) => {
      const items = ps
        .sort((a, b) => b.citationCount - a.citationCount)
        .slice(0, 6)
        .map((p) => `• *${p.title}* — ${p.summary ?? ""} (<${p.url}|arXiv:${p.arxivId}>)`)
        .join("\n");
      return `*${topic}* (${ps.length})\n${items}`;
    });

  return `${header}\n_${papers.length} new relevant paper(s)_\n\n${sections.join("\n\n")}`;
}

async function recordDigest(
  type: "daily" | "weekly",
  period: string,
  content: string,
  paperIds: number[],
): Promise<void> {
  await db.insert(digests).values({ type, period, content, paperIds });
}

export async function buildDailyDigest(now: Date): Promise<DigestResult> {
  const since = new Date(now.getTime() - 24 * 3600 * 1000);
  const period = now.toISOString().slice(0, 10);
  const found = await papersInWindow(since, now);
  if (found.length === 0) {
    return { period, content: `🗞 *Daily Research Radar* — ${period}\nNo new papers today.`, paperIds: [] };
  }
  const content = renderRoundup(`🗞 *Daily Research Radar* — ${period}`, found);
  const paperIds = found.map((p) => p.id);
  await recordDigest("daily", period, content, paperIds);
  return { period, content, paperIds };
}

export async function buildWeeklyDigest(now: Date): Promise<DigestResult> {
  const since = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
  const period = `week-of-${since.toISOString().slice(0, 10)}`;
  const found = await papersInWindow(since, now);
  if (found.length === 0) {
    return { period, content: `📈 *Weekly Research Radar* — ${period}\nNo new papers this week.`, paperIds: [] };
  }

  const top = found.sort((a, b) => b.citationCount - a.citationCount).slice(0, 30);
  const list = top
    .map((p) => `- [${p.topicName}] ${p.title} (arXiv:${p.arxivId}, ${p.citationCount} cites): ${p.summary ?? ""}`)
    .join("\n");

  const synthesis = await chat(
    [
      {
        role: "system",
        content:
          "You write a weekly research digest for an LLM post-training team. From the " +
          "papers provided, identify 3-5 themes/trends, call out the most notable papers, " +
          "and keep it skimmable. Use short markdown headers and bullet points. No hype.",
      },
      { role: "user", content: `Papers ingested this week:\n${list}\n\nWrite the weekly "What's hot in post-training" digest.` },
    ],
    { tier: "smart", temperature: 0.4, maxTokens: 1200 },
  );

  const content = `📈 *Weekly Research Radar* — ${period}\n\n${synthesis}`;
  const paperIds = top.map((p) => p.id);
  await recordDigest("weekly", period, content, paperIds);
  return { period, content, paperIds };
}
