# 📡 Research Radar

Internal automation tool that builds and maintains a **knowledge base of post-training
research papers** (RLHF, RLVR, reward modeling, preference optimization, reasoning,
distillation, agentic RL, SFT, synthetic data, …) and surfaces it through a **web
dashboard** plus **Slack & Discord bots** — think an internal, research-focused
[cofounder.co](https://cofounder.co). It crawls arXiv month-by-month back to a
configurable start date, classifies and summarizes papers with an LLM, embeds them for
semantic search, links them into a lightweight knowledge graph, answers questions over
the corpus with conversational RAG, and posts daily/weekly digests to chat.

**Live:** <https://research-radar.metronis.space> (Vercel, behind a shared-password
login). **Source:** <https://github.com/Krithik-sri/research-radar>. It runs on shared
org API keys — **not** anyone's personal Claude account — so anyone in the org can query
it with `/ask` or the web chat.

---

## Status at a glance

| Capability | Status |
|---|---|
| Topic taxonomy (post-training topics) + keyword gates | ✅ Done |
| Neon Postgres schema + migrations + pgvector | ✅ Done |
| arXiv crawler (month windows + pagination) | ✅ Done |
| Semantic Scholar enrichment (citations/refs) | ✅ Done |
| Hugging Face daily/trending papers | ✅ Done |
| LLM classify + summarize (Groq, provider-switchable) | ✅ Done |
| Embeddings (Jina v3, 768-dim, provider-switchable) | ✅ Done |
| **Ingest pipeline** (gate→classify→summarize→embed→upsert→graph) | ✅ Done |
| **Resumable month-by-month backfill** (`crawl_runs` idempotency) | ✅ Done |
| **Conversational multi-turn RAG** (`chatKnowledgeBase`, streaming) | ✅ Done |
| Lightweight knowledge graph (topic / similarity / citation edges) | ✅ Done |
| **Web dashboard** (`/`, `/chat`, `/papers`, `/graph`, `/admin`, `/login`) | ✅ Done |
| **Canvas knowledge-graph visualization** (dependency-free) | ✅ Done |
| **Shared-password auth** (middleware + login/logout) | ✅ Done |
| Slack `/ask` + Discord `/ask` bots | ✅ Done |
| Daily roundup + weekly trend digest (Inngest crons) | ✅ Done |
| Ops scripts (`ask`, `stats`, `reclassify`, `test:*`) | ✅ Done |
| Dedup / novelty scoring (module exists, not wired into backfill) | ⚠️ Partial |
| **Proactive "notable new paper" alerts** | ❌ Not built |
| **Notion KB mirror** | ❌ Not built (deps + env present) |
| **Full-text / PDF ingestion** | ❌ Not built (title + abstract only) |
| Automated tests | ❌ Not built |
| Per-user OAuth | ❌ Not built |

> Full-text is **not** ingested — classification/summarization/embedding use the arXiv
> **title + abstract** only. PDF deep-reading is a future enhancement.

---

## Architecture

```
                 ┌──────────── sources ────────────┐
   arXiv API ────┤  fetchArxivWindow (month-by-month, paginated) │
   Semantic S2 ──┤  enrichWithS2 (citations, references)         │
   HF Papers ────┤  fetchHfDailyPapers (trending signal)         │
                 └───────────────────┬─────────────┘
                                     ▼
        ┌─────────────────────  ingestPapers()  ──────────────────────┐
        │ keyword gate → LLM classify → summarize → embed → upsert      │
        │              → topic edges → similarity edges → citation edges │
        └───────────────────────────┬──────────────────────────────────┘
                                     ▼
                  Neon Postgres + pgvector  (papers, topics,
                  paper_topics, paper_relations, crawl_runs, digests)
                                     ▼
   ┌──────────────┬───────────────────────────┬────────────────────────┐
   ▼              ▼                           ▼                        ▼
 RAG /ask    daily + weekly digest       web dashboard             admin
 (Slack +    (Inngest cron →             (/, /chat streaming,      (index a paper,
  Discord +   Slack + Discord)            /papers, /graph)          crawl a month,
  web /chat)                                                        overview)

 Heavy one-time backfill runs as a LOCAL `tsx` script (npm run backfill),
 not through Vercel/Inngest — avoids serverless time limits and stays free.
```

