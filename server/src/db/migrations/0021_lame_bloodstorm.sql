CREATE TABLE "multi_agent_run_items" (
	"run_id" uuid PRIMARY KEY NOT NULL,
	"multi_run_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"agent_name" text NOT NULL,
	"position" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "multi_agent_runs" ADD COLUMN "concurrency" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "multi_agent_runs" ADD COLUMN "head_sha" text;--> statement-breakpoint
ALTER TABLE "multi_agent_run_items" ADD CONSTRAINT "multi_agent_run_items_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "multi_agent_run_items" ADD CONSTRAINT "multi_agent_run_items_multi_run_id_multi_agent_runs_id_fk" FOREIGN KEY ("multi_run_id") REFERENCES "public"."multi_agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "multi_agent_run_items_run_position_idx" ON "multi_agent_run_items" USING btree ("multi_run_id","position");--> statement-breakpoint
CREATE INDEX "agent_runs_ws_agent_ran_idx" ON "agent_runs" USING btree ("workspace_id","agent_id","ran_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "multi_agent_runs_ws_ran_idx" ON "multi_agent_runs" USING btree ("workspace_id","ran_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "multi_agent_runs_pr_idx" ON "multi_agent_runs" USING btree ("pr_id");