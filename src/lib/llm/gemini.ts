/**
 * Chat completions via the Google Gemini API directly (free tier ~1500 req/day,
 * far above OpenRouter's 50/day free-models cap). Same shape as the OpenRouter
 * client so it can sit behind the shared chat()/chatJSON() dispatcher.
 */
import { env } from "@/config/env";
import { RateLimitError } from "./errors";
import type { ChatMessage, ChatOpts } from "./openrouter";

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface GeminiPart {
  text?: string;
}

export async function geminiChat(messages: ChatMessage[], opts: ChatOpts = {}): Promise<string> {
  const model = opts.tier === "smart" ? env.geminiModelSmart : env.geminiModelFast;

  // Gemini uses a separate systemInstruction and roles "user"/"model".
  const systemText = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");
  const contents = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

  const body: Record<string, unknown> = {
    contents,
    generationConfig: {
      temperature: opts.temperature ?? 0.3,
      maxOutputTokens: opts.maxTokens ?? 1200,
      ...(opts.json ? { responseMimeType: "application/json" } : {}),
    },
  };
  if (systemText) body.systemInstruction = { parts: [{ text: systemText }] };

  const url = `${GEMINI_BASE}/models/${model}:generateContent?key=${env.geminiKey}`;

  const maxAttempts = 5;
  let last429 = false;
  let lastErr = "";
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (res.status === 429 || res.status >= 500) {
      last429 = res.status === 429;
      lastErr = `${res.status} ${await res.text().catch(() => "")}`;
      // Up to ~62s of backoff: enough to ride out a per-minute limit, while a
      // per-day cap still fails out and surfaces as RateLimitError.
      await sleep(2000 * 2 ** attempt);
      continue;
    }
    if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);

    const data = await res.json();
    const parts: GeminiPart[] = data?.candidates?.[0]?.content?.parts ?? [];
    const content = parts.map((p) => p.text ?? "").join("").trim();
    if (!content) {
      const reason = data?.candidates?.[0]?.finishReason ?? data?.promptFeedback?.blockReason;
      throw new Error(`Gemini returned empty content${reason ? ` (${reason})` : ""}`);
    }
    return content;
  }

  if (last429) throw new RateLimitError(`Gemini rate-limited after ${maxAttempts} attempts: ${lastErr}`);
  throw new Error(`Gemini failed after ${maxAttempts} attempts: ${lastErr}`);
}
