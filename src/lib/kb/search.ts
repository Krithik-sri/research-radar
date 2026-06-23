import { and, desc, eq, isNotNull, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { papers, paperTopics, topics } from "@/lib/db/schema";
import { embed } from "@/lib/embeddings";
import { chat, chatJSON, chatStream, type ChatMessage } from "@/lib/llm/openrouter";
import { env } from "@/config/env";
import { TOPIC_SLUGS } from "@/config/topics";

/** Format a JS number[] as a pgvector literal: "[1,2,3]". */
export function toVectorLiteral(v: number[]): string {
  return `[${v.join(",")}]`;
}

export interface Neighbor {
  id: number;
  arxivId: string;
  title: string;
  similarity: number;
}

/**
 * Cosine nearest-neighbor search over the embedding column (pgvector HNSW).
 * Returns papers ordered most-similar first.
 */
export async function nearestPapers(
  embedding: number[],
  opts: { limit?: number; excludeId?: number; minSimilarity?: number } = {},
): Promise<Neighbor[]> {
  const { limit = 10, excludeId, minSimilarity } = opts;
  const vec = toVectorLiteral(embedding);
  const similarity = sql<number>`1 - (${papers.embedding} <=> ${vec}::vector)`;

  const conds = [isNotNull(papers.embedding)];
  if (excludeId !== undefined) conds.push(ne(papers.id, excludeId));

  const rows = await db
    .select({
      id: papers.id,
      arxivId: papers.arxivId,
      title: papers.title,
      similarity,
    })
    .from(papers)
    .where(and(...conds))
    .orderBy(sql`${papers.embedding} <=> ${vec}::vector`)
    .limit(limit);

  return minSimilarity ? rows.filter((r) => r.similarity >= minSimilarity) : rows;
}

export interface SearchHit {
  id: number;
  arxivId: string;
  title: string;
  url: string;
  summary: string | null;
  citationCount: number;
  publishedAt: Date | null;
  similarity: number;
}

/**
 * Semantic search for /ask. Embeds the query, retrieves top-k papers
 * (optionally filtered to a topic slug), returns rich hits for RAG.
 */
export async function semanticSearch(
  query: string,
  opts: { limit?: number; topicSlug?: string; minSimilarity?: number } = {},
): Promise<SearchHit[]> {
  const { limit = 8, topicSlug, minSimilarity } = opts;
  const queryEmbedding = await embed(query, { task: "query" });
  const vec = toVectorLiteral(queryEmbedding);
  const similarity = sql<number>`1 - (${papers.embedding} <=> ${vec}::vector)`;

  const conds = [isNotNull(papers.embedding), eq(papers.relevant, true)];

  // Optional topic filter via EXISTS against the join table.
  if (topicSlug) {
    conds.push(
      sql`EXISTS (
        SELECT 1 FROM ${paperTopics} pt
        JOIN ${topics} t ON t.id = pt.topic_id
        WHERE pt.paper_id = ${papers.id} AND t.slug = ${topicSlug}
      )`,
    );
  }

  const rows = await db
    .select({
      id: papers.id,
      arxivId: papers.arxivId,
      title: papers.title,
      url: papers.url,
      summary: papers.summary,
      citationCount: papers.citationCount,
      publishedAt: papers.publishedAt,
      similarity,
    })
    .from(papers)
    .where(and(...conds))
    .orderBy(sql`${papers.embedding} <=> ${vec}::vector`)
    .limit(limit);

  return minSimilarity ? rows.filter((r) => r.similarity >= minSimilarity) : rows;
}

/**
 * Full RAG answer for /ask: retrieve relevant papers, then have the smart
 * model answer the question grounded in them with inline [n] citations.
 */
/** Most recent relevant papers (for "what's new" style questions). */
export async function recentPapers(
  opts: { limit?: number; topicSlug?: string; sinceDays?: number } = {},
): Promise<SearchHit[]> {
  const { limit = 8, topicSlug, sinceDays } = opts;
  const conds = [isNotNull(papers.embedding), eq(papers.relevant, true)];
  if (sinceDays) {
    conds.push(sql`${papers.publishedAt} >= now() - make_interval(days => ${sinceDays})`);
  }
  if (topicSlug) {
    conds.push(
      sql`EXISTS (
        SELECT 1 FROM ${paperTopics} pt
        JOIN ${topics} t ON t.id = pt.topic_id
        WHERE pt.paper_id = ${papers.id} AND t.slug = ${topicSlug}
      )`,
    );
  }
  return db
    .select({
      id: papers.id,
      arxivId: papers.arxivId,
      title: papers.title,
      url: papers.url,
      summary: papers.summary,
      citationCount: papers.citationCount,
      publishedAt: papers.publishedAt,
      similarity: sql<number>`1`,
    })
    .from(papers)
    .where(and(...conds))
    .orderBy(sql`${papers.publishedAt} DESC NULLS LAST`)
    .limit(limit);
}

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

interface QueryPlan {
  intent: "topic" | "recent" | "meta" | "chitchat";
  searchQuery: string;
  topicSlug: string | null;
  recencyDays: number | null;
}

/** History-aware: turn the LATEST user message into a retrieval plan. */
async function planConversation(messages: ChatTurn[]): Promise<QueryPlan> {
  const last = messages[messages.length - 1]?.content ?? "";
  try {
    const history = messages
      .slice(-6)
      .map((m) => `${m.role}: ${m.content}`)
      .join("\n");
    const plan = await chatJSON<QueryPlan>(
      [
        {
          role: "system",
          content:
            "You convert the LATEST user message in a conversation into a retrieval plan for an " +
            "LLM post-training research knowledge base. Resolve references (it/that/them/those) " +
            "using the conversation. Intents:\n" +
            '- "recent": wants what is new/latest/happening.\n' +
            '- "meta": asks ABOUT the knowledge base itself (how many papers, which topics, ' +
            "coverage, date range).\n" +
            '- "topic": a specific method, concept, or question.\n' +
            '- "chitchat": greeting/thanks/meta-conversation — no search.\n' +
            "Write a self-contained 'searchQuery' (resolve pronouns to the actual topic; empty " +
            "for recent/meta/chitchat). topicSlug only if clearly implied else null. recencyDays " +
            "if a timeframe is mentioned (week=7, month=30, 'lately'/'recent'=30) else null.",
        },
        {
          role: "user",
          content:
            `Allowed topicSlugs: ${TOPIC_SLUGS.join(", ")}\n\nConversation:\n${history}\n\n` +
            `Plan for the LATEST user message. JSON: {"intent","searchQuery","topicSlug"(or null),"recencyDays"(or null)}.`,
        },
      ],
      { tier: "fast", temperature: 0 },
    );

    const intent = (["topic", "recent", "meta", "chitchat"] as const).includes(plan.intent as never)
      ? plan.intent
      : "topic";
    const topicSlug =
      plan.topicSlug && TOPIC_SLUGS.includes(plan.topicSlug) ? plan.topicSlug : null;
    const recencyDays =
      typeof plan.recencyDays === "number" ? Math.min(365, Math.max(1, plan.recencyDays)) : null;
    return { intent, searchQuery: plan.searchQuery?.trim() || last, topicSlug, recencyDays };
  } catch {
    return { intent: "topic", searchQuery: last, topicSlug: null, recencyDays: null };
  }
}

function buildContext(sources: SearchHit[]): string {
  return sources
    .map((s, i) => {
      const date = s.publishedAt ? `, ${s.publishedAt.toISOString().slice(0, 10)}` : "";
      return `[${i + 1}] ${s.title} (arXiv:${s.arxivId}, ${s.citationCount} cites${date})\n${s.summary ?? ""}`;
    })
    .join("\n\n");
}

/** A compact overview of the KB for "meta" questions about coverage. */
async function kbOverviewText(): Promise<string> {
  const [{ rel }] = await db
    .select({ rel: sql<number>`count(*)::int` })
    .from(papers)
    .where(eq(papers.relevant, true));
  const byTopic = await db
    .select({ name: topics.name, n: sql<number>`count(*)::int` })
    .from(paperTopics)
    .innerJoin(topics, eq(topics.id, paperTopics.topicId))
    .innerJoin(papers, eq(papers.id, paperTopics.paperId))
    .where(eq(papers.relevant, true))
    .groupBy(topics.name)
    .orderBy(desc(sql`count(*)`));
  const [range] = await db
    .select({
      min: sql<string>`to_char(min(${papers.publishedAt}), 'YYYY-MM-DD')`,
      max: sql<string>`to_char(max(${papers.publishedAt}), 'YYYY-MM-DD')`,
    })
    .from(papers)
    .where(eq(papers.relevant, true));
  const topicLines = byTopic.map((t) => `${t.name}: ${t.n}`).join("; ");
  return `Total relevant papers: ${rel}. Published range: ${range?.min ?? "—"} to ${range?.max ?? "—"}. By topic — ${topicLines}.`;
}

/** Build the LLM message array for a grounded answer over retrieved papers. */
function buildAnswerMessages(
  messages: ChatTurn[],
  sources: SearchHit[],
  opts: { recent?: boolean } = {},
): ChatMessage[] {
  const history = messages.slice(0, -1).slice(-8);
  const last = messages[messages.length - 1];
  const augmented = sources.length
    ? `${last.content}\n\n[Relevant papers from the knowledge base]\n${buildContext(sources)}`
    : last.content;

  const system =
    "You are a friendly, sharp research assistant for an LLM post-training team, chatting with " +
    "a researcher about the paper knowledge base. Use the conversation and the provided papers; " +
    "cite papers inline as [n] matching the list. Be conversational and concise. If the papers " +
    "don't really cover the question, say so honestly. " +
    (opts.recent
      ? "The user wants a sense of what's new — give a short briefing of the recent papers, " +
        "grouped by theme where it helps. "
      : "");

  return [
    { role: "system", content: system },
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: augmented },
  ];
}

