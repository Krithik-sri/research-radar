/**
 * Embeddings dispatcher. EMBED_PROVIDER selects the backend; both must produce
 * EMBED_DIM-dimensional vectors so documents and queries stay comparable.
 *   jina   = free HTTP API, keeps 768 dims (default/recommended)
 *   gemini = Gemini text-embedding-004 (needs a project with embedding access)
 */
import { env } from "@/config/env";
import * as gemini from "./gemini";
import * as jina from "./jina";

function provider() {
  return env.embedProvider === "gemini" ? gemini : jina;
}

export type EmbedTask = "query" | "passage";

export function embed(text: string, opts: { task?: EmbedTask } = {}): Promise<number[]> {
  return provider().embed(text, opts);
}

export function embedBatch(texts: string[], delayMs?: number): Promise<number[][]> {
  return provider().embedBatch(texts, delayMs);
}
