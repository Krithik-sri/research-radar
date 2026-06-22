/**
 * Resumable, throttled historical backfill.
 *
 * Walks month-by-month from BACKFILL_SINCE up to the current month (newest
 * first), crawling arXiv for the configured categories and running each window
 * through the ingest pipeline. Window-level idempotency is tracked in
 * `crawl_runs`, so re-running only processes windows that are not yet "done".
 * Combined with per-paper skip logic in ingestPapers(), this run can be
 * interrupted and resumed freely without re-spending LLM/embedding quota.
 *
 * Run locally against Neon (keeps the heavy one-time crawl off serverless):
 *   npm run backfill
 */
import "./_env";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { crawlRuns } from "@/lib/db/schema";
import { env } from "@/config/env";
import { monthWindows } from "@/lib/sources/types";
import { fetchArxivWindow } from "@/lib/sources/arxiv";
import { ingestPapers } from "@/lib/kb/ingest";
import { RateLimitError } from "@/lib/llm/errors";

const SOURCE = "arxiv";
const ts = () => new Date().toLocaleTimeString();

async function main() {
  const now = new Date();
  const windows = monthWindows(env.backfillSince, now);
  const categories = env.arxivCategories;

  console.log(
    `Backfill: ${categories.join(", ")} across ${windows.length} month(s) ` +
      `(${windows[windows.length - 1].label} → ${windows[0].label})`,
  );

  for (const w of windows) {
    const windowFilter = and(
      eq(crawlRuns.source, SOURCE),
      eq(crawlRuns.periodStart, w.start),
      eq(crawlRuns.periodEnd, w.end),
    );

    const [existing] = await db.select().from(crawlRuns).where(windowFilter);
    if (existing?.status === "done") {
      console.log(`⏭  ${w.label} already done — skipping`);
      continue;
    }

    await db
      .insert(crawlRuns)
      .values({ source: SOURCE, periodStart: w.start, periodEnd: w.end, status: "running" })
      .onConflictDoUpdate({
        target: [crawlRuns.source, crawlRuns.periodStart, crawlRuns.periodEnd],
        set: { status: "running" },
      });

    try {
      console.log(`\n▶  [${ts()}] ${w.label}: fetching arXiv (${categories.join(", ")})…`);
      const raws = await fetchArxivWindow({
        categories,
        start: w.start,
        end: w.end,
        log: console.log,
      });
      console.log(`   [${ts()}] ${raws.length} papers found — ingesting…`);

      const stats = await ingestPapers(raws, { log: console.log });

      await db
        .update(crawlRuns)
        .set({
          status: "done",
          stats: { found: stats.found, upserted: stats.upserted, processed: stats.classified },
          finishedAt: new Date(),
        })
        .where(windowFilter);

      console.log(
        `✅ ${w.label}: gated ${stats.gated}, relevant ${stats.relevant}, ` +
          `upserted ${stats.upserted} (skipped ${stats.alreadyDone} already done)`,
      );
    } catch (err) {
      if (err instanceof RateLimitError) {
        // Daily free-tier cap reached. Leave this window as 'running' (resume will
        // redo it, skipping already-processed papers) and stop the run.
        console.error(
          `⏸  ${w.label}: hit the free-tier daily limit. Stopping.\n` +
            `   Re-run 'npm run backfill' later (e.g. tomorrow) to resume where it left off.`,
        );
        return;
      }
      console.error(`❌ ${w.label} failed — marking error, continuing:`, err);
      await db.update(crawlRuns).set({ status: "error" }).where(windowFilter);
    }
  }

  console.log("Backfill pass complete. Re-run to retry any windows left in 'error'.");
}

main().catch((err) => {
  console.error("Backfill crashed:", err);
  process.exit(1);
});
