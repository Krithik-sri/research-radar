import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { papers } from "@/lib/db/schema";
import { sql, eq } from "drizzle-orm";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
  try {
    const [totalRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(papers);

    const [relevantRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(papers)
      .where(eq(papers.relevant, true));

    const [latestRow] = await db
      .select({ latest: sql<string | null>`to_char(max(${papers.publishedAt}), 'YYYY-MM-DD')` })
      .from(papers)
      .where(eq(papers.relevant, true));

    return NextResponse.json({
      total: totalRow?.count ?? 0,
      relevant: relevantRow?.count ?? 0,
      latest: latestRow?.latest ?? null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