/** A prepared answer: the retrieved sources + either LLM messages to generate
 *  from, or a fixed fallback answer (no generation needed). */
interface PreparedChat {
  sources: SearchHit[];
  messages: ChatMessage[] | null;
  tier: "fast" | "smart";
  fallback?: string;
}

/**
 * Plan the conversation and retrieve — everything up to (but not including)
 * generation. Shared by the blocking and streaming entry points.
 */
async function prepareChat(
  turns: ChatTurn[],
  opts: { topicSlug?: string } = {},
): Promise<PreparedChat> {
  if (!turns.length) {
    return { sources: [], messages: null, tier: "fast", fallback: "Ask me anything about the knowledge base." };
  }
  const plan = await planConversation(turns);
  const topicSlug = opts.topicSlug ?? plan.topicSlug ?? undefined;
  const history = turns.slice(0, -1).slice(-8).map((m) => ({ role: m.role, content: m.content }));
  const last = turns[turns.length - 1];

  if (plan.intent === "chitchat") {
    return {
      sources: [],
      tier: "fast",
      messages: [
        {
          role: "system",
          content:
            "You are a friendly research assistant for an LLM post-training team. Respond briefly " +
            "and warmly. Invite them to ask about a method (RLVR, DPO, reward modeling…) or what's new.",
        },
        ...history,
        { role: "user", content: last.content },
      ],
    };
  }

  if (plan.intent === "meta") {
    const overview = await kbOverviewText();
    return {
      sources: [],
      tier: "fast",
      messages: [
        {
          role: "system",
          content:
            "You answer questions about THIS research knowledge base using the provided stats. " +
            "Be brief and friendly.",
        },
        ...history,
        { role: "user", content: `${last.content}\n\n[Knowledge base stats]\n${overview}` },
      ],
    };
  }

  if (plan.intent === "recent") {
    const sources = await recentPapers({ limit: 8, topicSlug, sinceDays: plan.recencyDays ?? 14 });
    if (!sources.length) return { sources: [], messages: null, tier: "smart", fallback: NO_DATA };
    return { sources, tier: "smart", messages: buildAnswerMessages(turns, sources, { recent: true }) };
  }

  // topic intent → semantic search on the distilled, self-contained query
  const sources = await semanticSearch(plan.searchQuery, {
    limit: 8,
    topicSlug,
    minSimilarity: env.ragMinSimilarity,
  });
  if (sources.length > 0) {
    return { sources, tier: "smart", messages: buildAnswerMessages(turns, sources) };
  }
  if (topicSlug) {
    const recent = await recentPapers({ limit: 6, topicSlug });
    if (recent.length > 0) {
      return { sources: recent, tier: "smart", messages: buildAnswerMessages(turns, recent, { recent: true }) };
    }
  }
  return { sources: [], messages: null, tier: "smart", fallback: NO_DATA };
}

