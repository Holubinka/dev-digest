CREATE TABLE "repo_doc_edits" (
	"repo_id" uuid NOT NULL,
	"path" text NOT NULL,
	"created_here" boolean DEFAULT false NOT NULL,
	"content_hash" text NOT NULL,
	"saved_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "repo_doc_edits_repo_id_path_pk" PRIMARY KEY("repo_id","path")
);
--> statement-breakpoint
ALTER TABLE "repo_docs" ADD COLUMN "content_hash" text;--> statement-breakpoint
ALTER TABLE "repo_doc_edits" ADD CONSTRAINT "repo_doc_edits_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;