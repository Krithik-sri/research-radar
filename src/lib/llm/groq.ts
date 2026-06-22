/**
 * Chat completions via Groq's OpenAI-compatible API. Genuinely free tier with
 * high daily limits (e.g. llama-3.1-8b-instant ~14.4k req/day), which suits the
 * high-volume classify/summarize backfill. Sits behind the shared chat()/chatJSON()
 * dispatcher. Note: Groq has no embeddings endpoint — embeddings use Gemini.
 */
import { env } from "@/config/env";
import { RateLimitError } from "./errors";
import type { ChatMessage, ChatOpts } from "./openrouter";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function groqChat(messages: ChatMessage[], opts: ChatOpts = {}): Promise<string> {
  const model = opts.tier === "smart" ? env.groqModelSmart : env.groqModelFast;

  const body: Record<string, unknown> = {
    model,
    messages,
    temperature: opts.temperature ?? 0.3,
    max_tokens: opts.maxTokens ?? 1200,
  };
  // Groq supports OpenAI-style JSON mode (prompts already instruct "respond as JSON").
  if (opts.json) body.response_format = { type: "json_object" };

  const maxAttempts = 5;
  let last429 = false;
  let lastErr = "";
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const res = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.groqKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (res.status === 429 || res.status >= 500) {
      last429 = res.status === 429;
      lastErr = `${res.status} ${await res.text().catch(() => "")}`;
      await sleep(2000 * 2 ** attempt);
      continue;
    }
    if (!res.ok) throw new Error(`Groq ${res.status}: ${await res.text()}`);

    const data = await res.json();
    const content: string | undefined = data?.choices?.[0]?.message?.content;
    if (!content) throw new Error("Groq returned empty content");
    return content;
  }

  if (last429) throw new RateLimitError(`Groq rate-limited after ${maxAttempts} attempts: ${lastErr}`);
  throw new Error(`Groq failed after ${maxAttempts} attempts: ${lastErr}`);
}
