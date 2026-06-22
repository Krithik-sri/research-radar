import { env } from "@/config/env";
import { RateLimitError } from "./errors";
import { geminiChat } from "./gemini";
import { groqChat } from "./groq";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOpts {
  /** "fast" = cheap/free model for bulk work; "smart" = higher quality for /ask & reports. */
  tier?: "fast" | "smart";
  temperature?: number;
  maxTokens?: number;
  /** Ask the provider to return strict JSON. */
  json?: boolean;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Provider-agnostic chat completion. Dispatches to Gemini (default, higher free
 * tier) or OpenRouter based on LLM_PROVIDER.
 */
export async function chat(messages: ChatMessage[], opts: ChatOpts = {}): Promise<string> {
  if (env.llmProvider === "groq") return groqChat(messages, opts);
  if (env.llmProvider === "gemini") return geminiChat(messages, opts);
  return openrouterChat(messages, opts);
}

/** Single chat completion via OpenRouter. Retries on 429/5xx with backoff. */
async function openrouterChat(messages: ChatMessage[], opts: ChatOpts = {}): Promise<string> {
  const model = opts.tier === "smart" ? env.modelSmart : env.modelFast;
  const body: Record<string, unknown> = {
    model,
    messages,
    temperature: opts.temperature ?? 0.3,
    max_tokens: opts.maxTokens ?? 1200,
  };
  if (opts.json) body.response_format = { type: "json_object" };

  const maxAttempts = 4;
  let last429 = false;
  let lastErr = "";
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const res = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.openrouterKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": env.openrouterSiteUrl,
        "X-Title": env.openrouterSiteName,
      },
      body: JSON.stringify(body),
    });

    if (res.status === 429 || res.status >= 500) {
      last429 = res.status === 429;
      lastErr = `${res.status} ${await res.text().catch(() => "")}`;
      await sleep(1500 * 2 ** attempt);
      continue;
    }
    if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${await res.text()}`);

    const data = await res.json();
    const content: string | undefined = data?.choices?.[0]?.message?.content;
    if (!content) throw new Error("OpenRouter returned empty content");
    return content;
  }
  if (last429) throw new RateLimitError(`OpenRouter rate-limited after ${maxAttempts} attempts: ${lastErr}`);
  throw new Error(`OpenRouter failed after ${maxAttempts} attempts: ${lastErr}`);
}

/** Chat that parses a JSON object response, tolerating ```json fences. */
export async function chatJSON<T>(messages: ChatMessage[], opts: ChatOpts = {}): Promise<T> {
  const raw = await chat(messages, { ...opts, json: true });
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    // Last-ditch: extract the first {...} block.
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]) as T;
    throw new Error(`Failed to parse JSON from model: ${raw.slice(0, 200)}`);
  }
}
