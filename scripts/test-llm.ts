/**
 * Quick smoke test for the LLM provider + embeddings, so you can validate keys
 * without waiting on a backfill. Run: `npm run test:llm`
 */
import "./_env";
import { env } from "@/config/env";
import { chat } from "@/lib/llm/openrouter";
import { embed } from "@/lib/embeddings";

async function main() {
  const fastModel =
    env.llmProvider === "groq"
      ? env.groqModelFast
      : env.llmProvider === "gemini"
        ? env.geminiModelFast
        : env.modelFast;
  console.log(`LLM_PROVIDER = ${env.llmProvider}`);
  console.log(`fast model   = ${fastModel}`);

  console.log("\n→ Testing chat()...");
  const reply = await chat([{ role: "user", content: 'Reply with exactly the word: ok' }], {
    tier: "fast",
    maxTokens: 10,
  });
  console.log("   chat OK →", JSON.stringify(reply.trim().slice(0, 80)));

  console.log("\n→ Testing embed()...");
  const v = await embed("post-training reinforcement learning from human feedback");
  console.log(`   embed OK → ${v.length}-dim vector`);

  console.log("\n✅ LLM + embeddings are working. Safe to run `npm run backfill`.");
}

main().catch((err) => {
  console.error("\n❌ Test failed:\n", err);
  process.exit(1);
});
