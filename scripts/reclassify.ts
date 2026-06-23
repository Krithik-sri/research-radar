/**
 * Re-run the (current, stricter) classifier over existing relevant=true papers
 * and flip false positives to relevant=false. Cleans data labeled by an older,
 * more lenient prompt — no re-embedding.
 *
 *   npm run reclassify -- --dry            # preview only, change nothing
 *   npm run reclassify -- --dry --limit 25 # preview a sample
 *   npm run reclassify                     # apply
 *
 * Spends ~1 Groq call per relevant paper, so it shares the free-tier rate limit
 * with a running backfill — best run during a backfill pause.
 */
import "./_env";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { papers, paperTopics } from "@/lib/db/schema";
import { classifyPaper } from "@/lib/kb/classify";
import { RateLimitError } from "@/lib/llm/errors";

function argNum(flag: string): number | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? Number(process.argv[i + 1]) : undefined;
}

async function main() {
  const dry = process.argv.includes("--dry");
  const limit = argNum("--limit");

  const base = db
    .select({ id: papers.id, arxivId: papers.arxivId, title: papers.title, abstract: papers.abstract })
    .from(papers)
    .where(eq(papers.relevant, true));
  const rows = limit ? await base.limit(limit) : await base;

  console.log(`${dry ? "[dry] " : ""}Re-checking ${rows.length} relevant paper(s)…\n`);
  let flipped = 0;
  let checked = 0;
  for (const p of rows) {
    let c;
    try {
      c = await classifyPaper(p.title, p.abstract);
    } catch (err) {
      if (err instanceof RateLimitError) {
        console.log(
          `\n⏸  Hit the daily token limit after ${checked} checked. ` +
            `Progress is saved — re-run 'npm run reclassify' later to continue (it only ` +
            `re-checks rows still marked relevant).`,
        );
        break;
      }
      throw err;
    }
    checked += 1;
    if (!c.relevant) {
      flipped += 1;
      console.log(`  ✗ ${p.arxivId}  ${p.title.slice(0, 72)}`);
      if (!dry) {
        // Drop the embedding too — a non-relevant paper never surfaces in search,
        // so the orphaned vector is just wasted storage.
        await db.update(papers).set({ relevant: false, embedding: null }).where(eq(papers.id, p.id));
        await db.delete(paperTopics).where(eq(paperTopics.paperId, p.id));
      }
    }
  }

  const pct = checked ? Math.round((flipped / checked) * 100) : 0;
  console.log(
    `\n${dry ? "[dry] would flip" : "Flipped"} ${flipped}/${checked} checked (${pct}%) to relevant=false.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
