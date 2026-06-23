/**
 * Print knowledge-base stats — how much is ingested, by topic, date range, and a
 * sample of recent papers. Use to diagnose coverage vs retrieval issues.
 * Usage: npm run stats
 */
import "./_env";
import { sql, eq, desc } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { papers, paperTopics, topics } from "@/lib/db/schema";

async function main() {
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(papers);
  const [{ rel }] = await db
    .select({ rel: sql<number>`count(*)::int` })
    .from(papers)
    .where(eq(papers.relevant, true));
  const [{ embedded }] = await db
    .select({ embedded: sql<number>`count(*)::int` })
    .from(papers)
    .where(sql`${papers.embedding} is not null`);

  console.log(`\nPapers: ${total} seen · ${rel} relevant · ${embedded} embedded (searchable)`);

  const byTopic = await db
    .select({ name: topics.name, n: sql<number>`count(*)::int` })
    .from(paperTopics)
    .innerJoin(topics, eq(topics.id, paperTopics.topicId))
    .groupBy(topics.name)
    .orderBy(desc(sql`count(*)`));
  console.log("\nBy topic:");
  if (!byTopic.length) console.log("  (none yet)");
  for (const t of byTopic) console.log(`  ${String(t.n).padStart(5)}  ${t.name}`);

  const [range] = await db
    .select({
      min: sql<string>`to_char(min(${papers.publishedAt}), 'YYYY-MM-DD')`,
      max: sql<string>`to_char(max(${papers.publishedAt}), 'YYYY-MM-DD')`,
    })
    .from(papers)
    .where(eq(papers.relevant, true));
  console.log(`\nRelevant published range: ${range?.min ?? "—"} → ${range?.max ?? "—"}`);

  const recent = await db
    .select({ arxivId: papers.arxivId, title: papers.title })
    .from(papers)
    .where(eq(papers.relevant, true))
    .orderBy(desc(papers.processedAt))
    .limit(8);
  console.log("\nMost recently ingested relevant papers:");
  if (!recent.length) console.log("  (none yet)");
  for (const p of recent) console.log(`  ${p.arxivId}  ${p.title.slice(0, 72)}`);
  console.log();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
