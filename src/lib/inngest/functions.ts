/**
 * Inngest functions — the always-on side of Research Radar:
 *  - dailyCrawl:   crawl the last few days of arXiv and ingest (incremental).
 *  - dailyDigest:  post the daily roundup to Slack + Discord.
 *  - weeklyDigest: post the weekly trend synthesis to Slack + Discord.
 *  - slackAsk / discordAsk: run RAG for a /ask command and reply asynchronously
 *    (keeps the HTTP handler under the 3s ack deadline).
 */
import { inngest } from "./client";
import { env } from "@/config/env";
import { fetchArxivWindow } from "@/lib/sources/arxiv";
import { ingestPapers } from "@/lib/kb/ingest";
import { buildDailyDigest, buildWeeklyDigest } from "@/lib/digest/build";
import { postSlackMessage, postSlackResponseUrl } from "@/lib/channels/slack";
import { postDiscordWebhook, editDiscordReply } from "@/lib/channels/discord";
import { askKnowledgeBase, type SearchHit } from "@/lib/kb/search";

function formatAnswer(answer: string, sources: SearchHit[]): string {
  if (sources.length === 0) return answer;
  const refs = sources
    .map((s, i) => `[${i + 1}] ${s.title} — https://arxiv.org/abs/${s.arxivId}`)
    .join("\n");
  return `${answer}\n\n*Sources*\n${refs}`;
}

/** Incremental crawl: every day, ingest the last 3 days of arXiv. */
export const dailyCrawl = inngest.createFunction(
  { id: "daily-crawl" },
  { cron: "0 6 * * *" }, // 06:00 UTC
  async ({ step }) => {
    return step.run("crawl-and-ingest", async () => {
      const now = new Date();
      const start = new Date(now.getTime() - 3 * 24 * 3600 * 1000);
      const raws = await fetchArxivWindow({
        categories: env.arxivCategories,
        start,
        end: now,
        maxPages: 10,
      });
      return ingestPapers(raws);
    });
  },
);

/** Daily roundup to Slack + Discord. */
export const dailyDigest = inngest.createFunction(
  { id: "daily-digest" },
  { cron: "30 13 * * *" }, // 13:30 UTC
  async ({ step }) => {
    return step.run("build-and-post", async () => {
      const digest = await buildDailyDigest(new Date());
      if (digest.paperIds.length === 0) return { posted: false, count: 0 };
      if (env.slackDigestChannel) await postSlackMessage(env.slackDigestChannel, digest.content);
      await postDiscordWebhook(digest.content);
      return { posted: true, count: digest.paperIds.length };
    });
  },
);

/** Weekly trend synthesis to Slack + Discord (Mondays). */
export const weeklyDigest = inngest.createFunction(
  { id: "weekly-digest" },
  { cron: "0 14 * * 1" }, // Monday 14:00 UTC
  async ({ step }) => {
    return step.run("build-and-post", async () => {
      const digest = await buildWeeklyDigest(new Date());
      if (env.slackDigestChannel) await postSlackMessage(env.slackDigestChannel, digest.content);
      await postDiscordWebhook(digest.content);
      return { posted: true, count: digest.paperIds.length };
    });
  },
);

/** Answer a Slack /ask asynchronously and reply via response_url. */
export const slackAsk = inngest.createFunction(
  { id: "slack-ask" },
  { event: "slack/ask.requested" },
  async ({ event, step }) => {
    const { question, responseUrl, topicSlug } = event.data as {
      question: string;
      responseUrl: string;
      topicSlug?: string;
    };
    return step.run("answer", async () => {
      const { answer, sources } = await askKnowledgeBase(question, { topicSlug });
      await postSlackResponseUrl(responseUrl, formatAnswer(answer, sources));
      return { sources: sources.length };
    });
  },
);

/** Answer a Discord /ask asynchronously and edit the deferred reply. */
export const discordAsk = inngest.createFunction(
  { id: "discord-ask" },
  { event: "discord/ask.requested" },
  async ({ event, step }) => {
    const { question, token, topicSlug } = event.data as {
      question: string;
      token: string;
      topicSlug?: string;
    };
    return step.run("answer", async () => {
      const { answer, sources } = await askKnowledgeBase(question, { topicSlug });
      await editDiscordReply(token, formatAnswer(answer, sources));
      return { sources: sources.length };
    });
  },
);

export const functions = [dailyCrawl, dailyDigest, weeklyDigest, slackAsk, discordAsk];
