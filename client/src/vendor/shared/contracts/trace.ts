import { z } from 'zod';

/**
 * Run trace. The ENTIRE trace of one run is persisted as a SINGLE
 * jsonb document in `run_traces` (not per-row). Live events stream via SSE
 * during the run; the full log is written once on completion.
 */

export const RunEventKind = z.enum(['info', 'tool', 'result', 'error']);
export type RunEventKind = z.infer<typeof RunEventKind>;

/** A single live-log line. `t` = elapsed timestamp string (e.g. "00.31"). */
export const RunLogLine = z.object({
  t: z.string(),
  kind: RunEventKind,
  msg: z.string(),
});
export type RunLogLine = z.infer<typeof RunLogLine>;

/** SSE payload streamed on `/runs/:id/events`. */
export const RunEvent = z.object({
  runId: z.string(),
  seq: z.number().int(),
  kind: RunEventKind,
  msg: z.string(),
  t: z.string(),
  data: z.unknown().optional(),
});
export type RunEvent = z.infer<typeof RunEvent>;

export const ToolCall = z.object({
  tool: z.string(),
  args: z.string(),
  meta: z.string().nullish(),
  ms: z.number().int(),
});
export type ToolCall = z.infer<typeof ToolCall>;

export const PromptAssembly = z.object({
  system: z.string(),
  skills: z.string().nullish(),
  memory: z.string().nullish(),
  specs: z.string().nullish(),
  /** Callers-of-changed-symbols digest (repo-intel); null when absent. */
  callers: z.string().nullish(),
  /** Repo skeleton / map (repo-intel); null when absent. Enables per-slot token
      attribution in the run trace. */
  repo_map: z.string().nullish(),
  /** PR author's description/body (truncated); null when absent. */
  pr_description: z.string().nullish(),
  /** Derived intent + scope (truncated); null when absent. */
  intent: z.string().nullish(),
  user: z.string(),
});
export type PromptAssembly = z.infer<typeof PromptAssembly>;

/**
 * One prompt section, described WITHOUT its content.
 *
 * PromptAssembly above holds the full text of every section, which is why it is
 * unreadable as an operational signal and unsafe to ship anywhere. This is the
 * metadata-only view of the same thing: what went into a prompt, and how big
 * each part was. Nothing here is derived from what a section SAYS.
 */
export const PromptSectionLog = z.object({
  section: z.string(), // 'system' | 'pr_description' | 'intent' | 'skills' | ...
  source: z.enum(['agent', 'pr', 'derived', 'repo-intel', 'db', 'clone', 'diff']),
  /** Length in CODE POINTS (`[...text].length`), not UTF-16 units. */
  chars: z.number().int(),
  /** Cheap local estimate, never a tokenizer call. See reviewer-core/src/prompt.ts. */
  tokens_approx: z.number().int(),
  /** Whether this section's cap actually FIRED — not whether one exists. */
  truncated: z.boolean(),
  /** First 12 hex of sha256(content). Verbose mode only; null otherwise. */
  digest: z.string().nullable(),
});
export type PromptSectionLog = z.infer<typeof PromptSectionLog>;

/** Metadata-only description of one assembled prompt. Carries no content. */
export const PromptAssemblyLog = z.object({
  correlation_id: z.string(),
  provider: z.string().nullable(),
  model: z.string(),
  sections: z.array(PromptSectionLog),
  /**
   * Size of the sections the prompt is assembled from. Verbose mode appends
   * breakdown entries (`diff:<path>`) that detail a section already counted
   * here, so the totals stay comparable between a verbose and a quiet run.
   */
  total_chars: z.number().int(),
  total_tokens_approx: z.number().int(),
});
export type PromptAssemblyLog = z.infer<typeof PromptAssemblyLog>;

export const MemoryPulled = z.object({
  pr: z.number().int().nullish(),
  text: z.string(),
});
export type MemoryPulled = z.infer<typeof MemoryPulled>;

export const RunStats = z.object({
  duration_ms: z.number().int(),
  tokens_in: z.number().int(),
  tokens_out: z.number().int(),
  /** USD cost of the run; null = unknown (unpriced model / no LLM call). */
  cost_usd: z.number().nullable(),
  findings: z.number().int(),
  grounding: z.string(),
});
export type RunStats = z.infer<typeof RunStats>;

/** The single-document trace stored in `run_traces.trace`. */
export const RunTrace = z.object({
  config: z.object({
    agent: z.string(),
    version: z.string().nullish(),
    provider: z.string().nullish(),
    model: z.string(),
    pr: z.number().int().nullish(),
    source: z.enum(['local', 'ci']).default('local'),
  }),
  stats: RunStats,
  prompt_assembly: PromptAssembly,
  tool_calls: z.array(ToolCall),
  raw_output: z.string(),
  memory_pulled: z.array(MemoryPulled),
  specs_read: z.array(z.string()),
  log: z.array(RunLogLine),
});
export type RunTrace = z.infer<typeof RunTrace>;

/**
 * One row of a PR's run history (every agent_runs row, any status). Surfaced on
 * the PR page so runs — including FAILED ones with their error — survive reload.
 */
export const RunSummary = z.object({
  run_id: z.string(),
  agent_id: z.string().nullable(),
  agent_name: z.string().nullable(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  status: z.string().nullable(), // running | done | failed | cancelled
  error: z.string().nullable(),
  duration_ms: z.number().int().nullable(),
  tokens_in: z.number().int().nullable(),
  tokens_out: z.number().int().nullable(),
  /** USD cost of the run; null = unknown (unpriced model / no LLM call). */
  cost_usd: z.number().nullable(),
  findings_count: z.number().int().nullable(),
  grounding: z.string().nullable(),
  ran_at: z.string().nullable(),
  // Review outcome, denormalized onto the run row at completion (the timeline
  // has no FK to the review). score = the review's 0-100 score; blockers =
  // findings that trip the agent's gate. Null on failed/cancelled runs.
  score: z.number().int().nullable(),
  blockers: z.number().int().nullable(),
});
export type RunSummary = z.infer<typeof RunSummary>;
