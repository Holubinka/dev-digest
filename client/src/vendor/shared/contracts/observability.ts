import { z } from 'zod';
import { Severity } from './findings.js';
import { FindingRecord, ReviewRunTarget } from './review-api.js';

/**
 * A5 — Observability / Multi-agent contracts (L07).
 *
 * These sit alongside A2's `review-api.ts`. The multi-agent half is the wire
 * shape of six routes, and nothing else serves these schemas:
 *
 *   POST /pulls/:id/multi-agent-run     MultiAgentRunRequest → MultiAgentRunCreated
 *   POST /multi-agent-runs/:id/rerun    no body              → MultiAgentRunCreated
 *   GET  /multi-agent-runs/:id                               → MultiAgentRun
 *   GET  /pulls/:id/multi-agent                              → MultiAgentRunRef | null
 *   GET  /repos/:id/multi-agent-runs/latest                  → MultiAgentRunRef | null
 *   GET  /runs/last-successful                               → LastSuccessfulRun[]
 *
 * Two claims this header used to make are gone because neither survived
 * SPEC-05: `MultiAgentRun` is NOT what the create answers (that is
 * `MultiAgentRunCreated`, which carries the run targets to subscribe to), and
 * it is NOT what `GET /pulls/:id/multi-agent` answers either. That read is a
 * deliberate narrowing to `MultiAgentRunRef`: the PR page renders one anchor
 * from it, and answering with a whole `MultiAgentRun` would make every PR page
 * load pull up to 500 findings with their rationales to draw a link.
 *
 * The other two shapes here — `AgentStats` and `CuratorResult` — are unrelated
 * and untouched by SPEC-05.
 *
 * The single-document run trace itself stays in `contracts/trace.ts` (RunTrace).
 */

// ---------------------------------------------------------------------------
// Multi-Agent Review
// ---------------------------------------------------------------------------

/**
 * A finding as a multi-agent column carries it — the WHOLE record, not a subset.
 *
 * An alias rather than a narrowing, because the results page draws everything
 * `FindingRecord` holds: the line range, confidence, rationale and suggested fix
 * in the expanded detail (AC-57, AC-58), and `accepted_at` / `dismissed_at` so
 * the Accept and Dismiss buttons show their state on FIRST paint (AC-63) instead
 * of after a round-trip. A second shape carrying the same fields is a shape that
 * drifts from this one the next time a field is added to a finding.
 */
export const AgentColumnFinding = FindingRecord;
export type AgentColumnFinding = z.infer<typeof AgentColumnFinding>;

/**
 * The live state of one agent's run inside a multi-run.
 *
 * `queued` is here because a bounded fan-out has runs that exist but have not
 * started (AC-33, AC-34), and `cancelled` because a cancelled run must be
 * distinguishable from a failed one on screen (AC-39).
 */
export const AgentColumnStatus = z.enum(['queued', 'running', 'done', 'failed', 'cancelled']);
export type AgentColumnStatus = z.infer<typeof AgentColumnStatus>;

