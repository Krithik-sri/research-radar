import { NextResponse } from "next/server";
import { fetchArxivWindow } from "@/lib/sources/arxiv";
import { ingestPapers } from "@/lib/kb/ingest";
import { env } from "@/config/env";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const { ym, maxPapers } = (await req.json()) as { ym?: string; maxPapers?: number };

    if (!ym || typeof ym !== "string") {
      return NextResponse.json({ error: "ym (YYYY-MM) is required" }, { status: 400 });
    }

    const match = /^(\d{4})-(\d{2})$/.exec(ym.trim());
    if (!match) {
      return NextResponse.json({ error: "ym must be in YYYY-MM format" }, { status: 400 });
    }
    const year = Number(match[1]);
    const month = Number(match[2]);
    if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
      return NextResponse.json({ error: "Invalid year/month in ym" }, { status: 400 });
    }

    const start = new Date(Date.UTC(year, month - 1, 1));
    const end = new Date(Date.UTC(year, month, 1));

    const cap = Math.min(Math.max(maxPapers ?? 60, 1), 150);
    const maxPages = Math.ceil(cap / 100);

    let raws = await fetchArxivWindow({
      categories: env.arxivCategories,
      start,
      end,
      maxPages,
    });
    raws = raws.slice(0, cap);

    const stats = await ingestPapers(raws);
    return NextResponse.json({ ok: true, ym, fetched: raws.length, stats });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
