/**
 * Centralized environment access. Keeps `process.env.X!` out of the rest of
 * the codebase and gives one place to see what configuration exists.
 * Values are read lazily so that build-time (no env) doesn't crash.
 */
function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function opt(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

export const env = {
  get databaseUrl() {
    return req("DATABASE_URL");
  },

  // OpenRouter
  get openrouterKey() {
    return req("OPENROUTER_API_KEY");
  },
  get modelFast() {
    return opt("OPENROUTER_MODEL_FAST", "google/gemini-2.0-flash-exp:free");
  },
  get modelSmart() {
    return opt("OPENROUTER_MODEL_SMART", "anthropic/claude-3.5-sonnet");
  },
  get openrouterSiteUrl() {
    return opt("OPENROUTER_SITE_URL", "https://radar.local");
  },
  get openrouterSiteName() {
    return opt("OPENROUTER_SITE_NAME", "Research Radar");
  },

  // LLM provider: "groq" | "gemini" | "openrouter". Picks which chat backend
  // chat()/chatJSON() dispatch to. Embeddings always use Gemini (Groq has none).
  get llmProvider() {
    return opt("LLM_PROVIDER", "gemini").toLowerCase();
  },

  // Groq (OpenAI-compatible chat; free tier with high daily limits)
  get groqKey() {
    return req("GROQ_API_KEY");
  },
  get groqModelFast() {
    return opt("GROQ_MODEL_FAST", "llama-3.1-8b-instant");
  },
  get groqModelSmart() {
    return opt("GROQ_MODEL_SMART", "llama-3.3-70b-versatile");
  },

  // Embedding provider: "jina" (default) or "gemini". Both must yield EMBED_DIM dims.
  get embedProvider() {
    return opt("EMBED_PROVIDER", "jina").toLowerCase();
  },

  // Jina embeddings (free HTTP API)
  get jinaKey() {
    return req("JINA_API_KEY");
  },
  get jinaModel() {
    return opt("JINA_MODEL", "jina-embeddings-v3");
  },

  // Gemini (embeddings + chat when LLM_PROVIDER=gemini)
  get geminiKey() {
    return req("GEMINI_API_KEY");
  },
  get geminiEmbedModel() {
    return opt("GEMINI_EMBED_MODEL", "text-embedding-004");
  },
  get geminiModelFast() {
    return opt("GEMINI_MODEL_FAST", "gemini-2.0-flash");
  },
  get geminiModelSmart() {
    return opt("GEMINI_MODEL_SMART", "gemini-2.0-flash");
  },

  // Slack
  get slackSigningSecret() {
    return req("SLACK_SIGNING_SECRET");
  },
  get slackBotToken() {
    return req("SLACK_BOT_TOKEN");
  },
  get slackDigestChannel() {
    return opt("SLACK_DIGEST_CHANNEL");
  },

  // Discord
  get discordPublicKey() {
    return req("DISCORD_PUBLIC_KEY");
  },
  get discordBotToken() {
    return req("DISCORD_BOT_TOKEN");
  },
  get discordAppId() {
    return req("DISCORD_APP_ID");
  },
  get discordDigestWebhook() {
    return opt("DISCORD_DIGEST_WEBHOOK_URL");
  },

  // Notion
  get notionToken() {
    return req("NOTION_TOKEN");
  },
  get notionDbId() {
    return req("NOTION_DB_ID");
  },

  // Semantic Scholar (optional)
  get s2Key() {
    return opt("S2_API_KEY");
  },

  // Crawl config
  get backfillSince() {
    return opt("BACKFILL_SINCE", "2025-01");
  },
  get arxivCategories() {
    return opt("ARXIV_CATEGORIES", "cs.LG,cs.CL,cs.AI")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  },
};

/** Embedding dimensionality for Gemini text-embedding-004. */
export const EMBED_DIM = 768;
