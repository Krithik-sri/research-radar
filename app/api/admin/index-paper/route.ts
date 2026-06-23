import { NextResponse } from "next/server";
import { fetchArxivById } from "@/lib/sources/arxiv";
import { ingestPapers } from "@/lib/kb/ingest";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const { arxivId } = (await req.json()) as { arxivId?: string };
    if (!arxivId || typeof arxivId !== "string") {
      return NextResponse.json({ error: "arxivId is required" }, { status: 400 });
    }

    const p = await fetchArxivById(arxivId);
    if (!p) {
      return NextResponse.json({ error: `Paper not found on arXiv: ${arxivId}` }, { status: 404 });
    }

    const stats = await ingestPapers([p], { withSimilarityEdges: true, withS2: false });
    return NextResponse.json({ ok: true, arxivId: p.arxivId, stats });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
