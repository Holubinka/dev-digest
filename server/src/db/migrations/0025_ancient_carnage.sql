ALTER TABLE "ci_installations" ADD COLUMN "agent_version" integer;--> statement-breakpoint
ALTER TABLE "ci_installations" ADD COLUMN "last_polled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ci_installations" ADD COLUMN "workflow_present" boolean;--> statement-breakpoint
ALTER TABLE "ci_installations" ADD COLUMN "observed_agent" text;--> statement-breakpoint
ALTER TABLE "ci_runs" ADD COLUMN "repo" text;--> statement-breakpoint
ALTER TABLE "ci_runs" ADD COLUMN "workflow_run_id" bigint;--> statement-breakpoint
ALTER TABLE "ci_runs" ADD COLUMN "agent" text;--> statement-breakpoint
ALTER TABLE "ci_runs" ADD COLUMN "duration_ms" integer;--> statement-breakpoint
ALTER TABLE "ci_runs" ADD COLUMN "head_sha" text;--> statement-breakpoint
ALTER TABLE "ci_runs" ADD COLUMN "bundle_version" text;--> statement-breakpoint
ALTER TABLE "ci_runs" ADD COLUMN "verdict" text;--> statement-breakpoint
CREATE UNIQUE INDEX "ci_runs_repo_run_idx" ON "ci_runs" USING btree ("repo","workflow_run_id");