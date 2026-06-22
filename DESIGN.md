# Research Radar — System Design

A reference for how the system actually works: components, data flow, the RAG
subsystem, the knowledge graph, scheduling, and operational properties. Reflects
the code as built (see also [README](./README.md), [SETUP](./SETUP.md)).

---

## 1. Goals & non-goals

**Goals**
- Continuously discover **post-training** research (RLHF, RLVR, reward modeling,
  preference optimization, reasoning, distillation, agentic RL, SFT, synthetic data).
- Classify, summarize, and embed papers into a searchable knowledge base + a
  lightweight knowledge graph.
- Serve the org via **Slack/Discord `/ask`** and scheduled **digests**, on shared
  org keys (no dependency on a personal account).
- Stay on **free tiers**; tolerate their rate limits gracefully.

**Non-goals (current)**
- Full-text/PDF understanding (we use title + abstract only).
- GraphRAG / multi-hop reasoning over citations.
- Real-time/streaming ingestion (batch crawl is fine).
- Multi-tenant isolation (single internal workspace).

---

## 2. High-level architecture

```
            SOURCES                      PIPELINE                      STORAGE
  ┌──────────────────────────┐   ┌────────────────────────┐   ┌──────────────────┐
  │ arXiv  (month windows)   │──▶│      ingestPapers()     │──▶│ Neon Postgres    │
  │ Semantic Scholar (enrich)│   │  gate→classify→summarize│   │  + pgvector      │
  │ Hugging Face (trending)  │   │  →embed→upsert→edges    │   │                  │
  └──────────────────────────┘   └────────────────────────┘   │  papers          │
                                       ▲          │            │  topics          │
                                       │          ▼            │  paper_topics    │
       PROVIDERS (switchable)     ┌─────────┐ ┌─────────┐      │  paper_relations │
       LLM:   Groq/Gemini/OR  ◀───│ chat()  │ │ embed() │─────▶│  crawl_runs      │
       Embed: Jina/Gemini     ◀───└─────────┘ └─────────┘      │  digests         │
                                                               └──────────────────┘
                                                                        │
   ENTRYPOINTS                                                          ▼
  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐
  │ npm backfill │  │ npm ask      │  │ Inngest cron │  │ Slack/Discord /ask routes │
  │ (local, hist)│  │ (local RAG)  │  │ crawl+digest │  │ (verify→enqueue→answer)   │
  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────────────────┘
```

Two execution contexts share the same library code:
- **Local scripts** (`scripts/*.ts` via `tsx`) — the heavy historical backfill and
  the terminal `ask`. Run off-serverless to dodge time limits.
- **Serverless** (Next.js on Vercel) — API routes + Inngest functions for the
  always-on incremental crawl, digests, and bot `/ask`.

---

## 3. Component inventory

| Layer | Files | Responsibility |
|---|---|---|
| Config | `src/config/env.ts`, `src/config/topics.ts` | Lazy env access; 11-topic taxonomy + keyword gate |
| DB | `src/lib/db/{schema,client}.ts`, `drizzle/` | Drizzle schema, Neon HTTP client, migration |
| Sources | `src/lib/sources/{arxiv,semanticScholar,hfPapers,types}.ts` | Fetch + normalize to `RawPaper`; month windows |
| LLM | `src/lib/llm/{openrouter,groq,gemini,errors}.ts` | `chat()`/`chatJSON()` dispatcher + providers |
| Embeddings | `src/lib/embeddings/{index,jina,gemini}.ts` | `embed()`/`embedBatch()` dispatcher + providers |
| KB | `src/lib/kb/{classify,summarize,ingest,search,dedup,graph}.ts` | Pipeline + RAG + graph |
| Digest | `src/lib/digest/build.ts` | Daily roundup + weekly synthesis |
| Channels | `src/lib/channels/{slack,discord}.ts` | Signature verify + posting |
| Jobs | `src/lib/inngest/{client,functions}.ts` | Crons + async `/ask` |
| Routes | `app/api/{health,inngest,slack/commands,discord/interactions}/route.ts` | HTTP entrypoints |
| Scripts | `scripts/{migrate,seed-topics,trigger-backfill,test-llm,ask,register-discord-commands}.ts` | Ops CLIs |

