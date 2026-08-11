import { z } from 'zod';

/**
 * Blast radius — the read-only, per-PR answer served by `GET /pulls/:id/blast`.
 *
 * RELATIONSHIP TO `contracts/brief.ts`
 * -----------------------------------
 * `brief.ts` already exports a `BlastRadius` (and a `BlastCaller`). Those are the
 * future `PrBrief` payload: an LLM-facing summary that carries no index status and
 * no line numbers on a caller. This contract is the *view* the UI and MCP read, and
 * it needs both:
 *
 *  - `status` / `reason` — a `partial` or `degraded` index must be a visible state,
 *    never an empty list rendered as "no impact".
 *  - `line` on every caller and endpoint — the card links each row to GitHub with
 *    `githubBlobUrl(..., file, line)`, and without a line the link cannot open the
 *    right line.
 *
 * The two are deliberately separate contracts, related by this comment. The names
 * here are prefixed so both survive the `export *` barrel in `../index.ts`:
 * `BlastRadiusView` (not `BlastRadius`) and `BlastViewCaller` (not `BlastCaller`) —
 * a duplicate star-export is a TS2308 error, not a silent shadow.
 */

/**
 * How much of the answer the persistent index could actually back.
 * `failed` is not reachable here: the route maps it onto `degraded` with a reason,
 * so the client branches on three states, not four.
 */
export const BlastIndexStatus = z.enum(['full', 'partial', 'degraded']);
export type BlastIndexStatus = z.infer<typeof BlastIndexStatus>;

/**
 * An HTTP route or cron schedule sitting in a file the change reaches.
 * `depth` is hops through the import graph from the changed file: 0 = the changed
 * file itself, 2 = the cap of the downstream walk.
 */
export const BlastEndpoint = z.object({
  label: z.string(),
  file: z.string(),
  line: z.number().int(),
  depth: z.number().int().min(0).max(2),
  kind: z.enum(['http', 'cron']),
});
export type BlastEndpoint = z.infer<typeof BlastEndpoint>;

/**
 * One call site of a changed symbol. `rank` is the caller file's `file_rank.rank`
 * percentile — the callers list is ordered by it, descending.
 */
export const BlastViewCaller = z.object({
  file: z.string(),
  symbol: z.string(),
  line: z.number().int(),
  rank: z.number(),
});
export type BlastViewCaller = z.infer<typeof BlastViewCaller>;

/**
 * A symbol declared in a changed file, with who calls it.
 * `caller_count` is the count BEFORE the per-symbol cap; `truncated` says the
 * `callers` array is shorter than `caller_count`.
 *
 * `endpoints` is capped the same way, and for the same reason: its length is set
 * by repository content — one entry per matching line of every caller file — so
 * an answer that carried it whole would be bounded by nothing this codebase
 * controls. `endpoint_count` is the pre-cap size and `endpoints_truncated` says
 * the list is short, because a UI that renders one badge per element must be able
 * to tell "reaches three routes" from "reaches the first three of nine hundred".
 * The names are asymmetric (`truncated` is already the caller list's) rather than
 * renamed, which would have been a breaking change to every reader.
 */
export const BlastSymbol = z.object({
  name: z.string(),
  kind: z.string(),
  file: z.string(),
  line: z.number().int(),
  callers: z.array(BlastViewCaller),
  caller_count: z.number().int(),
  truncated: z.boolean(),
  endpoints: z.array(BlastEndpoint),
  endpoint_count: z.number().int(),
  endpoints_truncated: z.boolean(),
});
export type BlastSymbol = z.infer<typeof BlastSymbol>;

/**
 * The whole answer. `reason` is a human-readable sentence and is non-null whenever
 * `status !== 'full'`. `summary` is null until the optional LLM explanation is
 * requested — nothing here is persisted.
 *
 * TWO SHAS, ON PURPOSE
 * --------------------
 * `head_sha` is the PR's head commit — the tree the diff is against.
 * `link_sha` is the commit the index was built from (`repo_index_state.
 * last_indexed_sha`), and it is the ONLY commit at which the `line` numbers in
 * this payload mean anything: every symbol line and every caller line was
 * recorded by the indexer against that tree. Building a `file:line` link against
 * `head_sha` points at whatever happens to sit on that line now — on
 * `Holubinka/dev-digest` PR #12 that was a comment two lines above the real call
 * site, because ten lines had been deleted from `server/src/app.ts` in between.
 *
 * So: render `head_sha` as the PR's identity, build links from `link_sha`, and
 * when `index_matches_head` is false say the two differ rather than pretending
 * the answer is current.
 *
 * `link_sha` is null when the index has no known commit (an unindexed repo, or a
 * server with code intelligence switched off). There are no lines to link in that
 * case either — a null here means "do not build a link", not "fall back to head".
 */
export const BlastRadiusView = z.object({
  status: BlastIndexStatus,
  reason: z.string().nullable(),
  repo_full_name: z.string(),
  head_sha: z.string(),
  /** The commit the line numbers belong to. Null when the index knows no commit. */
  link_sha: z.string().nullable(),
  /**
   * `link_sha === head_sha`. False also covers `link_sha === null`.
   *
   * Named for what is actually known. "Behind" would claim ancestry this payload
   * never establishes: the index could equally have been built on another branch,
   * or after the PR head. What is provable is that the two commits differ, and
   * that is enough for the UI to warn that the links open an older tree.
   */
  index_matches_head: z.boolean(),
  changed_files: z.array(z.string()),
  symbols: z.array(BlastSymbol),
  totals: z.object({
    symbols: z.number().int(),
    callers: z.number().int(),
    endpoints: z.number().int(),
    crons: z.number().int(),
  }),
  summary: z.string().nullable(),
});
export type BlastRadiusView = z.infer<typeof BlastRadiusView>;

/** `POST /pulls/:id/blast/summary` — one paragraph, grounded in the view's facts. */
export const BlastSummaryResponse = z.object({
  summary: z.string(),
});
export type BlastSummaryResponse = z.infer<typeof BlastSummaryResponse>;
