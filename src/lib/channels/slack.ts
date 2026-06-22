/** Slack helpers: request signature verification + message posting (via fetch). */
import crypto from "node:crypto";
import { env } from "@/config/env";

/**
 * Verify a Slack request signature (v0 HMAC-SHA256) and reject stale requests.
 * See https://api.slack.com/authentication/verifying-requests-from-slack
 */
export function verifySlackSignature(rawBody: string, timestamp: string, signature: string): boolean {
  if (!timestamp || !signature) return false;
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > 60 * 5) return false; // 5-minute replay window

  const base = `v0:${timestamp}:${rawBody}`;
  const mac = "v0=" + crypto.createHmac("sha256", env.slackSigningSecret).update(base).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(signature));
  } catch {
    return false;
  }
}

/** Post a message to a channel using the bot token. */
export async function postSlackMessage(channel: string, text: string): Promise<void> {
  const res = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      Authorization: `Bearer ${env.slackBotToken}`,
    },
    body: JSON.stringify({ channel, text, unfurl_links: false }),
  });
  const data = (await res.json()) as { ok: boolean; error?: string };
  if (!data.ok) throw new Error(`Slack chat.postMessage failed: ${data.error}`);
}

/** Reply to a slash command via its response_url (works up to 30 min after). */
export async function postSlackResponseUrl(responseUrl: string, text: string): Promise<void> {
  await fetch(responseUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ response_type: "in_channel", text }),
  });
}
