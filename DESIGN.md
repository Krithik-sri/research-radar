# Research Radar — System Design

A reference for how the system actually works: components, data flow, the RAG
subsystem, the knowledge graph, the web dashboard, scheduling, and operational
properties. Reflects the code as built (see also [README](./README.md),
[SETUP](./SETUP.md)).

**Status:** deployed and live at **https://research-radar.metronis.space**
(Next.js on Vercel), behind a shared-password gate (§10). Slack/Discord `/ask`,
scheduled digests, and the web dashboard (chat, papers, graph, admin) are all in
production.

---

## 1. Goals & non-goals

**Goals**
- Continuously discover **post-training** research (RLHF, RLVR, reward modeling,
  preference optimization, reasoning, distillation, agentic RL, SFT, synthetic data).
- Classify, summarize, and embed papers into a searchable knowledge base + a
  lightweight knowledge graph.
- Serve the org via **Slack/Discord `/ask`**, scheduled **digests**, and a
  **web dashboard** (conversational chat, paper browser, knowledge graph, admin),
  on shared org keys (no dependency on a personal account).
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
  LLM: groq*/gemini/openrouter ◀──│ chat()  │ │ embed() │─────▶│  crawl_runs      │
  Embed: jina*/gemini  (*=default)└─────────┘ └─────────┘      │  digests         │
                                                               └──────────────────┘
                                                                        │
   ENTRYPOINTS                                                          ▼
  ┌────────────┐ ┌──────────┐ ┌────────────┐ ┌──────────────┐ ┌─────────────────┐
  │npm backfill│ │ npm ask  │ │Inngest cron│ │Slack/Discord │ │ Web dashboard   │
  │(local,hist)│ │(local RAG)│ │crawl+digest│ │ /ask routes  │ │(Vercel, gated)  │
  └────────────┘ └──────────┘ └────────────┘ └──────────────┘ └─────────────────┘
                                                                  /  /chat /papers
                                                                  /graph /admin
