/**
 * Narrow response schemas — one per API response, naming ONLY the fields the
 * tools project (spec 06 step 3, Constraints 4 and 5).
 *
 * These deliberately do NOT import `@devdigest/shared`. A third vendored copy
 * would be the only one no gate compares (`shared-sync` diffs exactly two
 * paths), and a tsconfig alias to the server copy would put the whole contract
 * in scope — which invites returning it whole, the thing the MCP output budget
 * punishes. The compensating control is that every response goes through
 * `safeParse` against these schemas, so a moved contract becomes a loud,
 * self-describing tool error instead of a silently wrong answer.
 *
 * Unknown keys are STRIPPED, not rejected: the API may grow fields without
 * breaking this server. A field we name going missing or changing type is what
 * must fail.
 */

import { z } from 'zod';

/** `GET /repos` — `Repo`, reduced to what `repoId()` needs. */
export const RepoSummary = z.object({
  id: z.string(),
  full_name: z.string(),
});
export type RepoSummary = z.infer<typeof RepoSummary>;

/**
 * `GET /repos/:id/pulls` — `PrMeta`, reduced. `id` is `nullish` in the contract
 * (a PR the API can list but has not persisted), so the resolver must guard it.
 */
export const PullSummary = z.object({
  id: z.string().nullish(),
  number: z.number().int(),
});
export type PullSummary = z.infer<typeof PullSummary>;

/**
 * `GET /agents` — `Agent`, reduced. `system_prompt` is absent on purpose: it is
 * the largest field on the contract, thousands of tokens per agent, and no tool
 * projects it. Not naming it here means it cannot reach a tool result by
 * accident.
 */
export const AgentSummary = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  model: z.string(),
  enabled: z.boolean(),
});
export type AgentSummary = z.infer<typeof AgentSummary>;

/**
 * A finding as `GET /pulls/:id/reviews` carries it.
 *
 * `severity` is the enum because the projection SORTS on it — an unrecognised
 * value has no defined position, so failing loudly is right. `category` is a
 * pass-through label, so a new category server-side must not break this server.
 */
export const FindingSummary = z.object({
  severity: z.enum(['CRITICAL', 'WARNING', 'SUGGESTION']),
  category: z.string(),
  title: z.string(),
  file: z.string(),
  start_line: z.number().int(),
  end_line: z.number().int(),
  rationale: z.string(),
  suggestion: z.string().nullish(),
  confidence: z.number(),
});
export type FindingSummary = z.infer<typeof FindingSummary>;

/**
 * `GET /pulls/:id/reviews` — `ReviewDto`, reduced.
 *
 * `kind` (`'summary' | 'review'`) is deliberately NOT named. A review is
 * selected here by `run_id` taken from `GET /pulls/:id/runs`, and a run id is an
 * `agent_runs` row — a reduce/summary review cannot carry one, so filtering on
 * `kind` would be a second guard on a door already locked. Nothing in the server
 * writes `kind: 'summary'` today either (`reviews/run-executor.ts:414` is the
 * only insert and it writes `'review'`). If review selection ever stops being
 * keyed on `run_id`, add `kind` here and filter.
 */
export const ReviewSummary = z.object({
  run_id: z.string().nullable(),
  agent_id: z.string().nullable(),
  agent_name: z.string().nullish(),
  verdict: z.string().nullable(),
  summary: z.string().nullable(),
  score: z.number().int().nullable(),
  /** Selection key, not a projected field: picks the newest review for a PR. */
  created_at: z.string(),
  findings: z.array(FindingSummary),
});
export type ReviewSummary = z.infer<typeof ReviewSummary>;

/**
 * `GET /pulls/:id/runs` — `RunSummary`, reduced to the run history fields that
 * decide what a tool says: which run, whose, what state, why it failed, when it
 * started.
 *
 * `status` is `nullable` because the column is (`db/schema/runs.ts:28`), and a
 * plain `string` rather than an enum: an unrecognised status must read as
 * "not finished" and keep the caller waiting, never crash the poll loop of a
 * review that is already costing money.
 */
export const RunSummary = z.object({
  run_id: z.string(),
  agent_id: z.string().nullable(),
  agent_name: z.string().nullable(),
  status: z.string().nullable(),
  error: z.string().nullable(),
  ran_at: z.string().nullable(),
});
export type RunSummary = z.infer<typeof RunSummary>;

/**
 * `POST /pulls/:id/review` — the fire-and-forget acknowledgement. `reviews` is
 * always `[]` at this point (`reviews/service.ts:141`), so only the created run
 * rows are named. `agent_id` is here to pick OUR run out of the array rather
 * than trusting position.
 */
export const ReviewStartResponse = z.object({
  runs: z.array(
    z.object({
      run_id: z.string(),
      agent_id: z.string().nullish(),
    }),
  ),
});
export type ReviewStartResponse = z.infer<typeof ReviewStartResponse>;

