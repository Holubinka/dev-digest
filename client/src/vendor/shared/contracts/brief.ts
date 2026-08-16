import { z } from 'zod';
import { BlastIndexStatus } from './blast.js';

/**
 * PR Brief building blocks: Intent, Blast radius, Risks, PR History,
 * Smart Diff. Composed into PrBrief.
 */

// ---- Intent ----
/**
 * What the intent classifier returns. FLAT ON PURPOSE: four required fields, no
 * nesting, no unions, no optionals. Under OpenAI Structured Outputs' `strict`
 * mode a small model reaches 100% schema validity while semantic accuracy
 * drops as the schema gets more constrained, so every field earns its place.
 * This is the schema handed to `completeStructured` as `schemaName: 'Intent'`.
 */
export const Intent = z.object({
  intent: z.string(),
  in_scope: z.array(z.string()),
  out_of_scope: z.array(z.string()),
  risk_areas: z.array(z.string()),
});
export type Intent = z.infer<typeof Intent>;

/** Which evidence the derivation actually had. Drives `confidence` in code. */
export const IntentEvidenceSource = z.enum([
  'title',
  'body',
  'linked_issue',
  'plan_spec',
  'commits_files',
]);
export type IntentEvidenceSource = z.infer<typeof IntentEvidenceSource>;

/**
 * Confidence BAND, derived deterministically from which documentary sources were
 * present — never self-reported by the model. Small models pin verbal confidence
 * near-constant regardless of accuracy, so a number from one is not evidence.
 */
export const IntentConfidence = z.enum(['high', 'medium', 'low']);
export type IntentConfidence = z.infer<typeof IntentConfidence>;

/** The persisted / API shape: the model's answer plus everything we know about it. */
export const IntentRecord = Intent.extend({
  confidence: IntentConfidence,
  evidence: z.array(IntentEvidenceSource),
  /** Repo-relative paths of the plan/spec files that were read, if any. */
  plan_refs: z.array(z.string()),
  provider: z.string(),
  model: z.string(),
  computed_at: z.string(),
});
export type IntentRecord = z.infer<typeof IntentRecord>;

// ---- Blast radius ----
export const ChangedSymbol = z.object({
  name: z.string(),
  file: z.string(),
  kind: z.string(),
});
export type ChangedSymbol = z.infer<typeof ChangedSymbol>;

export const BlastCaller = z.object({
  name: z.string(),
  file: z.string(),
  line: z.number().int(),
});
export type BlastCaller = z.infer<typeof BlastCaller>;

export const DownstreamImpact = z.object({
  symbol: z.string(),
  callers: z.array(BlastCaller),
  endpoints_affected: z.array(z.string()),
  crons_affected: z.array(z.string()),
});
export type DownstreamImpact = z.infer<typeof DownstreamImpact>;

export const BlastRadius = z.object({
  changed_symbols: z.array(ChangedSymbol),
  downstream: z.array(DownstreamImpact),
  summary: z.string(),
});
export type BlastRadius = z.infer<typeof BlastRadius>;

// ---- Risks ----
export const RiskSeverity = z.enum(['high', 'medium', 'low']);
export type RiskSeverity = z.infer<typeof RiskSeverity>;

export const Risk = z.object({
  kind: z.string(),
  title: z.string(),
  explanation: z.string(),
  severity: RiskSeverity,
  file_refs: z.array(z.string()),
});
export type Risk = z.infer<typeof Risk>;

export const Risks = z.object({
  risks: z.array(Risk),
});
export type Risks = z.infer<typeof Risks>;

// ---- PR History ----
export const PrHistoryItem = z.object({
  pr_number: z.number().int(),
  title: z.string(),
  merged_at: z.string(),
  author: z.string(),
  files_overlap: z.array(z.string()),
  notes: z.string(),
});
export type PrHistoryItem = z.infer<typeof PrHistoryItem>;