### Why these choices
- **Provider-switchable LLM** (`LLM_PROVIDER` = `groq` | `gemini` | `openrouter`)
  → one shared org key, no dependency on a personal Claude account. Default is **Groq**
  (`llama-3.1-8b-instant` for fast classify/summarize, `llama-3.3-70b-versatile` for
  smart RAG answers). OpenRouter and direct Gemini exist as fallbacks; Groq + Jina is the
  working free stack.
- **Groq free-tier hard cap: 500,000 tokens/day, per model.** This paces ingestion —
  backfill and `reclassify` stop gracefully when the limit is hit and resume on a later
  run.
- **Provider-switchable embeddings** (`EMBED_PROVIDER` = `jina` | `gemini`). Default is
  **Jina** (`jina-embeddings-v3`, 768-dim, asymmetric query/passage tasks) — works the
  same locally and on serverless so document/query vectors stay consistent.
- **Neon** serverless Postgres + **pgvector** → vector search and the knowledge graph
  live in one free database.
- **Inngest** → durable cron + async jobs that fit Vercel's serverless model.
- **Strictly free / throttled** backfill: cheap keyword gate before any paid call,
  resumable cursor, polite rate limiting, token-budget awareness.

---

## Tech stack

Next.js 15 (App Router) · TypeScript · Drizzle ORM · Neon Postgres + pgvector · Inngest
(cron + async jobs) · Groq / Gemini / OpenRouter (switchable LLM) · Jina / Gemini
(switchable embeddings) · Slack & Discord · arXiv / Semantic Scholar / Hugging Face APIs.
The dark "premium" UI (glassmorphism, gradient/aurora, Space Grotesk + Inter) is built
with plain React + canvas — no chart or graph dependencies.

---

## Project structure

```
middleware.ts                    Shared-password auth gate (exempts machine endpoints)
app/
  layout.tsx, Nav.tsx, globals.css
  page.tsx                       Landing / hero
  chat/page.tsx                  Streaming conversational RAG UI
  papers/page.tsx                Filterable papers table
  graph/page.tsx                 Topic-clustered canvas knowledge graph
  admin/page.tsx                 Index a paper / crawl a month / overview
  login/page.tsx                 Shared-password login
  api/
    health/route.ts             Health check
    inngest/route.ts            Inngest serve endpoint (cron + async jobs)
    chat/route.ts               Streaming RAG endpoint for /chat
    papers/route.ts             Papers list/filter API
    graph/route.ts              Knowledge-graph nodes + edges API
    login/route.ts              Set auth cookie
    logout/route.ts             Clear auth cookie
    slack/commands/route.ts     Slack /ask slash command
    discord/interactions/route.ts  Discord /ask interactions
    admin/index-paper/route.ts  Ingest a single paper by arXiv id
    admin/crawl/route.ts        Trigger a month crawl
    admin/overview/route.ts     KB stats for the admin page
src/
  config/
    env.ts                       Centralized, lazy env access
    topics.ts                    Post-training taxonomy + keyword gates
  lib/
    db/{schema,client}.ts        Drizzle schema + Neon client
    sources/{arxiv,semanticScholar,hfPapers,types}.ts
    llm/
      openrouter.ts              chat()/chatJSON() router — dispatches by LLM_PROVIDER
      groq.ts, gemini.ts         provider clients
      errors.ts                  rate-limit / token-cap error handling
    embeddings/
      index.ts                   embed() router — dispatches by EMBED_PROVIDER
      jina.ts, gemini.ts         provider clients
    kb/
      classify.ts                keyword gate + LLM topic classification
      summarize.ts               structured paper summaries
      ingest.ts                  ⭐ ingest orchestrator
      search.ts                  semanticSearch + chatKnowledgeBase (RAG) + askKnowledgeBase
      dedup.ts                   novelty scoring (not yet wired into backfill)
      graph.ts                   topic + similarity + citation edges
    digest/build.ts              daily roundup + weekly trend synthesis
    channels/{slack,discord}.ts  verify + post helpers
    inngest/{client,functions}.ts  crons (dailyCrawl, dailyDigest, weeklyDigest) + ask jobs
scripts/
  _env.ts                        loads .env.local for tsx scripts
  migrate.ts                     create pgvector + run migrations
  seed-topics.ts                 seed topic taxonomy
  trigger-backfill.ts            ⭐ resumable historical backfill
  reclassify.ts                  re-run classification over stored papers
  ask.ts                         query the KB from the CLI
  stats.ts                       print KB stats
  test-llm.ts / test-slack.ts    smoke-test providers / Slack wiring
  register-discord-commands.ts   register the global /ask command
drizzle/0000_init.sql            initial migration
```

