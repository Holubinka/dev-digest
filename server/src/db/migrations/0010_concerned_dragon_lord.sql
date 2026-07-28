ALTER TABLE "agent_runs" ADD COLUMN "cost_usd" double precision;--> statement-breakpoint
-- One-time backfill of runs that finished before this column existed.
--
-- The VALUES list is a FROZEN SNAPSHOT of PRICING in
-- server/src/adapters/llm/pricing.ts, taken at backfill time. Do NOT re-sync it
-- when that table changes: what a run cost is a historical record, not a live
-- computation. New runs never touch this path — they store the provider's own
-- reported cost (or a fresh estimate) at completion.
--
-- Model slugs missing from the snapshot stay NULL and render as "—" in the UI.
UPDATE "agent_runs" AS r
SET "cost_usd" = ("tokens_in" * p.in_per_m + "tokens_out" * p.out_per_m) / 1000000.0
FROM (VALUES
  ('gpt-5.5', 5.0, 30.0),
  ('gpt-5.4', 2.5, 15.0),
  ('gpt-5.4-mini', 0.75, 4.5),
  ('gpt-5.4-nano', 0.2, 1.25),
  ('gpt-5.1', 1.25, 10.0),
  ('gpt-5', 1.25, 10.0),
  ('gpt-4.1', 2.0, 8.0),
  ('gpt-4.1-mini', 0.4, 1.6),
  ('gpt-4o', 2.5, 10.0),
  ('gpt-4o-mini', 0.15, 0.6),
  ('text-embedding-3-small', 0.02, 0.0),
  ('claude-3-5-sonnet-latest', 3.0, 15.0),
  ('claude-3-5-haiku-latest', 0.8, 4.0),
  ('claude-3-opus-latest', 15.0, 75.0),
  ('z-ai/glm-4.7-flash', 0.0, 0.0),
  ('deepseek/deepseek-v4-flash', 0.14, 0.28),
  ('z-ai/glm-4.7-flashx', 0.15, 0.4),
  ('minimax/minimax-m2.5', 0.3, 1.2),
  ('z-ai/glm-5.1', 0.6, 2.2)
) AS p(model, in_per_m, out_per_m)
WHERE r."model" = p.model
  AND r."cost_usd" IS NULL
  AND r."tokens_in" IS NOT NULL
  AND r."tokens_out" IS NOT NULL;