/**
 * `GET /repos/:id/conventions` — `ConventionCandidate`, reduced.
 *
 * `status` is an enum because `get_conventions` FILTERS on it: an unrecognised
 * value would silently drop rows from the answer, which is worse than a loud
 * contract error. `category` is a pass-through label and stays a plain string,
 * so a new category server-side does not break this server.
 */
export const ConventionSummary = z.object({
  category: z.string(),
  rule: z.string(),
  evidence_path: z.string().nullable(),
  evidence_line: z.number().int().nullable(),
  confidence: z.number().nullable(),
  status: z.enum(['pending', 'accepted', 'rejected']),
});
export type ConventionSummary = z.infer<typeof ConventionSummary>;

/** `ConventionScan`, reduced to the one-line provenance the tool prints. */
export const ConventionScanSummary = z.object({
  model: z.string(),
  created_at: z.string(),
});
export type ConventionScanSummary = z.infer<typeof ConventionScanSummary>;

/** The `GET /repos/:id/conventions` envelope: the last scan and every candidate. */
export const ConventionsPayload = z.object({
  scan: ConventionScanSummary.nullable(),
  candidates: z.array(ConventionSummary),
});
export type ConventionsPayload = z.infer<typeof ConventionsPayload>;

/**
 * One call site of a changed symbol, as `GET /pulls/:id/blast` carries it
 * (`BlastViewCaller` in `contracts/blast.ts`).
 *
 * `rank` is a selection key, not a projected field: it is the caller FILE's
 * importance percentile and it decides which callers survive the per-symbol cap,
 * so dropping it here would make the cut arbitrary. `symbol` — the declaration
 * the call sits in — is deliberately absent: the projection collapses a caller to
 * `"file:line"`, and naming a field no result can show is a token spent on
 * nothing.
 */
export const BlastCallerSummary = z.object({
  file: z.string(),
  line: z.number().int(),
  rank: z.number(),
});
export type BlastCallerSummary = z.infer<typeof BlastCallerSummary>;

/**
 * An HTTP route or cron the change reaches, reduced to the one field a model
 * reads. `kind` and `depth` are not named: `totals` already counts endpoints and
 * crons separately, and the hop count is provenance for the card, not an action
 * a model can take.
 */
export const BlastEndpointSummary = z.object({
  label: z.string(),
});
export type BlastEndpointSummary = z.infer<typeof BlastEndpointSummary>;

/**
 * A symbol the pull request changes. `truncated` is not named — `caller_count`
 * against the length of the projected list says the same thing and survives this
 * server applying its own, tighter cap.
 */
export const BlastSymbolSummary = z.object({
  name: z.string(),
  file: z.string(),
  line: z.number().int(),
  callers: z.array(BlastCallerSummary),
  caller_count: z.number().int(),
  endpoints: z.array(BlastEndpointSummary),
});
export type BlastSymbolSummary = z.infer<typeof BlastSymbolSummary>;

/**
 * `GET /pulls/:id/blast` — `BlastRadiusView`, reduced.
 *
 * `status` is an enum because the projection BRANCHES on it: a non-`full` status
 * is what turns an empty `symbols` list from "nothing depends on this" into "the
 * index could not tell". An unrecognised value would silently take the reassuring
 * branch, so failing loudly is right — the same reasoning as `ConventionSummary`.
 *
 * `link_sha` and `index_matches_head` ARE named, because every `line` in this
 * payload was recorded by the indexer against `link_sha` and means nothing at any
 * other commit. Without them the projection hands a model `"file:line"` strings
 * with no commit attached, and a model reasonably resolves those against the PR
 * head — which is how the web card was wrong until 2026-08-09 (`contracts/blast.ts`
 * §TWO SHAS, ON PURPOSE). `nullable`, not `optional`: the field is always sent,
 * and `null` means the index knows no commit, so there is nothing to resolve
 * against — never "fall back to head".
 *
 * `repo_full_name`, `head_sha` and `summary` stay absent: the first is already in
 * the caller's own arguments, `head_sha` is the PR's identity and the one commit
 * these line numbers are NOT valid at, and `summary` is the LLM paragraph the web
 * card asks for separately — this tool never triggers it.
 */
export const BlastPayload = z.object({
  status: z.enum(['full', 'partial', 'degraded']),
  reason: z.string().nullable(),
  /** The commit every `line` below was recorded at. Null when the index knows none. */
  link_sha: z.string().nullable(),
  /** `link_sha === head_sha`. False also covers `link_sha === null`. */
  index_matches_head: z.boolean(),
  changed_files: z.array(z.string()),
  symbols: z.array(BlastSymbolSummary),
  totals: z.object({
    symbols: z.number().int(),
    callers: z.number().int(),
    endpoints: z.number().int(),
    crons: z.number().int(),
  }),
});
export type BlastPayload = z.infer<typeof BlastPayload>;
