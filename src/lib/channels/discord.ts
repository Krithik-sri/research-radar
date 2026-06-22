/** Discord helpers: interaction signature verification + posting. */
import { verifyKey } from "discord-interactions";
import { env } from "@/config/env";

/** Verify an incoming interaction request (Ed25519). Async in discord-interactions v4. */
export async function verifyDiscordRequest(
  rawBody: string,
  signature: string,
  timestamp: string,
): Promise<boolean> {
  if (!signature || !timestamp) return false;
  try {
    return await verifyKey(rawBody, signature, timestamp, env.discordPublicKey);
  } catch {
    return false;
  }
}

/** Post a message to the configured digest webhook (best-effort). */
export async function postDiscordWebhook(content: string): Promise<void> {
  if (!env.discordDigestWebhook) return;
  // Discord caps message content at 2000 chars.
  await fetch(env.discordDigestWebhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: content.slice(0, 1990) }),
  });
}

/** Edit the original deferred interaction response with the final answer. */
export async function editDiscordReply(interactionToken: string, content: string): Promise<void> {
  const url = `https://discord.com/api/v10/webhooks/${env.discordAppId}/${interactionToken}/messages/@original`;
  await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: content.slice(0, 1990) }),
  });
}