---

## npm scripts

| Script | What it does |
|---|---|
| `npm run dev` | Next.js dev server |
| `npm run build` / `start` | Production build / serve |
| `npm run lint` | `next lint` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:generate` | Generate a Drizzle migration from schema changes |
| `npm run db:migrate` | Ensure pgvector + apply migrations |
| `npm run db:push` | Push schema directly (drizzle-kit push) |
| `npm run seed:topics` | Seed the topic taxonomy |
| `npm run backfill` | Resumable month-by-month historical crawl + ingest |
| `npm run reclassify` | Re-run classification over already-stored papers |
| `npm run ask` | Query the knowledge base from the CLI |
| `npm run stats` | Print knowledge-base stats |
| `npm run test:llm` | Smoke-test the chat + embedding providers (verify keys) |
| `npm run test:slack` | Smoke-test Slack posting |
| `npm run discord:register` | Register the `/ask` slash command |
| `npm run inngest:dev` | Local Inngest dev server |

---

## Environment variables

See `.env.example` for the full annotated list.

- **Minimum to ingest papers:** `DATABASE_URL`, `GROQ_API_KEY`, `JINA_API_KEY` (with
  `LLM_PROVIDER=groq`, `EMBED_PROVIDER=jina`).
- **Auth (login gate):** `APP_PASSWORD` + `AUTH_SECRET`. Leave both empty to disable the
  gate (e.g. local dev); machine endpoints stay exempt either way.
- **Bots + cron:** `INNGEST_*`, plus `SLACK_*` and/or `DISCORD_*`.
- **Optional:** `S2_API_KEY` (higher Semantic Scholar limits), `RAG_MIN_SIMILARITY`
  (default `0.5`), OpenRouter / Gemini keys for the fallback providers, `NOTION_*` (mirror
  not built yet).

---

## Getting started

See **[SETUP.md](./SETUP.md)** for the full step-by-step walkthrough (accounts, keys,
local run, Slack/Discord wiring, and Vercel deployment), and **[DESIGN.md](./DESIGN.md)**
for the system design (architecture, data flow, the RAG subsystem, knowledge graph,
scaling).

Quick version once `.env.local` has the three core keys (`DATABASE_URL`, `GROQ_API_KEY`,
`JINA_API_KEY`):

```bash
npm install
npm run db:migrate
npm run seed:topics
npm run test:llm        # confirm chat + embeddings work
npm run backfill        # safe to Ctrl-C and re-run; it resumes (stops on the 500k/day cap)
npm run dev             # web dashboard at http://localhost:3000
```

---

## Deployment

- **GitHub → Vercel:** push to <https://github.com/Krithik-sri/research-radar>; Vercel
  builds and deploys the Next.js app. The custom domain
  <https://research-radar.metronis.space> points at the Vercel deployment.
- **Auth:** set `APP_PASSWORD` + `AUTH_SECRET` in Vercel env to enable the shared-password
  gate in production.
- **Inngest:** sync the app to Inngest using the production serve endpoint
  `https://research-radar.metronis.space/api/inngest`. This registers the crons
  (`dailyCrawl` 06:00 UTC, `dailyDigest` 13:30 UTC, `weeklyDigest` Mon 14:00 UTC) and the
  Slack/Discord ask jobs.
- **Slack:** point the slash-command request URL at
  `https://research-radar.metronis.space/api/slack/commands`.
- **Discord:** set the Interactions Endpoint URL to
  `https://research-radar.metronis.space/api/discord/interactions`, then run
  `npm run discord:register` once to register the global `/ask` command.
- **Backfill stays local:** run `npm run backfill` from a workstation to avoid serverless
  time limits; the live app only runs the lightweight daily crawl via Inngest.

---

## Roadmap (next up)

1. **Wire dedup into backfill** — set `novelty` on ingest using the existing `dedup.ts`
   scoring.
2. **Proactive alerts** — push notable new papers (HF-trending / citation velocity) to
   Slack & Discord from `dailyCrawl`.
3. **Notion mirror** — write each ingested paper to a Notion database
   (`@notionhq/client` and `NOTION_*` env already present).
4. **Full-text / PDF ingestion** — go beyond title + abstract for richer summaries and
   retrieval.
5. **Tests** + a small eval set for classification quality.
6. **Per-user OAuth** — replace the shared-password gate with real accounts.
```