export const PrHistory = z.object({
  history: z.array(PrHistoryItem),
});
export type PrHistory = z.infer<typeof PrHistory>;

// ---- Smart Diff ----
export const SmartDiffRole = z.enum(['core', 'wiring', 'boilerplate']);
export type SmartDiffRole = z.infer<typeof SmartDiffRole>;

export const SmartDiffFile = z.object({
  path: z.string(),
  pseudocode_summary: z.string().nullish(),
  additions: z.number().int(),
  deletions: z.number().int(),
  finding_lines: z.array(z.number().int()),
});
export type SmartDiffFile = z.infer<typeof SmartDiffFile>;

export const SmartDiffGroup = z.object({
  role: SmartDiffRole,
  files: z.array(SmartDiffFile),
});
export type SmartDiffGroup = z.infer<typeof SmartDiffGroup>;

export const ProposedSplit = z.object({
  name: z.string(),
  files: z.array(z.string()),
});
export type ProposedSplit = z.infer<typeof ProposedSplit>;

export const SmartDiff = z.object({
  groups: z.array(SmartDiffGroup),
  split_suggestion: z.object({
    too_big: z.boolean(),
    total_lines: z.number().int(),
    proposed_splits: z.array(ProposedSplit),
  }),
});
export type SmartDiff = z.infer<typeof SmartDiff>;

// ---- Composed PR Brief (pr_brief.json) ----
export const PrBrief = z.object({
  intent: Intent,
  blast: BlastRadius,
  risks: Risks,
  history: PrHistory,
});
export type PrBrief = z.infer<typeof PrBrief>;

// ---- Risk Brief (PR Why + Risk Brief, `pr_brief` rows keyed by head_sha) ----
/**
 * Risk Brief — the per-state answer served by `GET/POST /pulls/:id/brief`.
 *
 * RELATIONSHIP TO `PrBrief` ABOVE
 * -------------------------------
 * `PrBrief` is the four-part composition of four *separate* derivations (intent,
 * blast, risks, history), each produced by its own call. `RiskBrief` is one flat
 * answer from ONE `completeStructured` call, and it is a different thing in three
 * ways:
 *
 *  - It is keyed to a `head_sha`. `PrBrief` has no notion of which state of the PR
 *    it describes; a Risk Brief without that key cannot be cached, and cannot say
 *    whether the risks it lists were measured against the code being read.
 *  - It carries `what` / `why` in prose, and a `review_focus` list — where to look
 *    first — which `PrBrief` has no field for.
 *  - It discloses its own provenance: which inputs went in, which were truncated or
 *    dropped, which counter measured them, how stale the intent was. `PrBrief` says
 *    nothing about how it was built.
 *
 * `PrBrief` is untouched by this contract and keeps its zero readers and writers.
 * The severity vocabulary is shared on purpose: `RiskSeverity` and `Risk` above are
 * reused rather than redefined, so a `high` means the same thing on both paths.
 */

/** What a review-focus item points at. `endpoint` is a blast endpoint label, not a path. */
export const ReviewFocusKind = z.enum(['file', 'endpoint']);
export type ReviewFocusKind = z.infer<typeof ReviewFocusKind>;

export const ReviewFocusItem = z.object({
  ref: z.string(),
  kind: ReviewFocusKind,
  reason: z.string(),
});
export type ReviewFocusItem = z.infer<typeof ReviewFocusItem>;

/**
 * The FLAT schema the model fills. `schemaName: 'RiskBrief'`. Flat for the same
 * reason `Intent` above is: under Structured Outputs' `strict` mode a small model
 * holds 100% schema validity while semantic accuracy falls as the schema gains
 * nesting, unions and optionals, so every field here earns its place.
 */
export const RiskBrief = z.object({
  what: z.string(),
  why: z.string(),
  risk_level: RiskSeverity,
  risks: z.array(Risk),
  review_focus: z.array(ReviewFocusItem),
});
export type RiskBrief = z.infer<typeof RiskBrief>;

