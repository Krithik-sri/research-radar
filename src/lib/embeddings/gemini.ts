import { env, EMBED_DIM } from "@/config/env";
import { RateLimitError } from "@/lib/llm/errors";

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Embed a single text with Gemini text-embedding-004 (768-dim).
 * Retries on 429/5xx for free-tier rate limits.
 */
export async function embed(
  text: string,
  opts: { task?: "query" | "passage" } = {},
): Promise<number[]> {
  const model = env.geminiEmbedModel;
  const url = `${GEMINI_BASE}/models/${model}:embedContent?key=${env.geminiKey}`;
  const body = {
    model: `models/${model}`,
    content: { parts: [{ text: text.slice(0, 8000) }] },
    taskType: opts.task === "query" ? "RETRIEVAL_QUERY" : "RETRIEVAL_DOCUMENT",
    outputDimensionality: EMBED_DIM,
  };

  let last429 = false;
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.status === 429 || res.status >= 500) {
      last429 = res.status === 429;
      await sleep(2000 * 2 ** attempt);
      continue;
    }
    if (!res.ok) throw new Error(`Gemini embed ${res.status}: ${await res.text()}`);
    const data = await res.json();
    const values: number[] | undefined = data?.embedding?.values;
    if (!values?.length) throw new Error("Gemini returned empty embedding");
    return values;
  }
  if (last429) throw new RateLimitError("Gemini embed rate-limited after retries");
  throw new Error("Gemini embed failed after retries");
}

/** Embed many texts sequentially with a small delay to respect free-tier RPM. */
export async function embedBatch(texts: string[], delayMs = 200): Promise<number[][]> {
  const out: number[][] = [];
  for (const t of texts) {
    out.push(await embed(t));
    if (delayMs) await sleep(delayMs);
  }
  return out;
}
