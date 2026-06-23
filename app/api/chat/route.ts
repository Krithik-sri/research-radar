import { NextRequest } from "next/server";
import { chatKnowledgeBaseStream, type ChatTurn } from "@/lib/kb/search";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Web chat endpoint — conversational RAG over the knowledge base, streamed as
 * newline-delimited JSON. First line is {"type":"sources",...}; subsequent lines
 * are {"type":"text","value":"…"} deltas.
 */
export async function POST(req: NextRequest) {
  let body: { messages?: ChatTurn[] };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), { status: 400 });
  }

  const messages = (body.messages ?? [])
    .filter(
      (m): m is ChatTurn =>
        !!m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string",
    )
    .slice(-12);

  if (messages.length === 0) {
    return new Response(JSON.stringify({ error: "No messages provided" }), { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const ev of chatKnowledgeBaseStream(messages)) {
          controller.enqueue(encoder.encode(JSON.stringify(ev) + "\n"));
        }
      } catch (err) {
        console.error("chat stream error:", err);
        controller.enqueue(
          encoder.encode(JSON.stringify({ type: "text", value: "\n\n[Something went wrong answering that.]" }) + "\n"),
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}
