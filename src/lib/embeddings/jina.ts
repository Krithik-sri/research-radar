/**
 * Embeddings via Jina AI (https://jina.ai/embeddings). Free tier, plain HTTP so
 * it works in both the local backfill and serverless /ask. jina-embeddings-v3
 * supports Matryoshka output dims, so we request EMBED_DIM (768) and keep the
 * existing pgvector schema unchanged.
 */
import { env, EMBED_DIM } from "@/config/env";
import { RateLimitError } from "@/lib/llm/errors";

const JINA_URL = "https://api.jina.ai/v1/embeddings";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface JinaResponse {
  data?: { index: number; embedding: number[] }[];
}

export type EmbedTask = "query" | "passage";

/** Embed a batch of texts in one request (Jina supports up to ~2048 inputs). */
async function embedMany(texts: string[], task: EmbedTask = "passage"): Promise<number[][]> {
  const body = {
    model: env.jinaModel,
    // Asymmetric retrieval: queries and documents use different task adapters.
    task: task === "query" ? "retrieval.query" : "retrieval.passage",
    dimensions: EMBED_DIM,
    input: texts.map((t) => t.slice(0, 8000)),
  };

  let last429 = false;
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(JINA_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.jinaKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (res.status === 429 || res.status >= 500) {
      last429 = res.status === 429;
      const delay = 2000 * 2 ** attempt;
      console.warn(`        ⏳ jina ${res.status} — retry ${attempt + 1}/5 in ${delay / 1000}s`);
      await sleep(delay);
      continue;
    }
    if (!res.ok) throw new Error(`Jina embed ${res.status}: ${await res.text()}`);

    const data = (await res.json()) as JinaResponse;
    const rows = data.data ?? [];
    if (rows.length !== texts.length) {
      throw new Error(`Jina returned ${rows.length} embeddings for ${texts.length} inputs`);
    }
    // Sort by index to guarantee input order, then return the vectors.
    return rows.sort((a, b) => a.index - b.index).map((r) => r.embedding);
  }
  if (last429) throw new RateLimitError("Jina embed rate-limited after retries");
  throw new Error("Jina embed failed after retries");
}

export async function embed(text: string, opts: { task?: EmbedTask } = {}): Promise<number[]> {
  const [v] = await embedMany([text], opts.task ?? "passage");
  if (!v?.length) throw new Error("Jina returned empty embedding");
  return v;
}

export async function embedBatch(texts: string[], delayMs = 200): Promise<number[][]> {
  const out: number[][] = [];
  // Chunk to keep requests modest; Jina handles batches natively.
  for (let i = 0; i < texts.length; i += 100) {
    out.push(...(await embedMany(texts.slice(i, i + 100))));
    if (delayMs && i + 100 < texts.length) await sleep(delayMs);
  }
  return out;
}
