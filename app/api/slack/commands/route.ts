import { NextRequest, NextResponse } from "next/server";
import { verifySlackSignature } from "@/lib/channels/slack";
import { inngest } from "@/lib/inngest/client";

export const runtime = "nodejs";

/**
 * Slack slash-command endpoint (e.g. `/ask <question>`). Verifies the request,
 * hands the question to Inngest, and acks immediately so we stay under Slack's
 * 3-second deadline. The async slackAsk function posts the answer back.
 */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  const ts = req.headers.get("x-slack-request-timestamp") ?? "";
  const sig = req.headers.get("x-slack-signature") ?? "";

  if (!verifySlackSignature(raw, ts, sig)) {
    return new NextResponse("invalid signature", { status: 401 });
  }

  const params = new URLSearchParams(raw);
  const question = (params.get("text") ?? "").trim();
  const responseUrl = params.get("response_url") ?? "";

  if (!question) {
    return NextResponse.json({ response_type: "ephemeral", text: "Usage: `/ask <your question>`" });
  }

  await inngest.send({ name: "slack/ask.requested", data: { question, responseUrl } });

  return NextResponse.json({
    response_type: "ephemeral",
    text: `:mag: Searching the research knowledge base for “${question}”…`,
  });
}