---

## 4. Data model (Neon Postgres + pgvector)

```
topics(id, slug⊥, name, description)
papers(id, arxiv_id⊥, title, authors[], abstract, published_at, updated_at_source,
       url, pdf_url, categories[], source,
       citation_count, hf_trending,
       relevant, summary, summary_struct{method,results,whyItMatters,tags},
       novelty, dedup_group_id,
       embedding vector(768),          ← HNSW index, vector_cosine_ops
       notion_page_id, processed_at, created_at)
paper_topics(paper_id→papers, topic_id→topics, confidence)          ← PK(paper,topic)
paper_relations(id, from_paper→papers, to_paper→papers, type, weight) ← cites|similar|follows_up
crawl_runs(id, source, period_start, period_end, status, stats)      ← window idempotency
digests(id, type, period, content, paper_ids[], posted_at)
```

Notes:
- **Denormalized** authors/categories as `text[]` on `papers` (no separate author
  node tables) — keeps the schema small; the graph lives in `paper_relations`.
- `relevant=false` rows are lightweight **stubs** (no embedding/summary) kept only
  so the backfill doesn't re-classify them.
- One Neon free DB (0.5 GB) holds both metadata and 768-dim vectors. ~30k relevant
  papers ≈ ~90 MB of vectors — comfortably within budget.

---

## 5. Ingestion pipeline

`ingestPapers(raws, opts)` in `src/lib/kb/ingest.ts` is the single orchestrator
used by both the backfill and the daily crawl.

```
for each RawPaper (deduped by arxiv_id, skipping those already processed):
  1. keyword gate   passesKeywordGate(title, abstract)   ── cheap, no paid call
  2. classify       classifyPaper() → {relevant, topics[]} (LLM, fast model, JSON)
       └ not relevant → upsert stub row (relevant=false, processed_at) and stop
  3. summarize      summarizePaper() → {oneLiner, method, results, whyItMatters, tags}
  4. embed          embed(embeddingText(title, abstract, summary)) → vector(768)
  5. upsert paper   onConflict(arxiv_id) update summary/embedding/processed_at
  6. topic edges    insert paper_topics(paper, topic, confidence)
  7. similarity     buildSimilarityEdges(paperId, vector)  → paper_relations(similar)
after the batch:
  8. S2 enrich      enrichWithS2(relevantIds) → citation_count + paper_relations(cites)
```

**Idempotency & resumability**
- Window level: `crawl_runs(source, period_start, period_end)` — a window marked
  `done` is skipped on re-run.
- Paper level: rows with `processed_at` set are skipped up front → a resumed run
  never re-spends LLM/embedding quota.
- On a persistent `429` (`RateLimitError`) the backfill **stops cleanly**, leaving
  the window `running`; the next run redoes it, skipping already-processed papers.

**Backfill driver** (`scripts/trigger-backfill.ts`): `monthWindows(BACKFILL_SINCE,
now)` newest→oldest; for each window+categories, `fetchArxivWindow()` (paginated,
3.5 s/page) then `ingestPapers()`. Verbose `log` callback prints page + per-paper
progress.

---

## 6. RAG subsystem (the `/ask` brain)

**Type:** classic single-shot **vector RAG** (retrieve-then-read), grounded on
abstracts + generated summaries. Implemented in `src/lib/kb/search.ts`.

### What gets embedded
At index time the embedded text is **not** raw abstract alone — it's
`embeddingText()` = `title + abstract + summary.oneLiner + summary.method +
summary.tags`. Folding the LLM summary in sharpens the vector toward the paper's
actual contribution.

