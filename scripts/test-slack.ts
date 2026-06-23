/**
 * Smoke-test the Slack bot token + digest channel by posting a message.
 * Verifies SLACK_BOT_TOKEN + chat:write scope + SLACK_DIGEST_CHANNEL — all
 * outbound, so it works locally without a public URL.
 * Usage: npm run test:slack
 */
import "./_env";
import { env } from "@/config/env";
import { postSlackMessage } from "@/lib/channels/slack";

async function main() {
  const channel = env.slackDigestChannel;
  if (!channel) {
    console.error("Set SLACK_DIGEST_CHANNEL in .env.local first (the channel ID, e.g. C0XXXXXXX).");
    process.exit(1);
  }
  console.log(`Posting a test message to ${channel}…`);
  await postSlackMessage(
    channel,
    "✅ *Research Radar* is connected to Slack. Digests and `/ask` replies will post here.",
  );
  console.log("✅ Sent. Check the channel — if you see the message, the bot token + channel are good.");
}

main().catch((err) => {
  console.error("\n❌ Slack test failed:\n", err);
  process.exit(1);
});
