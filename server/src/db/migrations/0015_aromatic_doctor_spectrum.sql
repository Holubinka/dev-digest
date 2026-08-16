CREATE TABLE "agent_context_docs" (
	"agent_id" uuid NOT NULL,
	"repo_id" uuid NOT NULL,
	"path" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "agent_context_docs_agent_id_repo_id_path_pk" PRIMARY KEY("agent_id","repo_id","path")
);
--> statement-breakpoint
CREATE TABLE "repo_doc_scans" (
	"repo_id" uuid PRIMARY KEY NOT NULL,
	"roots" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"file_count" integer DEFAULT 0 NOT NULL,
	"bounded" boolean DEFAULT false NOT NULL,
	"scanned_at" timestamp with time zone,
	"last_error" text,
	"last_error_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "repo_docs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"repo_id" uuid NOT NULL,
	"path" text NOT NULL,
	"root" text NOT NULL,
	"kind" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"tokens" integer NOT NULL,
	"modified_at" timestamp with time zone,
	"scanned_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skill_context_docs" (
	"skill_id" uuid NOT NULL,
	"repo_id" uuid NOT NULL,
	"path" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "skill_context_docs_skill_id_repo_id_path_pk" PRIMARY KEY("skill_id","repo_id","path")
);
--> statement-breakpoint
ALTER TABLE "agent_context_docs" ADD CONSTRAINT "agent_context_docs_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_context_docs" ADD CONSTRAINT "agent_context_docs_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repo_doc_scans" ADD CONSTRAINT "repo_doc_scans_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repo_docs" ADD CONSTRAINT "repo_docs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repo_docs" ADD CONSTRAINT "repo_docs_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_context_docs" ADD CONSTRAINT "skill_context_docs_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_context_docs" ADD CONSTRAINT "skill_context_docs_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_context_docs_repo_path_idx" ON "agent_context_docs" USING btree ("repo_id","path");--> statement-breakpoint
CREATE UNIQUE INDEX "repo_docs_repo_path_uq" ON "repo_docs" USING btree ("repo_id","path");--> statement-breakpoint
CREATE INDEX "repo_docs_repo_idx" ON "repo_docs" USING btree ("repo_id");--> statement-breakpoint
CREATE INDEX "skill_context_docs_repo_path_idx" ON "skill_context_docs" USING btree ("repo_id","path");