const NO_DATA =
  "I couldn't find papers on that in the knowledge base yet — the backfill may still be " +
  "indexing it. Try a specific method (e.g. RLVR, DPO, reward models) or ask what's new.";

/**
 * Conversational, multi-turn RAG over the whole knowledge base. Understands
 * intent (specific topic vs "what's new" vs questions about the KB itself vs
 * chit-chat), resolves follow-ups against the conversation, retrieves, and
 * answers with inline [n] citations.
 */
export async function chatKnowledgeBase(
  messages: ChatTurn[],
  opts: { topicSlug?: string } = {},
): Promise<{ answer: string; sources: SearchHit[] }> {
  const prepared = await prepareChat(messages, opts);
  if (!prepared.messages) return { answer: prepared.fallback ?? NO_DATA, sources: prepared.sources };
  const answer = await chat(prepared.messages, { tier: prepared.tier, temperature: 0.3 });
  return { answer, sources: prepared.sources };
}

export type ChatStreamEvent =
  | { type: "sources"; sources: SearchHit[] }
  | { type: "text"; value: string };

/**
 * Streaming variant of chatKnowledgeBase: first yields the retrieved sources,
 * then streams the answer text in deltas as the model generates it.
 */
export async function* chatKnowledgeBaseStream(
  messages: ChatTurn[],
  opts: { topicSlug?: string } = {},
): AsyncGenerator<ChatStreamEvent> {
  const prepared = await prepareChat(messages, opts);
  yield { type: "sources", sources: prepared.sources };

  if (!prepared.messages) {
    yield { type: "text", value: prepared.fallback ?? NO_DATA };
    return;
  }
  for await (const delta of chatStream(prepared.messages, { tier: prepared.tier, temperature: 0.3 })) {
    yield { type: "text", value: delta };
  }
}

/** Single-shot entry point (Slack/Discord /ask) — wraps the conversational engine. */
export async function askKnowledgeBase(
  question: string,
  opts: { topicSlug?: string } = {},
): Promise<{ answer: string; sources: SearchHit[] }> {
  return chatKnowledgeBase([{ role: "user", content: question }], opts);
}
