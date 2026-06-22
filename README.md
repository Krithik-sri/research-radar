# 📡 Research Radar

Internal automation tool that builds and maintains a **knowledge base of post-training
research papers** (RLHF, RLVR, reward modeling, preference optimization, reasoning,
distillation, agentic RL, SFT, synthetic data, …) and surfaces it through **Slack &
Discord bots** and a web app — think an internal, research-focused [cofounder.co](https://cofounder.co).

It crawls arXiv month-by-month back to a configurable start date, classifies and
summarizes papers with an LLM, embeds them for semantic search, links them into a
lightweight knowledge graph, and posts daily/weekly digests to chat. Anyone in the org
can query it with `/ask` — it runs on shared org API keys, **not** anyone's personal
Claude account.

---

## Status at a glance

| Capability | Status |
|---|---|
| Topic taxonomy (11 post-training topics) | ✅ Done |
| Postgres schema + migrations + pgvector | ✅ Done |
| arXiv crawler (month windows + pagination) | ✅ Done |
| Semantic Scholar enrichment (citations/refs) | ✅ Done |
| Hugging Face daily/trending papers | ✅ Done |
| LLM classify + summarize (Groq, provider-switchable) | ✅ Done |
| Embeddings (Jina, 768-dim, provider-switchable) | ✅ Done |
| **Ingest pipeline** (gate→classify→summarize→embed→graph) | ✅ Done |
| **Resumable backfill** (`crawl_runs` idempotency) | ✅ Done |
| Semantic search + RAG `/ask` | ✅ Done |
| Lightweight knowledge graph (cite/similar edges) | ✅ Done |
| Slack `/ask` + Discord `/ask` bots | ✅ Done |
| Daily roundup + weekly trend digest (Inngest cron) | ✅ Done |
| Dedup / novelty scoring | ✅ Done (not yet wired into backfill) |
| **Web dashboard / graph visualization** | ❌ Not built (placeholder page only) |
| **Proactive "notable new paper" alerts** | ❌ Not built |
| **Notion KB mirror** | ❌ Not built (deps + env present) |
| End-to-end run against real keys | ⏳ Pending credentials |
| Automated tests | ❌ None yet |

> Full-text is **not** ingested — classification/summarization/embedding use the
> arXiv **title + abstract** only. PDF deep-reading is a future enhancement.

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
 /ask RAG    daily + weekly digest      proactive alerts          web app
 (Slack +    (Inngest cron →            (TODO)                    (TODO: graph
  Discord)    Slack + Discord)                                     + browse)

 Heavy one-time backfill runs as a LOCAL `tsx` script (npm run backfill),
 not through Vercel/Inngest — avoids serverless time limits and stays free.
```

### Why these choices
- **Provider-switchable LLM** (`LLM_PROVIDER` = `groq` | `gemini` | `openrouter`)
  → one shared org key, no dependency on a personal Claude account. Default is
  **Groq** (free tier, ~14.4k req/day on `llama-3.1-8b-instant`), which comfortably
  handles the high-volume classify/summarize backfill.
- **Provider-switchable embeddings** (`EMBED_PROVIDER` = `jina` | `gemini`).
  Default is **Jina** (`jina-embeddings-v3`, free HTTP API, 768-dim) — works the
  same locally and on serverless so document/query vectors stay consistent.
- **Neon** serverless Postgres + **pgvector** → vector search and the knowledge
  graph live in one free database.
- **Inngest** → durable cron + async jobs that fit Vercel's serverless model.
- **Strictly free / throttled** backfill: cheap keyword gate before any paid call,
  resumable cursor, polite rate limiting.

---

## Tech stack

Next.js 15 (App Router) · TypeScript · Drizzle ORM · Neon Postgres + pgvector ·
Inngest · Groq / Gemini / OpenRouter (switchable LLM) · Jina / Gemini (switchable
embeddings) · Slack & Discord · arXiv / Semantic Scholar / Hugging Face APIs.

---

## Project structure

```
app/
  page.tsx                      Landing page (placeholder — dashboard TODO)
  api/health/route.ts           Health check
  api/inngest/route.ts          Inngest serve endpoint (cron + async jobs)
  api/slack/commands/route.ts   Slack /ask slash command
  api/discord/interactions/route.ts  Discord /ask interactions
src/
  config/
    env.ts                      Centralized, lazy env access
    topics.ts                   11-topic post-training taxonomy + keyword gates
  lib/
    db/{schema,client}.ts       Drizzle schema + Neon client
    sources/{arxiv,semanticScholar,hfPapers,types}.ts
    llm/openrouter.ts           chat() / chatJSON() with retry/backoff
    embeddings/gemini.ts        embed() / embedBatch()
    kb/
      classify.ts               keyword gate + LLM topic classification
      summarize.ts              structured paper summaries
      ingest.ts                 ⭐ ingest orchestrator
      search.ts                 semantic search + askKnowledgeBase() RAG
      dedup.ts                  novelty scoring
      graph.ts                  citation + similarity edges
    digest/build.ts             daily roundup + weekly trend synthesis
    channels/{slack,discord}.ts verify + post helpers
    inngest/{client,functions}.ts  cron + async functions
scripts/
  _env.ts                       loads .env.local for tsx scripts
  migrate.ts                    create pgvector + run migrations
  seed-topics.ts                seed topic taxonomy
  trigger-backfill.ts           ⭐ resumable historical backfill
  register-discord-commands.ts  register the global /ask command
drizzle/0000_init.sql           initial migration
```

---

## npm scripts

| Script | What it does |
|---|---|
| `npm run dev` | Next.js dev server |
| `npm run build` / `start` | Production build / serve |
| `npm run typecheck` | `tsc --noEmit` (currently clean ✅) |
| `npm run db:generate` | Generate a Drizzle migration from schema changes |
| `npm run db:migrate` | Ensure pgvector + apply migrations |
| `npm run seed:topics` | Seed the topic taxonomy |
| `npm run test:llm` | Smoke-test the chat + embedding providers (verify keys) |
| `npm run backfill` | Resumable month-by-month historical crawl + ingest |
| `npm run discord:register` | Register the `/ask` slash command |
| `npm run inngest:dev` | Local Inngest dev server |

---

## Environment variables

See `.env.example` for the full annotated list. Minimum to ingest papers:
`DATABASE_URL`, `GROQ_API_KEY`, `JINA_API_KEY` (with `LLM_PROVIDER=groq`,
`EMBED_PROVIDER=jina`). The bots and digests additionally need the Slack /
Discord / Inngest values.

---

## Getting started

See **[SETUP.md](./SETUP.md)** for the full step-by-step walkthrough (accounts,
keys, local run, Slack/Discord wiring, and Vercel deployment), and
**[DESIGN.md](./DESIGN.md)** for the system design (architecture, data flow, the
RAG subsystem, knowledge graph, scaling).

Quick version once `.env.local` has the three core keys (`DATABASE_URL`,
`GROQ_API_KEY`, `JINA_API_KEY`):

```bash
npm install
npm run db:migrate
npm run seed:topics
npm run test:llm        # confirm chat + embeddings work
npm run backfill        # safe to Ctrl-C and re-run; it resumes
```

---

## Roadmap (next up)

1. **Web dashboard** — browse/search, topic & timeline views, and a force-graph
   visualization over `paper_relations` (data + `neighborsOf()` already exist).
2. **Proactive alerts** — push notable new papers (HF-trending / citation velocity)
   to Slack & Discord from `dailyCrawl`.
3. **Notion mirror** — write each ingested paper to a Notion database (`@notionhq/client`
   already a dependency).
4. **Wire dedup into backfill** — set `novelty` on ingest using `assessNovelty()`.
5. **Tests** + a small eval set for classification quality.
