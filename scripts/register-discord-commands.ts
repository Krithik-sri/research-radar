/**
 * Register (or update) the global `/ask` slash command for the Discord app.
 * Run once after setting DISCORD_APP_ID + DISCORD_BOT_TOKEN: `npm run discord:register`.
 * Global commands can take up to ~1 hour to propagate.
 */
import "./_env";
import { env } from "@/config/env";

const commands = [
  {
    name: "ask",
    description: "Ask the post-training research knowledge base",
    options: [
      {
        name: "question",
        description: "Your question",
        type: 3, // STRING
        required: true,
      },
    ],
  },
];

async function main() {
  const url = `https://discord.com/api/v10/applications/${env.discordAppId}/commands`;
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bot ${env.discordBotToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(commands),
  });

  if (!res.ok) {
    throw new Error(`Discord command registration failed ${res.status}: ${await res.text()}`);
  }

  const data = (await res.json()) as { name: string }[];
  console.log("✅ Registered Discord commands:", data.map((c) => c.name).join(", "));
}

main().catch((err) => {
  console.error("❌ Registration failed:", err);
  process.exit(1);
});
