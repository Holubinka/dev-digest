import { z } from 'zod';
import { Severity } from './findings.js';

/**
 * A6 — Productionize contracts (L08).
 *
 * NEW file (A6 owns it; the barrel re-exports it). Covers:
 *   - PluginBundle / InstalledPlugin   POST /plugins/export, /plugins/import, GET /plugins
 *   - AgentPerf / AgentPerfRow         GET /agents/performance
 *   - AgentPerfDetail                  GET /agents/:id/stats
 *   - Digest / DigestSettings          Weekly Digest (settings + cron-built rows)
 *
 * Nothing here mutates an existing contract — these sit alongside A2's
 * `review-api.ts` and A5's `observability.ts`.
 */

// ---------------------------------------------------------------------------
// Plugin export / import  (.devdigest-plugin/ bundle)
// ---------------------------------------------------------------------------

/** An exported skill (config only — no DB ids; round-trippable). */
export const PluginSkill = z.object({
  name: z.string(),
  description: z.string(),
  type: z.enum(['rubric', 'convention', 'security', 'custom']),
  source: z.enum(['manual', 'imported_url', 'extracted', 'community']),
  body: z.string(),
  enabled: z.boolean(),
  evidence_files: z.array(z.string()).nullish(),
});
export type PluginSkill = z.infer<typeof PluginSkill>;

/** An exported agent. `skills` references PluginSkill.name within the bundle. */
export const PluginAgent = z.object({
  name: z.string(),
  description: z.string(),
  provider: z.enum(['openai', 'anthropic', 'openrouter']),
  model: z.string(),
  system_prompt: z.string(),
  output_schema: z.unknown().nullish(),
  enabled: z.boolean(),
  /** Names of skills (in this bundle) linked to the agent, in order. */
  skills: z.array(z.string()),
});
export type PluginAgent = z.infer<typeof PluginAgent>;

/** An exported eval case. `owner_ref` ties it to an agent or skill by name. */
export const PluginEvalCase = z.object({
  name: z.string(),
  owner_kind: z.enum(['skill', 'agent']),
  owner_ref: z.string(),
  input_diff: z.string().nullish(),
  input_files: z.unknown().nullish(),
  input_meta: z.unknown().nullish(),
  expected_output: z.unknown().nullish(),
  notes: z.string().nullish(),
});
export type PluginEvalCase = z.infer<typeof PluginEvalCase>;

/** An exported convention (house-rule). */
export const PluginConvention = z.object({
  rule: z.string(),
  evidence_path: z.string().nullish(),
  evidence_snippet: z.string().nullish(),
  confidence: z.number().nullish(),
  accepted: z.boolean(),
});
export type PluginConvention = z.infer<typeof PluginConvention>;

export const PluginManifest = z.object({
  name: z.string(),
  version: z.string(),
  format: z.literal('devdigest-plugin/v1'),
  exported_at: z.string(),
  description: z.string().nullish(),
  counts: z.object({
    agents: z.number().int(),
    skills: z.number().int(),
    eval_cases: z.number().int(),
    conventions: z.number().int(),
  }),
});
export type PluginManifest = z.infer<typeof PluginManifest>;

/** The whole `.devdigest-plugin/` bundle as one JSON document. */
export const PluginBundle = z.object({
  manifest: PluginManifest,
  agents: z.array(PluginAgent),
  skills: z.array(PluginSkill),
  eval_cases: z.array(PluginEvalCase),
  conventions: z.array(PluginConvention),
});
export type PluginBundle = z.infer<typeof PluginBundle>;

/** Request body for POST /plugins/export. */
export const PluginExportRequest = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  /** Limit export to a subset of agent ids (default: all). */
  agent_ids: z.array(z.string()).optional(),
});
export type PluginExportRequest = z.infer<typeof PluginExportRequest>;

/** Request body for POST /plugins/import. */
export const PluginImportRequest = z.object({
  bundle: PluginBundle,
  /** 'merge' keeps existing items; 'replace' is reserved (merge is the default). */
  mode: z.enum(['merge', 'replace']).default('merge').optional(),
});
export type PluginImportRequest = z.infer<typeof PluginImportRequest>;

/** A row in `installed_plugins` (GET /plugins). */
export const InstalledPlugin = z.object({
  id: z.string(),
  name: z.string(),
  version: z.string().nullable(),
  source: z.string().nullable(),
  installed_at: z.string(),
  enabled: z.boolean(),
});
export type InstalledPlugin = z.infer<typeof InstalledPlugin>;

/** Result of an import: what was created + the installed_plugins row. */
export const PluginImportResult = z.object({
  installed: InstalledPlugin,
  created: z.object({
    agents: z.number().int(),
    skills: z.number().int(),
    eval_cases: z.number().int(),
    conventions: z.number().int(),
  }),
});
export type PluginImportResult = z.infer<typeof PluginImportResult>;

