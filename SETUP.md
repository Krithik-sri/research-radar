# Research Radar — Setup Walkthrough

Step-by-step guide to stand up Research Radar from zero. Follow it in order.
Stop after **Part B** for a working local knowledge base; Parts C–E add hosting,
scheduling, and the chat bots.

**Everything here uses free tiers.** Current default stack: **Groq** (chat) +
**Jina** (embeddings) + **Neon** (Postgres). All provider-switchable via env.

---

## Part A — Prerequisites & install

1. **Node.js 20.12+ (22 LTS recommended).** CLI scripts use the built-in
   `process.loadEnvFile` (needs Node ≥ 20.12 / ≥ 21.7).
   ```bash
   node --version
   ```
2. **Install dependencies** from the project root:
   ```bash
   npm install
   ```
3. **Create your env file:**
   ```bash
   cp .env.example .env.local      # PowerShell: Copy-Item .env.example .env.local
   ```
   `.env.local` is gitignored — never commit it.

---

## Part B — Core knowledge base (DB + crawl + ingest)

Minimum to populate the KB. Three free accounts: **Neon**, **Groq**, **Jina**.

### B1. Neon Postgres
1. Sign up at <https://neon.tech> → create a project.
2. Copy the **pooled** connection string (contains `-pooler`).
3. `.env.local`:
   ```
   DATABASE_URL=postgresql://...-pooler...sslmode=require
   ```
   pgvector is enabled automatically by `npm run db:migrate`.

### B2. Groq (LLM — classify / summarize / answers)
1. Create a free key at <https://console.groq.com/keys> (no credit card).
2. `.env.local`:
   ```
   LLM_PROVIDER=groq
   GROQ_API_KEY=gsk_...
   GROQ_MODEL_FAST=llama-3.1-8b-instant
   GROQ_MODEL_SMART=llama-3.3-70b-versatile
   ```
   `FAST` is the high-volume backfill model; `SMART` is used for `/ask` answers and
   the weekly digest. Both are on Groq's free tier.

### B3. Jina (embeddings)
1. Grab a free key at <https://jina.ai/embeddings> (key shown on the page).
2. `.env.local`:
   ```
   EMBED_PROVIDER=jina
   JINA_API_KEY=jina_...
   JINA_MODEL=jina-embeddings-v3
   ```
   Output is 768-dim to match the schema — no DB change needed.

### B4. Configure the crawl window
```
BACKFILL_SINCE=2025-01
ARXIV_CATEGORIES=cs.LG,cs.CL,cs.AI
```

### B5. Verify the providers (do this before anything slow)
```bash
npm run test:llm
```
Expected:
```
LLM_PROVIDER = groq
fast model   = llama-3.1-8b-instant
   chat OK → "ok"
   embed OK → 768-dim vector
```
If either fails, fix the corresponding key before continuing.

### B6. Migrate, seed, backfill
```bash
npm run db:migrate     # pgvector + tables
npm run seed:topics    # 11 post-training topics
npm run backfill       # crawl arXiv month-by-month, classify, embed, store
```

**About the backfill:**
- **Resumable** — windows tracked in `crawl_runs`, papers skipped once processed.
  `Ctrl-C` and re-run anytime; it picks up where it left off.
- **Throttled** — polite to arXiv; LLM/embedding clients back off on rate limits.
- Groq + Jina free limits are generous, but a full Jan-2025→now backfill across
  three categories is large and may still **pace over a day or two**. If you hit a
  daily cap you'll see `⏸ … hit the free-tier daily limit. Stopping.` — just run
  `npm run backfill` again later; it resumes.

### B7. Confirm data landed
```sql
select count(*) from papers where relevant = true;
select t.name, count(*) from paper_topics pt
  join topics t on t.id = pt.topic_id group by t.name order by 2 desc;
```

✅ You now have a working, searchable knowledge base. Parts C–E make it
self-updating and accessible from chat. You can start the backfill running and do
Parts C–E in parallel.

---

## Part C — Deploy to Vercel + your domain

The Slack/Discord/Inngest setup all need a public HTTPS URL, so deploy first.

### C1. Push to GitHub
```bash
git init
git add .
git commit -m "Research Radar"
# create an empty GitHub repo, then:
git remote add origin https://github.com/<you>/research-radar.git
git branch -M main
git push -u origin main
```
`.env.local` is gitignored, so your secrets stay local.