```

Two execution contexts share the same library code:
- **Local scripts** (`scripts/*.ts` via `tsx`) — the heavy historical backfill and
  the terminal `ask`. Run off-serverless to dodge time limits.
- **Serverless** (Next.js on Vercel) — the web dashboard (React pages), API
  routes + Inngest functions for the always-on incremental crawl, digests, and
  bot `/ask`. A shared-password middleware gate (§10) fronts the browser pages
  and their data APIs; external webhooks (Slack/Discord/Inngest/health) bypass it.

---

## 3. Component inventory

| Layer | Files | Responsibility |
|---|---|---|
| Config | `src/config/env.ts`, `src/config/topics.ts` | Lazy env access; 11-topic taxonomy + keyword gate |
| DB | `src/lib/db/{schema,client}.ts`, `drizzle/` | Drizzle schema, Neon HTTP client, migration |
| Sources | `src/lib/sources/{arxiv,semanticScholar,hfPapers,types}.ts` | Fetch + normalize to `RawPaper`; month windows |
| LLM | `src/lib/llm/{openrouter,groq,gemini,errors}.ts` | `chat()`/`chatJSON()`/`chatStream()` dispatcher (on `LLM_PROVIDER`) + providers |
| Embeddings | `src/lib/embeddings/{index,jina,gemini}.ts` | `embed()`/`embedBatch()` dispatcher (on `EMBED_PROVIDER`) + providers; Jina asymmetric (query/passage) |
| KB | `src/lib/kb/{classify,summarize,ingest,search,dedup,graph}.ts` | Pipeline + conversational RAG + graph |
| Digest | `src/lib/digest/build.ts` | Daily roundup + weekly synthesis |
| Channels | `src/lib/channels/{slack,discord}.ts` | Signature verify + posting |
| Jobs | `src/lib/inngest/{client,functions}.ts` | Crons + async `/ask` |
| Auth | `middleware.ts` | Shared-password gate; cookie `rr_auth`; public-endpoint exemptions (§10) |
| API routes | `app/api/{health,inngest,slack/commands,discord/interactions,chat,papers,graph,login,logout,admin/*}/route.ts` | HTTP entrypoints + dashboard data APIs |
| Web pages | `app/{page,chat,papers,graph,admin,login}/*` + `app/{layout,Nav}.tsx`, `app/globals.css` | Dashboard UI + dark design system |
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

## 6. RAG subsystem (the conversational engine)

**Type:** still classic **retrieve-then-read vector RAG** over abstracts +
generated summaries (no full text) — but wrapped in a **conversational,
multi-turn engine** that plans before it retrieves. Implemented in
`src/lib/kb/search.ts`.

Two public entry points, both built on the same `prepareChat()` core:
- **`chatKnowledgeBase(messages[])`** / **`chatKnowledgeBaseStream(messages[])`** —
  the web `/chat` UI (streaming) and the blocking variant.
- **`askKnowledgeBase(question)`** — Slack/Discord `/ask`; wraps the engine with a
  single-message conversation `[{role:"user", content:question}]`.

### What gets embedded
At index time the embedded text is **not** raw abstract alone — it's
`embeddingText()` = `title + abstract + summary.oneLiner + summary.method +
summary.tags`. Folding the LLM summary in sharpens the vector toward the paper's
actual contribution. Queries are embedded with the **query** task adapter
(asymmetric retrieval — see §12); documents with **passage**.

### Flow

```
chatKnowledgeBase(messages)  /  chatKnowledgeBaseStream(messages)
  1. planConversation(messages)          ── ONE cheap LLM call (tier "fast", temp 0)
       → { intent, searchQuery, topicSlug?, recencyDays? }
       intent ∈ { topic | recent | meta | chitchat }
       searchQuery = self-contained rewrite of the LATEST message, resolving
                     follow-up references (it/that/those) against the last ~6 turns
       (on any failure → falls back to {intent:"topic", searchQuery:last message})
  2. prepareChat()                       ── retrieval, branched on intent:
       • topic    → semanticSearch(searchQuery, {limit 8, topicSlug,
                                    minSimilarity = RAG_MIN_SIMILARITY})
                    └ empty + topicSlug → recentPapers(topicSlug) fallback
                    └ still empty       → NO_DATA fixed answer (no generation)
       • recent   → recentPapers({limit 8, topicSlug, sinceDays = recencyDays ?? 14})
       • meta     → kbOverviewText() (counts/topics/date-range stats, no papers)
       • chitchat → no retrieval; brief warm reply
  3. generation                          ── chatStream(messages, {tier "smart"})
       sources are yielded FIRST, then answer-text deltas stream in.
```

### Retrieval (`semanticSearch`)
```
qvec = embed(query, { task: "query" })                 # Jina, 768-dim, query adapter
SELECT id, arxiv_id, title, url, summary, citation_count, published_at,
       1 - (embedding <=> qvec) AS similarity           # cosine similarity
FROM papers
WHERE embedding IS NOT NULL AND relevant = true
  [AND EXISTS topic match on paper_topics]              # optional topic filter
ORDER BY embedding <=> qvec                              # HNSW cosine, ascending distance
LIMIT 8
-- then drop rows below the similarity floor: similarity >= RAG_MIN_SIMILARITY
```
- Index: **HNSW** on `papers.embedding` with `vector_cosine_ops` (created in the
  migration) → approximate nearest-neighbor, fast at scale.
- Hard filter to `relevant=true` so stub rows never surface.
- **Similarity floor** `RAG_MIN_SIMILARITY` (env, default **0.5**) is applied in
  app code after the SQL kNN: hits below the cosine floor are discarded so `/ask`
  says "nothing relevant" rather than returning far-off papers. `recentPapers()`
  (intent `recent`) bypasses the floor — it orders by `published_at DESC`.

### Generation
- The planner runs on the **fast** tier (`llama-3.1-8b-instant` on Groq, temp 0,
  JSON). Answer generation runs on the **smart** tier (`llama-3.3-70b-versatile`)
  at temperature 0.3 via `chatStream` (streamed) or `chat` (blocking).
- `buildAnswerMessages()` assembles: a system prompt (friendly research assistant,
  cite `[n]`, admit when papers don't cover it; a "what's new briefing" variant for
  `recent`), the last ~8 conversation turns, and the latest user message augmented
  with the retrieved `[n]` context block.
- Grounded + low-temperature to reduce drift; summaries (not full text) keep the
  context small and cheap.

### Sequence (Slack example)
```
user /ask ──▶ Slack ──▶ POST /api/slack/commands
                          ├─ verifySlackSignature (HMAC, 5-min replay window)
                          ├─ inngest.send("slack/ask.requested", {question, response_url})
                          └─ 200 ack "🔍 Searching…"   (< 3 s, beats Slack deadline)
Inngest ──▶ slackAsk function
              ├─ askKnowledgeBase(question)   (plan → retrieve → Groq generate)
              └─ POST response_url with answer + sources
```
Discord is identical except: verify Ed25519, reply **type 5 (deferred)**, then
`PATCH …/messages/@original` with the answer. The web `/chat` page instead calls
`/api/chat` and renders the streamed NDJSON (§11).

### Design properties & limits
- **History-aware**: `planConversation()` resolves pronouns/follow-ups into a
  self-contained query, so multi-turn chat works without re-stating context.
- **Cheap & fast**: one planner call + one (streamed) generation per turn;
  abstracts + summaries keep context small.
- **Known limitations / future work**: it remains classic single-hop vector RAG —
  no reranker (top-k by raw cosine), no hybrid keyword+vector fusion, no
  query-rewriting/HyDE beyond the planner, no multi-hop, abstract-only (no PDF
  body), and the knowledge graph is **not** used for retrieval yet. The natural
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

## 9. Web dashboard

A Next.js (App Router) dashboard served from `app/`, behind the password gate
(§10). Shared chrome in `app/layout.tsx` + `app/Nav.tsx`; a dark "premium" design
system in `app/globals.css` (CSS custom properties, glassmorphism surfaces,
gradient/tri-gradient text, an ambient drifting **aurora** backdrop, Space Grotesk
display + Inter body fonts).

| Page | Backing API | What it does |
|---|---|---|
| `/` | — | Hero / landing; links into the tools. |
| `/chat` | `POST /api/chat` | Streaming conversational RAG. Sends the running `messages[]`, reads the NDJSON stream (§11), renders sources + the answer as it arrives. |
| `/papers` | `GET /api/papers` | Filterable paper table — topic-slug filter + free-text `q` over title/abstract (`ILIKE`), paged (`limit`/`offset`), newest first, each row with its topic names + a total count. |
| `/graph` | `GET /api/graph` | Dependency-free **canvas** knowledge graph (see below). |
| `/admin` | `POST /api/admin/index-paper`, `POST /api/admin/crawl`, `GET /api/admin/overview` | Ops console: index one arXiv id, crawl a month (`YYYY-MM`, capped), and a corpus overview (total / relevant / latest published). |
| `/login` | `POST /api/login`, `GET /api/logout` | Shared-password sign-in / sign-out (§10). |

### Knowledge graph view (`/graph` + `/api/graph`)
The API returns the most-recent relevant papers (`limit`, clamped 20–200; the page
requests 140), each paper's **single top-confidence topic**, plus topic→paper
membership edges and paper↔paper relation edges (both endpoints in the set).

The client renders a **topic-clustered constellation** on a plain `<canvas>` with a
hand-rolled force simulation (no graph library):
- **Topics are anchored in a ring** — each present topic gets a slot at a fixed
  angle/radius; topic hubs are pulled hard onto their slot.
- **Papers cluster around their topic** — a softer anchor pull toward the same slot,
  plus all-pairs repulsion, so papers settle as a cloud around their topic hub.
- **Only paper↔paper relation edges are drawn** (cites/similar). Topic membership is
  conveyed by **position + color**, never by an edge — membership edges are filtered
  out of the view entirely.
- Stable per-topic color palette; node radius scales with topic size / paper
  citations; pan (drag), zoom (wheel), hover tooltips, click-to-open the arXiv URL.
- Controls: a **focus filter** (one topic, or all) and a **"Show connections"
  toggle** (with a live relation count). The sim runs until its energy settles, then
  only redraws on interaction.

---

## 10. Auth (shared-password gate)

`middleware.ts` fronts the whole app with a single shared password:
- **Enabled only when both `APP_PASSWORD` and `AUTH_SECRET` are set** — otherwise
  the middleware is a no-op (convenient for local dev).
- The session is a cookie **`rr_auth` = `sha256(AUTH_SECRET)`** (hex), httpOnly,
  `secure` in production, 30-day max-age. `POST /api/login` verifies the supplied
  password against `APP_PASSWORD` with a constant-time compare and sets the cookie;
  `GET /api/logout` clears it and redirects to `/login`.
- On a missing/invalid cookie: page requests **redirect to `/login?next=…`**;
  `/api/*` requests get **`401`**.
- **PUBLIC exemptions** (never gated): page `/login`, and API prefixes
  `/api/login`, `/api/logout`, `/api/health`, `/api/inngest`, `/api/slack/*`,
  `/api/discord/*`. The webhook/machine endpoints are exempt because they're called
  by external services and verify their own signatures (§16) — they must not sit
  behind a human browser login. The middleware `matcher` runs on everything except
  Next's static assets.

---

## 11. Streaming protocol (`/api/chat`)

The web chat streams **newline-delimited JSON** (`application/x-ndjson`,
`no-cache, no-transform`):
- The **first** line is `{"type":"sources","sources":[…]}` (the retrieved hits, so
  the UI can render citations before any text arrives).
- Subsequent lines are `{"type":"text","value":"…"}` **deltas** appended as the
  model generates. On an error mid-stream the route emits a final apologetic
  `text` line and closes.

Under the hood, `chatKnowledgeBaseStream()` yields the `sources` event, then pumps
`chatStream()`. At the provider layer `chatStream` dispatches on `LLM_PROVIDER`:
**Groq** streams natively — `groqChatStream` reads Groq's OpenAI-compatible **SSE**
(`data:` lines, parses `choices[0].delta.content`, stops on `[DONE]`); **other
providers fall back to a single chunk** (the full non-streamed answer) so callers
see a uniform delta interface. The connection (not mid-stream) is retried on
429/5xx; a persistent 429 raises `RateLimitError`. Route is `runtime="nodejs"`,
`maxDuration=60`.

---

## 12. Provider abstraction

Both the LLM and embeddings are swappable via env, behind one function each:

```
chat() / chatJSON() / chatStream()  →  LLM_PROVIDER   ∈ {groq* | gemini | openrouter}
embed() / embedBatch()              →  EMBED_PROVIDER ∈ {jina* | gemini}     (* = default)
```
- **LLM** dispatch lives in `src/lib/llm/openrouter.ts`: `chat()` routes to
  `groqChat` / `geminiChat` / `openrouterChat`; `chatStream()` routes to
  `groqChatStream` and falls back to a single non-streamed chunk for the others.
  Two tiers per provider: **fast** (bulk classify/summarize, planner) and **smart**
  (`/ask` answers, weekly synthesis). Groq's models are `llama-3.1-8b-instant`
  (fast) / `llama-3.3-70b-versatile` (smart).
- **Embeddings** dispatch in `src/lib/embeddings/index.ts` on `EMBED_PROVIDER`.
  Jina (`jina-embeddings-v3`) is the default — a free HTTP API that works in both
  local backfill and serverless. It is **asymmetric**: `embed(text,{task})` maps
  `query` → `retrieval.query` and `passage` → `retrieval.passage` adapters, so the
  /ask query path passes `task:"query"` and ingestion embeds documents as passages.
- **Invariant:** every embedding provider must output `EMBED_DIM` (**768**) so
  document and query vectors stay comparable against the `vector(768)` column.
  Jina v3 uses Matryoshka dims and is asked for exactly 768; Gemini
  `text-embedding-004` is natively 768. **Switching to a provider that can't emit
  768 means the entire corpus must be re-embedded** (and the column/HNSW index
  rebuilt).
- Current production default: **Groq** (chat) + **Jina** (embeddings). Chosen after
  OpenRouter (50 free req/day) and direct Gemini (project free-tier quota = 0 /
  model 404) proved unworkable on free tier for this account. (Note: `LLM_PROVIDER`
  has a literal `"gemini"` fallback in `env.ts`, but production sets it to `groq`.)

---

## 13. Rate-limit & free-tier strategy

- **The binding constraint is Groq's free tier: ~500,000 tokens/day, *per model*.**
  Because fast and smart map to different Groq models (`llama-3.1-8b-instant` vs
  `llama-3.3-70b-versatile`), they draw on **separate daily budgets** — bulk
  classify/summarize burning the 8b budget does not starve `/ask` generation on the
  70b budget. Embeddings sit on the **separate Jina** quota, untouched by either.
- **Keyword gate** eliminates most papers before any paid call.
- **Retry/backoff** in every provider client (exponential, several attempts)
  absorbs per-minute limits; a persistent daily cap raises `RateLimitError`.
- **Backfill / reclassify catch `RateLimitError` and stop/resume gracefully** at
  window + paper granularity → a daily cap just means "run again tomorrow," never
  lost work or double spend.
- **Chat degrades gracefully**: if the planner call fails it falls back to a plain
  `topic` plan over the raw message; generation runs on the separate 70b budget;
  embeddings run on Jina. A worst case still returns sources + a usable answer.
- **Heavy backfill is local** (not serverless) to avoid Vercel/Inngest limits.

---

## 14. Deployment topology

Live at **https://research-radar.metronis.space**.

```
Vercel (Next.js)                 Neon (Postgres+pgvector)      Inngest Cloud
  app/ dashboard (gated):          papers, vectors, graph        crons + event queue
    / /chat /papers /graph /admin
  /api/chat /papers /graph         ◀── SQL ──────────────────
  /api/admin/*  (gated)
  /api/login /logout  (public)
  /api/health  (public)
  /api/inngest  ◀── sync ──────────────────────────────────────  drives functions
  /api/slack/commands       ◀── slash command ── Slack
  /api/discord/interactions ◀── interaction ── Discord

External: arXiv API · Semantic Scholar · Hugging Face · Groq · Jina
Local dev box: npm run backfill / ask (direct to Neon + Groq + Jina)
```
The browser pages and their data APIs sit behind the `middleware.ts` password gate
(§10); the webhook/health endpoints are public. Env vars live in `.env.local`
(gitignored) locally and in Vercel project settings in prod (incl. `APP_PASSWORD` /
`AUTH_SECRET`). The Neon client initializes at import, so `DATABASE_URL` must be
present at build time (it is, on Vercel).

---

## 15. Failure modes

| Failure | Behavior |
|---|---|
| Provider daily cap | `RateLimitError` → backfill stops gracefully; crons fail that run, retried next schedule |
| arXiv 5xx / transient | Throws; window marked `error`, backfill continues; re-run retries error windows |
| S2 rate-limited | Best-effort; enrichment skipped, ingest continues (citation_count stays 0) |
| Bad model JSON | `chatJSON` strips fences + regex-extracts `{…}`; throws if unparseable |
| Partial window crash | Processed papers persist (per-paper upsert); resume skips them |
| Slack/Discord slow RAG | Handler acks fast; answer delivered async via Inngest (no timeout) |
| Web chat stream error | Route emits a final apologetic `text` line and closes the stream cleanly |
| Planner LLM fails | `planConversation` catches and falls back to `{intent:"topic"}` over the raw message |
| No vector clears the floor | `/ask` returns the `NO_DATA` fallback ("couldn't find papers on that…") instead of off-topic hits |

---

## 16. Security

- Web dashboard: **shared-password gate** (`middleware.ts`, §10) — cookie
  `sha256(AUTH_SECRET)`, constant-time password check, `/api/*` → 401 when unauth'd.
- Slack: HMAC-SHA256 signature + 5-minute replay window.
- Discord: Ed25519 signature verification (`discord-interactions`).
- Webhook/machine endpoints (Slack/Discord/Inngest/health) are exempt from the
  human login but verify their own signatures.
- Secrets only in env (`.env.local` gitignored / Vercel settings).
- Shared org provider keys → no personal-account dependency; rotate via env.

---

## 17. Scaling notes

- pgvector HNSW scales to ~10⁵–10⁶ vectors on Neon; current corpus is far below.
- Throughput is provider-bound, not DB-bound; the gate + summaries keep token use low.
- If the corpus or QPS grows: add a cross-encoder rerank, hybrid BM25, a read replica
  for vector queries, and move heavy crawl to a dedicated worker (already off-serverless).

---

## 18. Roadmap (remaining)

The web dashboard (chat / papers / graph / admin), streaming, and the
shared-password gate are **built and live**. Still open:

1. **Notion mirror** — write each paper to a Notion DB (`@notionhq/client` present).
2. **Proactive alerts** — push notable new papers (HF-trending / citation velocity).
3. **GraphRAG + rerank + hybrid** — upgrade the retrieval path (see §6): expand
   top-k with `paper_relations` neighbors, add a cross-encoder rerank and BM25 fusion.
4. **Full-text** — fetch + chunk PDFs for deeper Q&A (today it's abstract+summary only).
5. **Tests** — automated coverage of the pipeline, RAG engine, and routes.
6. **Per-user OAuth** — replace the single shared password with real per-user auth.
7. **Wire dedup into backfill** — set `novelty` via `assessNovelty()` during ingest.
