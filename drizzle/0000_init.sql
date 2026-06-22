CREATE TYPE "public"."crawl_status" AS ENUM('pending', 'running', 'done', 'error');--> statement-breakpoint
CREATE TYPE "public"."digest_type" AS ENUM('daily', 'weekly');--> statement-breakpoint
CREATE TYPE "public"."novelty" AS ENUM('novel', 'incremental', 'duplicate', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."relation_type" AS ENUM('cites', 'similar', 'follows_up');--> statement-breakpoint
CREATE TABLE "crawl_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"status" "crawl_status" DEFAULT 'pending' NOT NULL,
	"stats" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "digests" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" "digest_type" NOT NULL,
	"period" text NOT NULL,
	"content" text NOT NULL,
	"paper_ids" integer[] DEFAULT '{}' NOT NULL,
	"posted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "paper_relations" (
	"id" serial PRIMARY KEY NOT NULL,
	"from_paper" integer NOT NULL,
	"to_paper" integer NOT NULL,
	"type" "relation_type" NOT NULL,
	"weight" real DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "paper_topics" (
	"paper_id" integer NOT NULL,
	"topic_id" integer NOT NULL,
	"confidence" real DEFAULT 1 NOT NULL,
	CONSTRAINT "paper_topics_paper_id_topic_id_pk" PRIMARY KEY("paper_id","topic_id")
);
--> statement-breakpoint
CREATE TABLE "papers" (
	"id" serial PRIMARY KEY NOT NULL,
	"arxiv_id" text NOT NULL,
	"title" text NOT NULL,
	"authors" text[] DEFAULT '{}' NOT NULL,
	"abstract" text DEFAULT '' NOT NULL,
	"published_at" timestamp with time zone,
	"updated_at_source" timestamp with time zone,
	"url" text DEFAULT '' NOT NULL,
	"pdf_url" text DEFAULT '' NOT NULL,
	"categories" text[] DEFAULT '{}' NOT NULL,
	"source" text DEFAULT 'arxiv' NOT NULL,
	"citation_count" integer DEFAULT 0 NOT NULL,
	"hf_trending" boolean DEFAULT false NOT NULL,
	"relevant" boolean,
	"summary" text,
	"summary_struct" jsonb,
	"novelty" "novelty" DEFAULT 'unknown' NOT NULL,
	"dedup_group_id" integer,
	"embedding" vector(768),
	"notion_page_id" text,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "topics" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "topics_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "paper_relations" ADD CONSTRAINT "paper_relations_from_paper_papers_id_fk" FOREIGN KEY ("from_paper") REFERENCES "public"."papers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paper_relations" ADD CONSTRAINT "paper_relations_to_paper_papers_id_fk" FOREIGN KEY ("to_paper") REFERENCES "public"."papers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paper_topics" ADD CONSTRAINT "paper_topics_paper_id_papers_id_fk" FOREIGN KEY ("paper_id") REFERENCES "public"."papers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paper_topics" ADD CONSTRAINT "paper_topics_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "crawl_runs_window_uq" ON "crawl_runs" USING btree ("source","period_start","period_end");--> statement-breakpoint
CREATE UNIQUE INDEX "paper_relations_uq" ON "paper_relations" USING btree ("from_paper","to_paper","type");--> statement-breakpoint
CREATE INDEX "paper_relations_from_idx" ON "paper_relations" USING btree ("from_paper");--> statement-breakpoint
CREATE INDEX "paper_relations_to_idx" ON "paper_relations" USING btree ("to_paper");--> statement-breakpoint
CREATE UNIQUE INDEX "papers_arxiv_id_uq" ON "papers" USING btree ("arxiv_id");--> statement-breakpoint
CREATE INDEX "papers_published_at_idx" ON "papers" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX "papers_processed_at_idx" ON "papers" USING btree ("processed_at");--> statement-breakpoint
CREATE INDEX "papers_embedding_idx" ON "papers" USING hnsw ("embedding" vector_cosine_ops);