// ---------------------------------------------------------------------------
// Agent Performance  (GET /agents/performance · GET /agents/:id/stats)
// ---------------------------------------------------------------------------

/**
 * The runs a performance read counts: the TERMINAL ones.
 *
 * `queued` and `running` are excluded because their numbers do not exist yet —
 * no cost, no duration, no findings — and counting a run whose figures are still
 * being written makes every average on the screen move without anything having
 * happened. `failed` IS counted: a failed run can still have burned tokens, and
 * a total that drops it is smaller than what was actually spent (SPEC-07 § D3, D4).
 */
export const PERF_COUNTED_RUN_STATUSES = ['done', 'failed', 'cancelled'] as const;

/** Which window the screen is showing. `custom` carries its own bounds. */
export const PerfRange = z.enum(['1d', '30d', 'custom']);
export type PerfRange = z.infer<typeof PerfRange>;

/**
 * The window that was actually aggregated, echoed back.
 *
 * The screen labels two tiles and a column with the period, so the label has to
 * come from the same answer as the numbers — a client that formats its own
 * caption from its own state will keep the old one on screen for as long as the
 * next request is in flight (AC-9).
 *
 * Half-open `[from, to)`: a run at exactly `to` belongs to the next window, so
 * two adjacent windows can never both count it (AC-7).
 */
export const PerfPeriod = z.object({
  kind: PerfRange,
  from: z.string(),
  to: z.string(),
});
export type PerfPeriod = z.infer<typeof PerfPeriod>;

/**
 * WHERE a cost figure came from.
 *
 * Today every DevDigest cost is `estimated`: `agent_runs.cost_usd` is written by
 * `estimateCost` / `PriceBook` from a per-model price table, and nothing in the
 * system reconciles it against a provider's billing API. `reconciled` and `mixed`
 * exist so that a screen reading this field never has to be rewritten to tell the
 * truth once such a source exists — they are NOT produced by any code path here,
 * and no number may be presented as reconciled until one is (AC-36, AC-37).
 */
export const PerfCostBasis = z.enum(['estimated', 'reconciled', 'mixed']);
export type PerfCostBasis = z.infer<typeof PerfCostBasis>;

/**
 * One bucket of the runs sparkline, oldest → newest.
 *
 * `at` is the bucket's START as an ISO instant, not a formatted caption: the
 * server does not know the reader's locale, and a caption built here would be the
 * one English string on a screen that gets its words from `next-intl`.
 */
export const PerfTrendPoint = z.object({
  at: z.string(),
  value: z.number().int(),
});
export type PerfTrendPoint = z.infer<typeof PerfTrendPoint>;

/**
 * One agent's numbers for one period.
 *
 * Every rate and average is nullable, and that is the contract's main job here:
 * an agent with no counted run in the window has no average cost, and `0` would
 * read as "this agent is free" rather than "nothing to average" (AC-23).
 */
