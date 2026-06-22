import {
  pgTable,
  pgEnum,
  serial,
  integer,
  text,
  boolean,
  timestamp,
  jsonb,
  real,
  vector,
  index,
  uniqueIndex,
  primaryKey,
} from "drizzle-orm/pg-core";
import { EMBED_DIM } from "@/config/env";

export const noveltyEnum = pgEnum("novelty", ["novel", "incremental", "duplicate", "unknown"]);
export const relationTypeEnum = pgEnum("relation_type", ["cites", "similar", "follows_up"]);
export const digestTypeEnum = pgEnum("digest_type", ["daily", "weekly"]);
export const crawlStatusEnum = pgEnum("crawl_status", ["pending", "running", "done", "error"]);

/** Post-training topic taxonomy (seeded from src/config/topics.ts). */
export const topics = pgTable("topics", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** One row per research paper in the knowledge base. */
export const papers = pgTable(
  "papers",
  {
    id: serial("id").primaryKey(),
    arxivId: text("arxiv_id").notNull(),
    title: text("title").notNull(),
    authors: text("authors").array().notNull().default([]),
    abstract: text("abstract").notNull().default(""),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    updatedAtSource: timestamp("updated_at_source", { withTimezone: true }),
    url: text("url").notNull().default(""),
    pdfUrl: text("pdf_url").notNull().default(""),
    categories: text("categories").array().notNull().default([]),
    source: text("source").notNull().default("arxiv"),

    // Enrichment
    citationCount: integer("citation_count").notNull().default(0),
    hfTrending: boolean("hf_trending").notNull().default(false),

    // LLM-derived
    relevant: boolean("relevant"),
    summary: text("summary"),
    summaryStruct: jsonb("summary_struct").$type<{
      method?: string;
      results?: string;
      whyItMatters?: string;
      tags?: string[];
    }>(),
    novelty: noveltyEnum("novelty").notNull().default("unknown"),
    dedupGroupId: integer("dedup_group_id"),

    // Vector embedding of (title + abstract + summary)
    embedding: vector("embedding", { dimensions: EMBED_DIM }),

    // External mirrors
    notionPageId: text("notion_page_id"),

    // Pipeline bookkeeping
    processedAt: timestamp("processed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("papers_arxiv_id_uq").on(t.arxivId),
    index("papers_published_at_idx").on(t.publishedAt),
    index("papers_processed_at_idx").on(t.processedAt),
    // HNSW index for cosine similarity search (pgvector)
    index("papers_embedding_idx").using("hnsw", t.embedding.op("vector_cosine_ops")),
  ],
);

/** Many-to-many: paper -> topics with classifier confidence. */
export const paperTopics = pgTable(
  "paper_topics",
  {
    paperId: integer("paper_id")
      .notNull()
      .references(() => papers.id, { onDelete: "cascade" }),
    topicId: integer("topic_id")
      .notNull()
      .references(() => topics.id, { onDelete: "cascade" }),
    confidence: real("confidence").notNull().default(1),
  },
  (t) => [primaryKey({ columns: [t.paperId, t.topicId] })],
);

/** Knowledge-graph edges between papers (citations, similarity, follow-ups). */
export const paperRelations = pgTable(
  "paper_relations",
  {
    id: serial("id").primaryKey(),
    fromPaper: integer("from_paper")
      .notNull()
      .references(() => papers.id, { onDelete: "cascade" }),
    toPaper: integer("to_paper")
      .notNull()
      .references(() => papers.id, { onDelete: "cascade" }),
    type: relationTypeEnum("type").notNull(),
    weight: real("weight").notNull().default(1),
  },
  (t) => [
    uniqueIndex("paper_relations_uq").on(t.fromPaper, t.toPaper, t.type),
    index("paper_relations_from_idx").on(t.fromPaper),
    index("paper_relations_to_idx").on(t.toPaper),
  ],
);

/** Idempotency + progress tracking for crawl windows. */
export const crawlRuns = pgTable(
  "crawl_runs",
  {
    id: serial("id").primaryKey(),
    source: text("source").notNull(),
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
    status: crawlStatusEnum("status").notNull().default("pending"),
    stats: jsonb("stats").$type<{ found?: number; upserted?: number; processed?: number }>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("crawl_runs_window_uq").on(t.source, t.periodStart, t.periodEnd)],
);

/** Record of digests/roundups posted to chat channels. */
export const digests = pgTable("digests", {
  id: serial("id").primaryKey(),
  type: digestTypeEnum("type").notNull(),
  period: text("period").notNull(), // e.g. "2026-06-22" or "2026-W25"
  content: text("content").notNull(),
  paperIds: integer("paper_ids").array().notNull().default([]),
  postedAt: timestamp("posted_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Paper = typeof papers.$inferSelect;
export type NewPaper = typeof papers.$inferInsert;
export type Topic = typeof topics.$inferSelect;
