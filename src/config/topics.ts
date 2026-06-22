/**
 * Canonical post-training topic taxonomy.
 * Used to seed the `topics` table and as the label set for LLM classification.
 * `keywords` drive the cheap pre-LLM relevance gate (see src/lib/kb/classify.ts).
 */
export interface TopicDef {
  slug: string;
  name: string;
  description: string;
  keywords: string[];
}

export const TOPICS: TopicDef[] = [
  {
    slug: "policy-optimization",
    name: "Policy Optimization",
    description:
      "RL policy optimization algorithms for LLMs/agents (PPO, GRPO, REINFORCE, DPO variants framed as policy opt, trust-region, off-policy).",
    keywords: ["ppo", "grpo", "reinforce", "policy optimization", "trust region", "advantage", "actor-critic", "gae"],
  },
  {
    slug: "preference-alignment",
    name: "Preference / Alignment",
    description:
      "Aligning models to human/AI preferences and values; preference optimization objectives and safety alignment.",
    keywords: ["dpo", "ipo", "kto", "orpo", "preference optimization", "alignment", "constitutional", "value alignment"],
  },
  {
    slug: "rlhf",
    name: "RLHF",
    description: "Reinforcement Learning from Human Feedback pipelines and improvements.",
    keywords: ["rlhf", "human feedback", "reward model", "ppo from human", "online rlhf"],
  },
  {
    slug: "rlvr",
    name: "RLVR",
    description:
      "Reinforcement Learning from Verifiable Rewards — training with programmatic/verifiable reward signals (math, code, tools).",
    keywords: ["rlvr", "verifiable reward", "verifiable rewards", "rule-based reward", "outcome reward", "process reward"],
  },
  {
    slug: "reward-modeling",
    name: "Reward Modeling",
    description: "Training, scaling, and analyzing reward models, including process/outcome and generative reward models.",
    keywords: ["reward model", "reward modeling", "process reward model", "prm", "outcome reward model", "reward hacking"],
  },
  {
    slug: "distillation",
    name: "Distillation",
    description: "Knowledge/reasoning distillation from larger or teacher models into smaller/student models.",
    keywords: ["distillation", "distill", "teacher model", "student model", "on-policy distillation"],
  },
  {
    slug: "agentic-rl-env",
    name: "Agentic / RL Env",
    description: "Agentic training, tool use, and RL environments/sandboxes for LLM agents.",
    keywords: ["agent", "agentic", "tool use", "rl environment", "sandbox", "multi-turn", "web agent", "computer use"],
  },
  {
    slug: "reasoning",
    name: "Reasoning",
    description: "Eliciting and improving reasoning (chain-of-thought, long-CoT, test-time compute, self-correction).",
    keywords: ["reasoning", "chain-of-thought", "chain of thought", "long cot", "test-time compute", "self-correction", "o1", "thinking"],
  },
  {
    slug: "sft-instruction-tuning",
    name: "SFT / Instruction Tuning",
    description: "Supervised fine-tuning and instruction tuning recipes, data curation, and analysis.",
    keywords: ["sft", "supervised fine-tuning", "instruction tuning", "instruction-following", "fine-tune", "lora", "peft"],
  },
  {
    slug: "data-synthetic",
    name: "Data / Synthetic",
    description: "Synthetic data generation, data filtering/curation, and data-centric post-training methods.",
    keywords: ["synthetic data", "data generation", "data curation", "data filtering", "self-instruct", "rejection sampling"],
  },
  {
    slug: "other-post-training",
    name: "Other Post-Training",
    description: "Post-training work that does not cleanly fit another topic (evaluation of post-training, merging, quantization-aware tuning, etc.).",
    keywords: ["post-training", "post training", "model merging", "fine-tuning"],
  },
];

export const TOPIC_SLUGS = TOPICS.map((t) => t.slug);

/** Flat keyword set used by the cheap relevance gate. */
export const RELEVANCE_KEYWORDS: string[] = Array.from(
  new Set(TOPICS.flatMap((t) => t.keywords)),
);