### C2. Import into Vercel
1. <https://vercel.com> → **Add New → Project** → import the repo.
2. **Environment Variables** → add **every** key from your `.env.local`
   (`DATABASE_URL`, `LLM_PROVIDER`, `GROQ_*`, `EMBED_PROVIDER`, `JINA_*`, and later
   the Slack/Discord/Inngest values). Vercel injects them at build **and** runtime.
3. Deploy. Optional local sanity check first: `npm run build`.

### C3. Point your domain
Vercel → Project → **Settings → Domains** → add your domain and follow the DNS
instructions. From here on, `https://<your-domain>` is your base URL.

---

## Part D — Inngest (scheduling + async jobs)

Runs the daily crawl, daily/weekly digests, and the async `/ask` work.

### Local dev (optional, for testing)
```bash
npm run dev          # terminal 1
npm run inngest:dev  # terminal 2 — dashboard at http://localhost:8288
```

### Production
1. Sign up at <https://www.inngest.com> (free tier) → create an app.
2. Copy the **Event Key** + **Signing Key** into Vercel's env vars and redeploy:
   ```
   INNGEST_EVENT_KEY=...
   INNGEST_SIGNING_KEY=...
   ```
3. In the Inngest dashboard → **Sync new app** → enter
   `https://<your-domain>/api/inngest`.
4. The crons (`daily-crawl` 06:00 UTC, `daily-digest` 13:30 UTC, `weekly-digest`
   Mon 14:00 UTC) now run automatically. Trigger one manually to confirm.

---

## Part E — Slack & Discord bots

### E1. Slack `/ask`
1. Create an app at <https://api.slack.com/apps> → **From scratch**.
2. **OAuth & Permissions** → bot scopes `commands`, `chat:write`. Install to the
   workspace; copy the **Bot User OAuth Token** (`xoxb-...`).
3. **Basic Information** → copy the **Signing Secret**.
4. **Slash Commands** → create `/ask` with request URL
   `https://<your-domain>/api/slack/commands`.
5. Invite the bot to your digest channel; copy the channel ID (`C0XXXXXXX`).
6. Add to Vercel env vars (and redeploy):
   ```
   SLACK_SIGNING_SECRET=...
   SLACK_BOT_TOKEN=xoxb-...
   SLACK_DIGEST_CHANNEL=C0XXXXXXX
   ```

### E2. Discord `/ask`
1. Create an app at <https://discord.com/developers/applications>.
2. **General Information** → copy **Public Key** + **Application ID**.
3. **Bot** → copy the **Bot Token**. Invite the bot (OAuth2 URL Generator →
   scopes `bot` + `applications.commands`).
4. Create a channel **Webhook** (Server Settings → Integrations → Webhooks).
5. Add to Vercel env vars (and redeploy):
   ```
   DISCORD_PUBLIC_KEY=...
   DISCORD_BOT_TOKEN=...
   DISCORD_APP_ID=...
   DISCORD_DIGEST_WEBHOOK_URL=https://discord.com/api/webhooks/...
   ```
6. Register the `/ask` command (run locally with your `.env.local`, or anywhere
   the Discord vars are set):
   ```bash
   npm run discord:register
   ```
7. **General Information → Interactions Endpoint URL** →
   `https://<your-domain>/api/discord/interactions`. Discord sends a verification
   PING on save — the deployment must be live first.

> Both `/ask` handlers verify the request and ack within the 3-second deadline,
> then run RAG asynchronously via Inngest and post the answer back.

---

## Optional / later

- **Semantic Scholar key** (`S2_API_KEY`) — higher citation-enrichment limits.
- **Notion mirror** (`NOTION_TOKEN`, `NOTION_DB_ID`) — env present, code **not built yet**.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Missing required env var: X` in a script | Key not in `.env.local`, or Node < 20.12. |
| `test:llm` chat fails | Wrong `GROQ_API_KEY`, or `LLM_PROVIDER` not `groq`. |
| `test:llm` embed fails | Wrong `JINA_API_KEY`, or `EMBED_PROVIDER` not `jina`. |
| Backfill prints `⏸ … daily limit` | Expected on free tiers — re-run `npm run backfill` later; it resumes. |
| `next build` fails locally with a DB error | Ensure `.env.local` has `DATABASE_URL` (Next loads it for build). |
| Slack command "invalid signature" | Wrong `SLACK_SIGNING_SECRET` or clock skew > 5 min. |
| Discord interactions URL won't save | Deployment must be reachable and `DISCORD_PUBLIC_KEY` correct. |
| `/ask` says it found nothing | Backfill hasn't ingested papers on that topic yet. |
