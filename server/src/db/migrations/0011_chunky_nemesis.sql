CREATE INDEX "skills_ws_idx" ON "skills" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "agent_skills_skill_idx" ON "agent_skills" USING btree ("skill_id");