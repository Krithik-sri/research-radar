import { chatJSON } from "@/lib/llm/openrouter";
import { TOPICS, TOPIC_SLUGS, RELEVANCE_KEYWORDS } from "@/config/topics";

/**
 * Cheap pre-LLM relevance gate: does the title/abstract mention any
 * post-training keyword? Used to skip LLM calls on obviously-irrelevant papers
 * during the high-volume backfill.
 */
export function passesKeywordGate(title: string, abstract: string): boolean {
  const hay = `${title}\n${abstract}`.toLowerCase();
  return RELEVANCE_KEYWORDS.some((kw) => hay.includes(kw));
}

export interface Classification {
  relevant: boolean;
  /** Topic slugs with confidence in [0,1]. Empty if not relevant. */
  topics: { slug: string; confidence: number }[];
}

const TOPIC_LIST = TOPICS.map((t) => `- ${t.slug}: ${t.name} — ${t.description}`).join("\n");

/**
 * LLM classification: is this paper about LLM/agent post-training, and if so
 * which topics? Multi-label with confidence. Uses the fast/cheap model.
 */
export async function classifyPaper(title: string, abstract: string): Promise<Classification> {
  const system =
    "You are a strict research librarian for a team that studies POST-TRAINING of " +
    "large language models and LLM-based agents (everything after pretraining: SFT/" +
    "instruction tuning, RLHF, RLVR, preference optimization e.g. DPO, reward modeling, " +
    "distillation, reasoning/test-time-compute, agentic RL, synthetic data for LLMs).\n\n" +
    "A paper is RELEVANT only if it is substantively about TRAINING or fine-tuning " +
    "language models / LLM agents with one of those methods. Be strict — default to " +
    "relevant=false when unsure.\n\n" +
    "NOT relevant (set relevant=false even if a keyword appears): pure pretraining or " +
    "model architecture; classical ML / time-series / concept-drift; computer vision, " +
    "robotics or motion generation; generic multi-agent systems not about LLM training; " +
    "optimization/learning theory; NLP task benchmarks (translation, idioms, NER) that " +
    "don't propose a post-training method; applications that merely USE an LLM without " +
    "training it. Matching a keyword (e.g. 'alignment' in 'idiom alignment', 'agent' in a " +
    "non-LLM multi-agent paper) is NOT enough.";

  const user =
    `Topics:\n${TOPIC_LIST}\n\n` +
    `Paper title: ${title}\n\nAbstract: ${abstract}\n\n` +
    `First decide relevance per the strict criteria. Respond as JSON: ` +
    `{"relevant": boolean, "topics": [{"slug": "<one of the topic slugs>", "confidence": 0..1}]}. ` +
    `If relevant, assign 1-3 topics (most confident first). If not, set relevant=false and topics=[].`;

  const result = await chatJSON<Classification>(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    { tier: "fast", temperature: 0 },
  );

  // Sanitize: keep only known slugs, clamp confidence.
  const topics = (result.topics ?? [])
    .filter((t) => TOPIC_SLUGS.includes(t.slug))
    .map((t) => ({ slug: t.slug, confidence: Math.max(0, Math.min(1, t.confidence ?? 0.5)) }));

  return { relevant: !!result.relevant && topics.length > 0, topics };
}