### Retrieval
```
semanticSearch(query, {limit=8, topicSlug?}):
  qvec = embed(query)                                  # Jina, 768-dim
  SELECT id, arxiv_id, title, url, summary, citation_count, published_at,
         1 - (embedding <=> qvec) AS similarity        # cosine similarity
  FROM papers
  WHERE embedding IS NOT NULL AND relevant = true
    [AND EXISTS topic match on paper_topics]           # optional topic filter
  ORDER BY embedding <=> qvec                           # HNSW cosine, ascending distance
  LIMIT 8
```
- Index: **HNSW** on `papers.embedding` with `vector_cosine_ops` (created in the
  migration) → approximate nearest-neighbor, fast at scale.
- Hard filter to `relevant=true` so stub rows never surface.

### Generation
```
askKnowledgeBase(question, {topicSlug?}):
  sources = semanticSearch(question, 8)
  context = sources.map((s,i) => `[${i+1}] ${title} (arXiv:${id}, ${cites} cites)\n${summary}`)
  answer  = chat([
      system: "answer using ONLY provided context, cite [n], be concise/technical,
               say so if context doesn't cover it",
      user:   `Question: ${q}\n\nPapers:\n${context}`
    ], { tier: "smart", temperature: 0.3, maxTokens: 900 })   # Groq llama-3.3-70b
  return { answer, sources }                                  # sources rendered as links
```

### Sequence (Slack example)
```
user /ask ──▶ Slack ──▶ POST /api/slack/commands
                          ├─ verifySlackSignature (HMAC, 5-min replay window)
                          ├─ inngest.send("slack/ask.requested", {question, response_url})
                          └─ 200 ack "🔍 Searching…"   (< 3 s, beats Slack deadline)
Inngest ──▶ slackAsk function
              ├─ askKnowledgeBase(question)   (embed → pgvector kNN → Groq)
              └─ POST response_url with answer + sources
```
Discord is identical except: verify Ed25519, reply **type 5 (deferred)**, then
`PATCH …/messages/@original` with the answer.

### Design properties & limits
- **Grounded**: the model is instructed to answer only from retrieved context and
  cite `[n]`; low temperature (0.3) to reduce drift.
- **Cheap & fast**: one embedding + one generation per question; summaries (not full
  text) keep context small.
- **Known limitations / future work**: no reranker (top-k by raw cosine), no hybrid
  keyword+vector fusion, no query rewriting/HyDE, no multi-hop, abstract-only (no
  PDF body), and the knowledge graph is **not** used for retrieval yet. The natural
  upgrade is **GraphRAG** — expand the top-k with `paper_relations` neighbors
  (cites/similar) before generation — plus a cross-encoder rerank and BM25 fusion.

---

## 7. Knowledge graph

A **lightweight** graph in `paper_relations` (not a separate graph DB):
- **`cites`** — built from Semantic Scholar references that exist in our KB
  (`buildCitationEdges`).
- **`similar`** — top-k cosine neighbors above threshold, written at ingest
  (`buildSimilarityEdges`, k=5, min 0.78).
- **`follows_up`** — reserved, not yet produced.

`neighborsOf(paperId)` returns bidirectional neighbors for a future graph view /
GraphRAG. Today the graph powers exploration, not the answer path.

---

## 8. Scheduling (Inngest)

`src/lib/inngest/functions.ts`, served at `/api/inngest`:

| Function | Trigger | Action |
|---|---|---|
| `daily-crawl` | cron `0 6 * * *` | `fetchArxivWindow(last 3 days)` → `ingestPapers` |
| `daily-digest` | cron `30 13 * * *` | `buildDailyDigest` → Slack + Discord |
| `weekly-digest` | cron `0 14 * * 1` | `buildWeeklyDigest` (LLM synthesis) → Slack + Discord |
| `slack-ask` | event `slack/ask.requested` | RAG → `response_url` |
| `discord-ask` | event `discord/ask.requested` | RAG → followup edit |

Each cron body runs inside a single `step.run` so Date objects stay in-closure
(Inngest serializes step boundaries as JSON).

---

## 9. Provider abstraction