export const AgentPerfRow = z.object({
  agent_id: z.string(),
  agent_name: z.string(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  /** Counted runs in the period (PERF_COUNTED_RUN_STATUSES). */
  runs: z.number().int(),
  /** Of those, how many carry a cost — the divisor behind `avg_cost_usd`. */
  runs_with_cost: z.number().int(),
  /** Of those, how many do not. `total_cost_usd` is a floor while this is > 0. */
  runs_without_cost: z.number().int(),
  findings_total: z.number().int(),
  accepted: z.number().int(),
  dismissed: z.number().int(),
  /** Neither accepted nor dismissed — outside the accept-rate denominator. */
  pending: z.number().int(),
  /**
   * `accepted + dismissed`: the accept-rate DENOMINATOR, and the reason it is a
   * field rather than a client-side sum. AC-17 and AC-24 require it beside every
   * percentage, and a percentage whose denominator is recomputed somewhere else
   * is a percentage that can disagree with itself.
   */
  judged: z.number().int(),
  accept_rate: z.number().nullable(),
  dismiss_rate: z.number().nullable(),
  /** `judged < min_decisions_for_rank` — the rate exists but does not rank (AC-29). */
  low_sample: z.boolean(),
  /**
   * The same rate over the window of equal length immediately before this one, so
   * the row can draw a direction. Null when that window judged nothing: no arrow
   * is the honest rendering of "there is nothing to compare with".
   */
  prev_accept_rate: z.number().nullable(),
  avg_findings_per_run: z.number().nullable(),
  total_cost_usd: z.number().nullable(),
  avg_cost_usd: z.number().nullable(),
  /**
   * Mean `duration_ms` over the counted runs that recorded one. Named for what it
   * measures — the previous name, `avg_latency_ms`, described a request.
   */
  avg_duration_ms: z.number().nullable(),
  last_run_at: z.string().nullable(),
  findings_by_severity: z.object({
    CRITICAL: z.number().int(),
    WARNING: z.number().int(),
    SUGGESTION: z.number().int(),
  }),
});
export type AgentPerfRow = z.infer<typeof AgentPerfRow>;

/** A donut segment. */
export const PerfCostSegment = z.object({
  label: z.string(),
  value: z.number(),
});
export type PerfCostSegment = z.infer<typeof PerfCostSegment>;

/**
 * A cost segment that names an agent.
 *
 * `agent_id` and not just the label, because an agent's colour is a function of
 * its immutable id (`client/src/lib/agent-color.ts`) and the donut has to paint
 * the same agent the same colour as the table row above it. Null on the bucket
 * for runs whose agent has been deleted — there is no id left to colour by.
 */
export const PerfAgentCostSegment = PerfCostSegment.extend({
  agent_id: z.string().nullable(),
});
export type PerfAgentCostSegment = z.infer<typeof PerfAgentCostSegment>;

export const AgentPerfSummary = z.object({
  /** Every counted run in the period, including those of deleted agents. */
  runs: z.number().int(),
  /**
   * Counted runs whose `agent_id` is null — the agent was deleted and
   * `agent_runs.agent_id` is ON DELETE SET NULL. They have no row in the table
   * (there is no name left), so without this number the table's runs would not
   * add up to the tile's and nothing on screen would say why (AC-34).
   */
  runs_without_agent: z.number().int(),
  total_cost_usd: z.number().nullable(),
  /** The same total over the preceding window of equal length; drives the delta. */
  prev_total_cost_usd: z.number().nullable(),
  runs_with_cost: z.number().int(),
  runs_without_cost: z.number().int(),
  accepted: z.number().int(),
  dismissed: z.number().int(),
  judged: z.number().int(),
  /**
   * POOLED — `accepted / judged` across the workspace, not the mean of the
   * per-agent rates. The mockup's tile is a mean; the criterion that the
   * denominator be shown is what settles it, because a mean of rates has no
   * denominator to show (SPEC-07 § D2).
   */
  avg_accept_rate: z.number().nullable(),
  /** Most counted runs in the period; ties go to the later last run, then the name. */
  most_active_agent: z
    .object({
      agent_id: z.string(),
      agent_name: z.string(),
      runs: z.number().int(),
      accept_rate: z.number().nullable(),
    })
    .nullable(),
  runs_trend: z.array(PerfTrendPoint),
});
export type AgentPerfSummary = z.infer<typeof AgentPerfSummary>;

/** Response of GET /agents/performance. */
export const AgentPerf = z.object({
  period: PerfPeriod,
  /**
   * The decision count below which an accept rate is marked as a small sample and
   * demoted when the table sorts by it. Served rather than hard-coded on both
   * sides, so the badge and the ordering can never disagree about the threshold
   * they are applying (AC-30).
   */
  min_decisions_for_rank: z.number().int(),
  cost_basis: PerfCostBasis,
  summary: AgentPerfSummary,
  /** Every agent in the workspace, including those with no run in the period. */
  agents: z.array(AgentPerfRow),
  /**
   * Cost split two ways. Each array sums to `summary.total_cost_usd` exactly —
   * both are partitions of the same set of costed runs (AC-32, AC-33).
   */
  cost_by_agent: z.array(PerfAgentCostSegment),
  cost_by_model: z.array(PerfCostSegment),
});
export type AgentPerf = z.infer<typeof AgentPerf>;

/**
 * Response of GET /agents/:id/stats — the agent editor's Stats tab.
 *
 * `agent` is an `AgentPerfRow`, the SAME shape the dashboard table renders, and
 * the server builds it with the same function over the same rule. That is what
 * makes "the tab agrees with the dashboard" a property of the construction
 * rather than of two implementations staying in step (AC-45, AC-46).
 */
export const AgentPerfDetail = z.object({
  period: PerfPeriod,
  min_decisions_for_rank: z.number().int(),
  cost_basis: PerfCostBasis,
  agent: AgentPerfRow,
  runs_trend: z.array(PerfTrendPoint),
});
export type AgentPerfDetail = z.infer<typeof AgentPerfDetail>;

// re-export Severity-adjacent helper to keep the import surface tidy
export { Severity };

// ---------------------------------------------------------------------------
// Weekly Digest
// ---------------------------------------------------------------------------

/** A persisted digest row (one period summary). */
export const Digest = z.object({
  id: z.string(),
  period_start: z.string().nullable(),
  period_end: z.string().nullable(),
  body_md: z.string().nullable(),
  delivered_to: z.string().nullable(),
});
export type Digest = z.infer<typeof Digest>;

/** Request body for POST /digest/run (build now). */
export const DigestRunRequest = z.object({
  /** ISO range; defaults to the last 7 days. */
  period_start: z.string().optional(),
  period_end: z.string().optional(),
});
export type DigestRunRequest = z.infer<typeof DigestRunRequest>;
