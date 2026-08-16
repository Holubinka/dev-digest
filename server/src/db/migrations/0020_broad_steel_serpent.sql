ALTER TABLE "pr_brief" ADD COLUMN "ref_lines" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "head_sha" text;