Both the LLM and embeddings are swappable via env, behind one function each:

```
chat()/chatJSON()  →  LLM_PROVIDER ∈ {groq | gemini | openrouter}
embed()/embedBatch →  EMBED_PROVIDER ∈ {jina | gemini}
```
- `chat()` dispatches in `src/lib/llm/openrouter.ts`; `embed()` in
  `src/lib/embeddings/index.ts`.
- **Invariant:** every embedding provider must output `EMBED_DIM` (768) so document
  and query vectors stay comparable. Switching embedding providers requires
  re-embedding the corpus.
- Current default: **Groq** (chat) + **Jina** (embeddings). Chosen after OpenRouter
  (50 free req/day) and direct Gemini (project free-tier quota = 0 / model 404)
  proved unworkable on free tier for this account.

---

## 10. Rate-limit & free-tier strategy

- **Keyword gate** eliminates most papers before any paid call.
- **Retry/backoff** in every provider client (up to ~60 s) absorbs per-minute
  limits; a persisted daily cap raises `RateLimitError`.
- **Resumable** at window + paper granularity → daily caps just mean "run again
  tomorrow," never lost work or double spend.
- **Heavy backfill is local** (not serverless) to avoid Vercel/Inngest limits.

---

## 11. Deployment topology

```
Vercel (Next.js)            Neon (Postgres+pgvector)      Inngest Cloud
  /api/health                  papers, vectors, graph        crons + event queue
  /api/inngest  ◀── sync ──────────────────────────────────  drives functions
  /api/slack/commands  ◀── slash command ── Slack
  /api/discord/interactions ◀── interaction ── Discord
  app/ (landing; dashboard TODO)

External: arXiv API · Semantic Scholar · Hugging Face · Groq · Jina
Local dev box: npm run backfill / ask (direct to Neon + Groq + Jina)
```
Env vars live in `.env.local` (gitignored) locally and in Vercel project settings
in prod. The Neon client initializes at import, so `DATABASE_URL` must be present
at build time (it is, on Vercel).

---

## 12. Failure modes

| Failure | Behavior |
|---|---|
| Provider daily cap | `RateLimitError` → backfill stops gracefully; crons fail that run, retried next schedule |
| arXiv 5xx / transient | Throws; window marked `error`, backfill continues; re-run retries error windows |
| S2 rate-limited | Best-effort; enrichment skipped, ingest continues (citation_count stays 0) |
| Bad model JSON | `chatJSON` strips fences + regex-extracts `{…}`; throws if unparseable |
| Partial window crash | Processed papers persist (per-paper upsert); resume skips them |
| Slack/Discord slow RAG | Handler acks fast; answer delivered async via Inngest (no timeout) |

---

## 13. Security

- Slack: HMAC-SHA256 signature + 5-minute replay window.
- Discord: Ed25519 signature verification (`discord-interactions`).
- Secrets only in env (`.env.local` gitignored / Vercel settings).
- Shared org provider keys → no personal-account dependency; rotate via env.

---

## 14. Scaling notes

- pgvector HNSW scales to ~10⁵–10⁶ vectors on Neon; current corpus is far below.
- Throughput is provider-bound, not DB-bound; the gate + summaries keep token use low.
- If the corpus or QPS grows: add a cross-encoder rerank, hybrid BM25, a read replica
  for vector queries, and move heavy crawl to a dedicated worker (already off-serverless).

---

## 15. Roadmap (not yet built)

1. **Web dashboard** — browse/search, topic & timeline views, force-graph over
   `paper_relations`.
2. **Proactive alerts** — push notable new papers (HF-trending / citation velocity).
3. **Notion mirror** — write each paper to a Notion DB (`@notionhq/client` present).
4. **GraphRAG + rerank + hybrid** — upgrade the retrieval path (see §6).
5. **Wire dedup** — set `novelty` via `assessNovelty()` during ingest.
6. **Full-text** — fetch + chunk PDFs for deeper Q&A.
