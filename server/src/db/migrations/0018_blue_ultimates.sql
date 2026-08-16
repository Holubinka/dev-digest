/*
    HAND-ORDERED, and drizzle-kit asked for half of it.

    1. The DROP CONSTRAINT line is the one drizzle-kit emits commented out with
       "we can't automatically get name for primary key". The name is
       `pr_brief_pkey` — Postgres's implicit name for the inline `PRIMARY KEY` in
       `0000_init.sql:212`, confirmed against the running database with
       `SELECT constraint_name FROM information_schema.table_constraints`.
    2. The generated file put `ADD CONSTRAINT ... PRIMARY KEY("pr_id","head_sha")`
       BEFORE `ADD COLUMN "head_sha"`, which cannot run. The statements below are
       the generated ones reordered: drop the old key, add every column, then add
       the composite key.

    The NOT NULL columns carry no backfill on purpose: `pr_brief` has had zero
    writers since `0000_init.sql`, so the table is empty everywhere it exists.
*/

ALTER TABLE "pr_brief" DROP CONSTRAINT "pr_brief_pkey";--> statement-breakpoint
ALTER TABLE "pr_brief" ADD COLUMN "head_sha" text NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_brief" ADD COLUMN "what" text NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_brief" ADD COLUMN "why" text NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_brief" ADD COLUMN "risk_level" text DEFAULT 'low' NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_brief" ADD COLUMN "risks" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_brief" ADD COLUMN "review_focus" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_brief" ADD COLUMN "inputs" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_brief" ADD COLUMN "dropped_refs" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_brief" ADD COLUMN "dropped_risks" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_brief" ADD COLUMN "intent_computed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pr_brief" ADD COLUMN "intent_freshness" text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_brief" ADD COLUMN "blast_status" text NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_brief" ADD COLUMN "link_sha" text;--> statement-breakpoint
ALTER TABLE "pr_brief" ADD COLUMN "index_matches_head" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_brief" ADD COLUMN "budget" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_brief" ADD COLUMN "input_tokens_counted" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_brief" ADD COLUMN "tokenizer" text NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_brief" ADD COLUMN "attempts" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_brief" ADD COLUMN "tokens_in" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_brief" ADD COLUMN "provider" text;--> statement-breakpoint
ALTER TABLE "pr_brief" ADD COLUMN "model" text;--> statement-breakpoint
ALTER TABLE "pr_brief" ADD COLUMN "cost_usd" double precision;--> statement-breakpoint
ALTER TABLE "pr_brief" ADD COLUMN "computed_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_brief" ADD COLUMN "evicted_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_brief" ADD CONSTRAINT "pr_brief_pr_id_head_sha_pk" PRIMARY KEY("pr_id","head_sha");--> statement-breakpoint
CREATE INDEX "pr_brief_pr_computed_idx" ON "pr_brief" USING btree ("pr_id","computed_at" DESC NULLS LAST);