/** One agent's result column in the multi-agent review. */
export const AgentColumn = z.object({
  run_id: z.string(),
  /** Null once the agent is deleted — `agent_runs.agent_id` is ON DELETE SET NULL. */
  agent_id: z.string().nullable(),
  /** Snapshot taken when the multi-run was created, so a deleted agent keeps its name (AC-118). */
  agent_name: z.string(),
  /** The agent no longer exists in the workspace; the column still names it (AC-118). */
  agent_deleted: z.boolean(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  status: AgentColumnStatus,
  /** Why the run failed (AC-36) — the reason the column header shows. Null unless it did. */
  error: z.string().nullable(),
  verdict: z.string().nullable(),
  score: z.number().int().nullable(),
  summary: z.string().nullable(),
  duration_ms: z.number().int().nullable(),
  cost_usd: z.number().nullable(),
  findings: z.array(AgentColumnFinding),
});
export type AgentColumn = z.infer<typeof AgentColumn>;

/**
 * What one agent has to say about one contended position — THREE values, not six.
 *
 *   Severity       the agent flagged it, at that severity
 *   'ignored'      the agent's run reached `done` and it did not flag: it looked and passed
 *   'not_reviewed' the run is not `done`, so this agent was never there and has no opinion
 *
 * The last two are a real distinction and the field name is chosen to carry it:
 * silence from an agent that finished is evidence, silence from an agent that
 * failed is nothing at all (AC-119, AC-120, SPEC-05 § D22).
 *
 * `not_reviewed` is deliberately ONE value and not four — `failed`, `cancelled`,
 * `running`, `queued` are NOT verdicts. The run's state already sits in
 * `AgentColumn.status` in this same response body, and duplicating it inside the
 * take would give the screen two sources that can disagree: a section reading
 * "reviewing" beside a column reading "run failed" is a defect the reader can
 * see. The take says THAT there is no opinion; the column says WHY (§ D22).
 */
export const ConflictVerdict = z.union([
  Severity,
  z.literal('ignored'),
  z.literal('not_reviewed'),
]);
export type ConflictVerdict = z.infer<typeof ConflictVerdict>;

/** One agent's stance on a contended position. */
export const ConflictTake = z.object({
  /**
   * The run this take speaks for. It is what joins the take to its column, and
   * it exists because `agent_id` cannot do that job: it is null after the agent
   * is deleted (AC-118), so two deleted agents would give two takes the same
   * key. AC-125 requires the take's caption and that run's column header to name
   * the run state with the same word, which needs an exact join, not a usual one.
   */
  run_id: z.string(),
  agent_id: z.string().nullable(),
  persona: z.string(),
  verdict: ConflictVerdict,
  /**
   * Taken from the flagging finding's rationale. Null on `ignored` (there is
   * nothing to quote) and on `not_reviewed`, where AC-122 forbids a note
   * outright — the system's own words do not belong in the field reserved for
   * the agent's reasoning.
   */
  note: z.string().nullable(),
});
export type ConflictTake = z.infer<typeof ConflictTake>;

/**
 * A cross-agent POSITION: one file and one line range that at least one agent's
 * finding lands on, with one take per agent of the multi-run.
 *
 * Whether it is a CONFLICT is a question asked of the takes (AC-126), not a
 * property stored here — the section renders every position with the toggle off
 * and only the conflicting ones with it on. Computed from persisted findings on
 * every read and never stored (AC-97).
 */
export const Conflict = z.object({
  file: z.string(),
  /** The range, because findings have ranges. A single-line one is rendered `file:12`. */
  start_line: z.number().int(),
  end_line: z.number().int(),
  title: z.string(),
  takes: z.array(ConflictTake),
});
export type Conflict = z.infer<typeof Conflict>;

/** Response of GET /multi-agent-runs/:id — everything both modes and the detail draw (AC-98). */
export const MultiAgentRun = z.object({
  id: z.string(),
  pr_id: z.string(),
  pr_number: z.number().int().nullish(),
  pr_title: z.string().nullable(),
  /** The PR head the comparison was produced against, so a moved line can be warned about (AC-109). */
  head_sha: z.string().nullable(),
  ran_at: z.string(),
  agent_count: z.number().int(),
  /**
   * How many of those agents ran at once. The meta row's "how it was executed"
   * line is written from this number (AC-40) rather than from the word
   * "parallel", which is what keeps the copy honest when the ceiling changes.
   */
  concurrency: z.number().int(),
  /**
   * The MULTI-RUN's own span, in milliseconds — never derived from the runs'
   * `duration_ms` (AC-41, D28).
   *
   * It is measured from `ran_at`, so it contains what the individual runs cannot
   * show: the wait between waves, the shared pre-work, scheduler pauses. Five
   * agents at a ceiling of three measured 3.4/3.8/3.3/3.7/5.1 s per run and
   * ≈ 8.9 s of wall clock; the old "max over the runs" reported 5.1 s.
   *
   * `null` only in the `interrupted` case below — read
   * `total_duration_kind` before printing this.
   */
  total_duration_ms: z.number().int().nullable(),
  /**
   * WHAT the number above is, because the three cases must not share a caption.
   *
   *   `measured`     the multi-run finished; span from start to last terminal run
   *   `elapsed`      a run is still going, so this is time gone SO FAR (AC-156) —
   *                  "total" would assert a state that has not happened yet
   *   `interrupted`  every run is terminal but no completion was ever recorded, so
   *                  the reaper ended them after a restart (AC-158). The span from
   *                  `ran_at` would measure the downtime, not the work, so there is
   *                  no number at all and the row says so.
   */
  total_duration_kind: z.enum(['measured', 'elapsed', 'interrupted']),
  /** Sum of the runs' `cost_usd` — a sum, unlike the duration above (AC-160). */
  total_cost_usd: z.number().nullable(),
  /** At least one run's `cost_usd` is null, so the total is a floor, not a total (AC-42). */
  total_cost_partial: z.boolean(),
  columns: z.array(AgentColumn),
  conflicts: z.array(Conflict),
});
export type MultiAgentRun = z.infer<typeof MultiAgentRun>;

/** Response of POST /pulls/:id/multi-agent-run and POST /multi-agent-runs/:id/rerun. */
export const MultiAgentRunCreated = z.object({
  id: z.string(),
  pr_id: z.string(),
  runs: z.array(ReviewRunTarget),
  /**
   * Agents the request asked for that no longer exist, named so the user is told
   * rather than left counting columns (AC-117). Always present; empty on a plain
   * create, where an unknown agent id is a refusal instead (AC-28).
   */
  skipped: z.array(z.object({ agent_id: z.string(), agent_name: z.string() })),
});
export type MultiAgentRunCreated = z.infer<typeof MultiAgentRunCreated>;

/**
 * Enough to LINK to a multi-run, and deliberately not enough to draw one.
 * Served by both `GET /pulls/:id/multi-agent` and
 * `GET /repos/:id/multi-agent-runs/latest`, which answer `null` when there is
 * none — an absence, not an error.
 */
export const MultiAgentRunRef = z.object({
  id: z.string(),
  pr_id: z.string(),
  pr_number: z.number().int().nullish(),
  ran_at: z.string(),
});
export type MultiAgentRunRef = z.infer<typeof MultiAgentRunRef>;

/**
 * One agent's last run that reached `done`, for the pre-run estimate (AC-17…AC-23).
 *
 * Every field is nullable and an agent with no successful run is simply absent
 * from the array: `—` and "not counted" is one case, and a zero that means "no
 * data" is exactly what AC-23 forbids the screen to print.
 */
export const LastSuccessfulRun = z.object({
  agent_id: z.string(),
  duration_ms: z.number().int().nullable(),
  cost_usd: z.number().nullable(),
  ran_at: z.string().nullable(),
});
export type LastSuccessfulRun = z.infer<typeof LastSuccessfulRun>;

// ---------------------------------------------------------------------------
// Per-agent Stats (GET /agents/:id/stats)
// ---------------------------------------------------------------------------

/** A single (date, value) point for a sparkline/trend. */
export const StatPoint = z.object({ label: z.string(), value: z.number() });
export type StatPoint = z.infer<typeof StatPoint>;

export const AgentStats = z.object({
  agent_id: z.string(),
  agent_name: z.string(),
  runs: z.number().int(),
  findings_total: z.number().int(),
  /** accept-rate is the headline quality signal. 0..1 over acted findings. */
  accepted: z.number().int(),
  dismissed: z.number().int(),
  pending: z.number().int(),
  accept_rate: z.number().nullable(),
  dismiss_rate: z.number().nullable(),
  avg_findings_per_run: z.number().nullable(),
  total_cost_usd: z.number().nullable(),
  avg_cost_usd: z.number().nullable(),
  avg_latency_ms: z.number().nullable(),
  findings_by_severity: z.object({
    CRITICAL: z.number().int(),
    WARNING: z.number().int(),
    SUGGESTION: z.number().int(),
  }),
  /** recent runs for a small trend chart (oldest→newest). */
  trend: z.array(StatPoint),
});
export type AgentStats = z.infer<typeof AgentStats>;

// ---------------------------------------------------------------------------
// Cross-session memory curator
// ---------------------------------------------------------------------------

/** A merge the curator performed (or would perform in dry-run). */
export const CuratorMerge = z.object({
  kept_id: z.string(),
  merged_ids: z.array(z.string()),
  content: z.string(),
  similarity: z.number(),
});
export type CuratorMerge = z.infer<typeof CuratorMerge>;

export const CuratorResult = z.object({
  scanned: z.number().int(),
  merges: z.array(CuratorMerge),
  removed: z.number().int(),
  dry_run: z.boolean(),
});
export type CuratorResult = z.infer<typeof CuratorResult>;
