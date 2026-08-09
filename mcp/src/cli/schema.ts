/**
 * The narrow response schema for `POST /reviews/diff`.
 *
 * Same rule as `src/api/schemas.ts`: name only the fields this client reads, and
 * `safeParse` at the edge, so a moved API contract is a loud error rather than a
 * silently wrong exit code. `FindingSummary` is reused rather than restated —
 * `compareFindings` in `src/project.ts` sorts on exactly that shape, and a
 * second finding type here would mean a second ranker to keep in step.
 */

import { z } from 'zod';
import { FindingSummary } from '../api/schemas.js';

/**
 * `blockers` is the number the exit code is derived from. It is computed
 * server-side by `countBlockers(findings, agent.ci_fail_on)` — the same function
 * that fills `agent_runs.blockers` for a PR review — so the CLI never has to
 * guess which severity a given agent treats as blocking.
 */
export const DiffReviewResult = z.object({
  agent_name: z.string(),
  provider: z.string(),
  model: z.string(),
  verdict: z.string(),
  score: z.number(),
  blockers: z.number().int(),
  grounding: z.string(),
  findings: z.array(FindingSummary),
});
export type DiffReviewResult = z.infer<typeof DiffReviewResult>;

export const DiffReviewPayload = z.object({
  files: z.number().int(),
  reviews: z.array(DiffReviewResult),
});
export type DiffReviewPayload = z.infer<typeof DiffReviewPayload>;