/** The six candidate inputs, in the order the budget walk considers them. */
export const RiskBriefInputId = z.enum([
  'diff_stats',
  'intent',
  'blast',
  'pr_text',
  'linked_issue',
  'specs',
]);
export type RiskBriefInputId = z.infer<typeof RiskBriefInputId>;

/** What became of one input. `missing` is "there was none", `dropped` is "there was, and it did not fit". */
export const RiskBriefInputStatus = z.enum(['included', 'truncated', 'dropped', 'missing']);
export type RiskBriefInputStatus = z.infer<typeof RiskBriefInputStatus>;

export const RiskBriefInput = z.object({
  id: RiskBriefInputId,
  status: RiskBriefInputStatus,
  tokens: z.number().int(),
  /** What it was, in one line — spec paths, the blast status, why it is missing. */
  detail: z.string().nullable(),
});
export type RiskBriefInput = z.infer<typeof RiskBriefInput>;

/** Which counter answered. `heuristic` means ceil(chars/4), not the encoder. */
export const RiskBriefTokenizer = z.enum(['cl100k_base', 'heuristic']);
export type RiskBriefTokenizer = z.infer<typeof RiskBriefTokenizer>;

/**
 * THREE-VALUED on purpose (R25). `unknown` is what an absent `pr_commits` row for the head
 * sha produces, and what "no intent at all" produces. A boolean would spell that `false`,
 * i.e. "not stale" — a confidence the system does not have, in the one field whose whole job
 * is disclosing staleness.
 */
export const IntentFreshness = z.enum(['fresh', 'stale', 'unknown']);
export type IntentFreshness = z.infer<typeof IntentFreshness>;

/** The persisted / API shape: the model's answer plus everything we know about how it was built. */
export const RiskBriefRecord = RiskBrief.extend({
  head_sha: z.string(),
  intent_computed_at: z.string().nullable(),
  intent_freshness: IntentFreshness,
  blast_status: BlastIndexStatus,
  link_sha: z.string().nullable(),
  index_matches_head: z.boolean(),
  inputs: z.array(RiskBriefInput),
  dropped_refs: z.array(z.string()),
  dropped_risks: z.number().int(),
  budget: z.number().int(),
  input_tokens_counted: z.number().int(),
  tokenizer: RiskBriefTokenizer,
  attempts: z.number().int(),
  tokens_in: z.number().int(),
  provider: z.string(),
  model: z.string(),
  cost_usd: z.number().nullable(),
  computed_at: z.string(),
});
export type RiskBriefRecord = z.infer<typeof RiskBriefRecord>;

export const RiskBriefTimelineEntry = z.object({
  head_sha: z.string(),
  what: z.string(),
  risk_level: RiskSeverity,
  computed_at: z.string(),
  /** False when this sha is no longer among the PR's commits (force-push, rebase). */
  on_branch: z.boolean(),
  /** True when this entry's level differs from the entry before it. False on the first. */
  level_changed: z.boolean(),
});
export type RiskBriefTimelineEntry = z.infer<typeof RiskBriefTimelineEntry>;

export const RiskBriefTimeline = z.object({
  /** Oldest first. */
  entries: z.array(RiskBriefTimelineEntry),
  commits_without_brief: z.number().int(),
  /**
   * How many states were ACTUALLY evicted for this PR — carried on the rows by
   * `pr_brief.evicted_count`, never inferred from `entries.length` (R39). A PR sitting at
   * exactly `max_states` has evicted nothing, and telling its reader that history was lost
   * is a false disclosure, which is worse than none. The client derives "truncated" as
   * `evicted > 0`; there is no second field saying the same thing.
   */
  evicted: z.number().int(),
  max_states: z.number().int(),
});
export type RiskBriefTimeline = z.infer<typeof RiskBriefTimeline>;
