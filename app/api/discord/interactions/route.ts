import { NextRequest, NextResponse } from "next/server";
import { InteractionType, InteractionResponseType } from "discord-interactions";
import { verifyDiscordRequest } from "@/lib/channels/discord";
import { inngest } from "@/lib/inngest/client";

export const runtime = "nodejs";

interface DiscordOption {
  name: string;
  value: string;
}

/**
 * Discord interactions endpoint. Verifies the Ed25519 signature, answers PINGs,
 * and for `/ask` defers the reply (type 5) while Inngest runs RAG and edits the
 * message — keeping this handler well under Discord's 3-second deadline.
 */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  const sig = req.headers.get("x-signature-ed25519") ?? "";
  const ts = req.headers.get("x-signature-timestamp") ?? "";

  if (!(await verifyDiscordRequest(raw, sig, ts))) {
    return new NextResponse("invalid request signature", { status: 401 });
  }

  const body = JSON.parse(raw);

  if (body.type === InteractionType.PING) {
    return NextResponse.json({ type: InteractionResponseType.PONG });
  }

  if (body.type === InteractionType.APPLICATION_COMMAND && body.data?.name === "ask") {
    const options: DiscordOption[] = body.data.options ?? [];
    const question = options.find((o) => o.name === "question")?.value ?? "";

    await inngest.send({ name: "discord/ask.requested", data: { question, token: body.token } });

    return NextResponse.json({
      type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
    });
  }

  return NextResponse.json({
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: { content: "Unknown command." },
  });
}
