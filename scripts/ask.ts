/**
 * Query the knowledge base from the terminal (local RAG — no bots/deploy needed).
 * Usage: npm run ask -- "how does GRPO differ from PPO?"
 */
import "./_env";
import { askKnowledgeBase } from "@/lib/kb/search";

async function main() {
  const question = process.argv.slice(2).join(" ").trim();
  if (!question) {
    console.error('Usage: npm run ask -- "your question"');
    process.exit(1);
  }

  console.log(`\n❓ ${question}\n`);
  const { answer, sources } = await askKnowledgeBase(question);
  console.log(answer);

  if (sources.length) {
    console.log("\nSources:");
    sources.forEach((s, i) =>
      console.log(`  [${i + 1}] ${s.title} — https://arxiv.org/abs/${s.arxivId}`),
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
