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
      const delay = 2000 * 2 ** attempt;
      console.warn(`        ⏳ groq ${res.status} — retry ${attempt + 1}/${maxAttempts} in ${delay / 1000}s`);
      await sleep(delay);
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

/** Streaming variant — yields content deltas as they arrive (OpenAI-compatible SSE). */
export async function* groqChatStream(
  messages: ChatMessage[],
  opts: ChatOpts = {},
): AsyncGenerator<string> {
  const model = opts.tier === "smart" ? env.groqModelSmart : env.groqModelFast;
  const body = {
    model,
    messages,
    temperature: opts.temperature ?? 0.3,
    max_tokens: opts.maxTokens ?? 1200,
    stream: true,
  };

  // Retry only the initial connection (can't resume mid-stream).
  let res: Response | undefined;
  for (let attempt = 0; attempt < 5; attempt++) {
    res = await fetch(GROQ_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.groqKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.status === 429 || res.status >= 500) {
      const delay = 2000 * 2 ** attempt;
      console.warn(`        ⏳ groq ${res.status} — retry ${attempt + 1}/5 in ${delay / 1000}s`);
      await sleep(delay);
      continue;
    }
    break;
  }
  if (!res || !res.ok || !res.body) {
    const status = res?.status ?? 0;
    if (status === 429) throw new RateLimitError("Groq stream rate-limited");
    throw new Error(`Groq stream ${status}: ${res ? await res.text().catch(() => "") : "no response"}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith("data:")) continue;
      const data = t.slice(5).trim();
      if (data === "[DONE]") return;
      try {
        const json = JSON.parse(data);
        const delta: string | undefined = json?.choices?.[0]?.delta?.content;
        if (delta) yield delta;
      } catch {
        // ignore partial/non-JSON keepalive lines
      }
    }
  }
}
