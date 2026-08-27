import { z } from 'zod';
import { Verdict, Finding } from './findings.js';
import { EvalRun, EvalOwnerKind, Conformance, Provider, CiFailOn } from './knowledge.js';

/**
 * A4 — Eval / CI / Compose / Conformance API contracts (L06).
 *
 * These EXTEND the barrel; they do not modify existing contract files. The base
 * `EvalRun`, `EvalCase`, `EvalOwnerKind`, `Conformance` live in `knowledge.ts`;
 * here we add the *API-facing* request/response shapes (records persisted in
 * `eval_runs`, `composed_reviews`, `ci_installations`, `ci_runs`,
 * `conformance_checks`) plus the eval-dashboard aggregate.
 */

// ===========================================================================
// Eval — case input + persisted run record + dashboard
// ===========================================================================

/** Create/update payload for an eval case (id + owner resolved by the route). */
export const EvalCaseInput = z.object({
  owner_kind: EvalOwnerKind,
  owner_id: z.string(),
  name: z.string().min(1),
  input_diff: z.string().default(''),
  input_files: z.unknown().nullish(),
  input_meta: z.unknown().nullish(),
  expected_output: z.unknown(),
  notes: z.string().nullish(),
});
export type EvalCaseInput = z.infer<typeof EvalCaseInput>;

/** A persisted eval run row (one execution of a case), returned by the API. */
export const EvalRunRecord = z.object({
  id: z.string(),
  case_id: z.string(),
  case_name: z.string().nullish(),
  ran_at: z.string(),
  actual_output: z.unknown(),
  pass: z.boolean().nullable(),
  recall: z.number().nullable(),
  precision: z.number().nullable(),
  citation_accuracy: z.number().nullable(),
  duration_ms: z.number().int().nullable(),
  cost_usd: z.number().nullable(),
});
export type EvalRunRecord = z.infer<typeof EvalRunRecord>;

/** Result of running a single case: the metrics (EvalRun) + the persisted row id. */
export const EvalRunResult = z.object({
  run_id: z.string(),
  case_id: z.string(),
  result: EvalRun,
});
export type EvalRunResult = z.infer<typeof EvalRunResult>;

/** One point on the dashboard trend (per run, chronological). */
export const EvalTrendPoint = z.object({
  ran_at: z.string(),
  recall: z.number(),
  precision: z.number(),
  citation_accuracy: z.number(),
  pass_rate: z.number(),
  cost_usd: z.number().nullable(),
});
export type EvalTrendPoint = z.infer<typeof EvalTrendPoint>;

/** Aggregate dashboard for an owner (agent/skill) or the whole workspace. */
export const EvalDashboard = z.object({
  owner_kind: EvalOwnerKind.nullable(),
  owner_id: z.string().nullable(),
  cases_total: z.number().int(),
  current: z.object({
    recall: z.number(),
    precision: z.number(),
    citation_accuracy: z.number(),
    traces_passed: z.number().int(),
    traces_total: z.number().int(),
    cost_usd: z.number().nullable(),
  }),
  delta: z.object({
    recall: z.number(),
    precision: z.number(),
    citation_accuracy: z.number(),
  }),
  trend: z.array(EvalTrendPoint),
  recent_runs: z.array(EvalRunRecord),
  alert: z.string().nullable(),
});
export type EvalDashboard = z.infer<typeof EvalDashboard>;

// ===========================================================================
// Compose Review
// ===========================================================================

export const ComposeReviewInput = z.object({
  /** Finding ids to fold into the draft (optional — body may be hand-written). */
  finding_ids: z.array(z.string()).default([]),
  /** Editable markdown body. If omitted, the server composes one from findings. */
  body: z.string().nullish(),
  verdict: Verdict.default('comment'),
  /** When true, attach selected findings as inline comments (path+line+body). */
  inline_comments: z.boolean().default(false),
});
export type ComposeReviewInput = z.infer<typeof ComposeReviewInput>;
/** Caller-facing input type — `.default()` fields stay optional (web hooks). */
export type ComposeReviewInputBody = z.input<typeof ComposeReviewInput>;

/** A persisted composed review (mirrors the `composed_reviews` row). */
export const ComposedReview = z.object({
  id: z.string(),
  pr_id: z.string(),
  body: z.string(),
  verdict: Verdict.nullable(),
  posted_at: z.string().nullable(),
  github_review_id: z.string().nullable(),
});
export type ComposedReview = z.infer<typeof ComposedReview>;

/** A preview (no GitHub side-effect) of what would be posted. */
export const ComposeReviewPreview = z.object({
  body: z.string(),
  verdict: Verdict,
  inline_comments: z.array(
    z.object({ path: z.string(), line: z.number().int(), body: z.string() }),
  ),
});
export type ComposeReviewPreview = z.infer<typeof ComposeReviewPreview>;

// ===========================================================================
// Export-to-CI + CI Runs
// ===========================================================================

export const CiTarget = z.enum(['gha', 'circle', 'jenkins', 'cli']);
export type CiTarget = z.infer<typeof CiTarget>;

/**
 * WHAT a file in the bundle IS, independently of where it was written.
 *
 * The path stopped being an identity the moment it became per-agent (AC-135):
 * `.github/workflows/devdigest-review-<slug>.yml` cannot be compared against a
 * constant, and the wizard needs to find the workflow in order to open the
 * Preview on it (AC-20) and to send the hand edit back (AC-31). Every consumer
 * that used to match on a hard-coded path matches on this instead — which is
 * also why there is no `CI_WORKFLOW_PATH` in this file any more.
 */
export const CiFileRole = z.enum([
  'manifest',
  'skill',
  'memory',
  'runner',
  'gitattributes',
  'workflow',
]);
export type CiFileRole = z.infer<typeof CiFileRole>;

/** One generated file in the CI bundle (path + role + editable contents). */
export const CiFile = z.object({
  path: z.string(),
  contents: z.string(),
  editable: z.boolean().default(true),
  role: CiFileRole,
});
export type CiFile = z.infer<typeof CiFile>;

/**
 * AgentManifest — the agent contract shared by the studio and the CI runner.
 *
 * The studio (`CiService.agentYaml`) WRITES this shape to
 * `.devdigest/agents/<slug>.yaml`; the agent-runner READS it. Keeping one Zod
 * schema for both ends guarantees the formats never drift. `skills` are slugs
 * resolved to `.devdigest/skills/<slug>.md`.
 */
export const AgentManifest = z.object({
  name: z.string().min(1),
  provider: Provider.default('openrouter'),
  model: z.string().min(1),
  system_prompt: z.string(),
  // Tolerate both a missing key and an explicit `null` (YAML `skills:` with no
  // value parses to null, which `.default([])` does NOT catch) — normalize both
  // to an empty array so manifests without skills validate cleanly.
  skills: z
    .array(z.string())
    .nullish()
    .transform((v) => v ?? []),
  strategy: z.enum(['auto', 'single-pass', 'map-reduce']).default('auto'),
  // CI gate policy (see CiFailOn) — when the posted review should BLOCK
  // (REQUEST_CHANGES + fail the check) vs just comment. Default: block on critical.
  ci_fail_on: CiFailOn.default('critical'),
});
export type AgentManifest = z.infer<typeof AgentManifest>;
/** Caller-facing input type — `.default()` fields stay optional. */
export type AgentManifestInput = z.input<typeof AgentManifest>;

/**
 * Ceiling on a hand-edited workflow sent back for publication.
 *
 * 64 KiB is the export wizard's own preview threshold: a file the wizard refuses
 * to render as text is not a file it can have been edited in.
 */
export const MAX_CI_WORKFLOW_CHARS = 65_536;

/**
 * How the refusals below refer to the file, now that it has no fixed name.
 *
 * It used to be the literal `.github/workflows/devdigest-review.yml`, restated
 * here because `vendor/shared/**` may import zod and itself and nothing else.
 * That literal was one of four copies of a path that is now derived from the
 * agent's slug (AC-135), and a contract cannot know the slug — so the message
 * names the file by its ROLE. The exact path is still named where it is known:
 * `CiService.refuseBrokenWorkflow` interpolates the generated file's own path
 * into the AC-55 refusal.
 */
const CI_WORKFLOW_LABEL = 'the workflow file';

/** Request body for `POST /agents/:id/export-ci`. */
export const CiExportInput = z.object({
  repo: z.string().min(1), // "owner/name"
  target: CiTarget.default('gha'),
  /** "open_pr" opens a PR with the files; "files" just returns/persists them. */
  action: z.enum(['open_pr', 'files']).default('open_pr'),
  post_as: z.enum(['github_review', 'pr_comment', 'none']).default('github_review'),
  triggers: z.array(z.string()).default(['opened', 'synchronize', 'reopened']),
  base: z.string().default('main'),
  /**
   * The workflow the person edited in the Preview step, committed instead of the
   * generated one (AC-31, AC-32).
   *
   * It lives in the SHARED contract and not only in the route's narrowing,
   * because the wizard is the only thing that can send it: while the field was
   * server-side-only, the client had no typed way to name it, `body()` never
   * carried it, and every hand edit was collected, warned about and then
   * silently dropped at Install.
   *
   * The text is written into someone else's repository and then EXECUTED by
   * GitHub, so the service refuses it as YAML — naming the line — rather than
   * repairing it (AC-55). The cap here is a length gate, never the parse.
   *
   * FLOOR AS WELL AS CEILING, and the floor is the one that was missing: a
   * reader who selects all in the workflow textarea and deletes it sends `""`,
   * which `??` in `generate/bundle.ts` passes straight through — `??` falls back
   * on `undefined`, not on empty — and a zero-byte workflow file reaches the
   * target repository, where GitHub reports an invalid workflow and no review
   * ever runs.
   *
   * Blank counts as empty. Three spaces produce the same unusable file as zero
   * bytes, so `\S` decides it — and the value itself is never trimmed, because a
   * workflow this repo rewrote is a workflow this repo repaired, and AC-55
   * refuses instead.
   */
  workflow: z
    .string()
    .max(MAX_CI_WORKFLOW_CHARS)
    .min(1, `${CI_WORKFLOW_LABEL} cannot be empty`)
    .regex(/\S/, `${CI_WORKFLOW_LABEL} cannot be blank`)
    .optional(),
});
export type CiExportInput = z.infer<typeof CiExportInput>;
/** Caller-facing input type — `.default()` fields stay optional (web hooks). */
export type CiExportInputBody = z.input<typeof CiExportInput>;

/** A persisted CI installation (mirrors `ci_installations`). */
export const CiInstallation = z.object({
  id: z.string(),
  agent_id: z.string(),
  repo: z.string(),
  target_type: CiTarget,
  installed_at: z.string(),
  /** `agents.version` the deployed bundle was generated from — the staleness input. */
  agent_version: z.number().int().nullish(),
});
export type CiInstallation = z.infer<typeof CiInstallation>;

/**
 * Why the CI tab cannot say this installation's workflow is running (D23).
 *
 * A row in `ci_installations` was never evidence: it records that DevDigest
 * published a bundle, not that the file survived in the repository. Each value
 * is a different thing the poll learned, and each has its own sentence on the
 * tab.
 *
 * - `never_polled` — no successful poll yet, so nothing is known (AC-148).
 * - `workflow_missing` — the poll asked Actions for this installation's file and
 *   Actions does not have it (AC-147).
 * - `other_agent` — the file at this installation's path uploaded an artifact
 *   naming a DIFFERENT agent, so something else is running there (AC-149).
 */
export const CiUnconfirmedReason = z.enum(['never_polled', 'workflow_missing', 'other_agent']);
export type CiUnconfirmedReason = z.infer<typeof CiUnconfirmedReason>;

/** An installation as the agent's CI tab lists it: the row plus its last run. */
export const CiInstallationListItem = CiInstallation.extend({
  last_run_status: z.string().nullish(),
  last_run_at: z.string().nullish(),
  /** `agent_version` is below the agent's current `version`. */
  stale: z.boolean(),
  /**
   * The workflow file this installation's agent runs from (AC-135, AC-147).
   *
   * Derived from the agent's slug on the SERVER, which is the side that owns
   * the slug rule — the tab renders it and never rebuilds it.
   */
  workflow_path: z.string(),
  /**
   * `null` when the last poll confirmed the workflow present — and only then.
   *
   * The tab counts the `null`s for the "Active in N repos" badge (AC-85), so
   * this one field is what makes the badge stop counting rows and start
   * counting installations that were seen to work.
   */
  unconfirmed_reason: CiUnconfirmedReason.nullable(),
  /** The agent an `other_agent` file really runs, as its artifact named it (AC-149). */
  observed_agent: z.string().nullable(),
});
export type CiInstallationListItem = z.infer<typeof CiInstallationListItem>;

/** Response of `POST /agents/:id/export-ci`. */
export const CiExport = z.object({
  installation: CiInstallation,
  files: z.array(CiFile),
  /**
   * Paths this publication DELETES, by the same commit that writes `files`
   * (AC-146) — today the legacy `.github/workflows/devdigest-review.yml`.
   *
   * On the wire because the Install step has to name the path before it
   * publishes (AC-145), and the alternative was a fourth hard-coded copy of a
   * workflow path in the client — the exact defect `CiFileRole` above exists to
   * remove. Required and not optional: the answer for a bundle that removes
   * nothing is `[]`, which the reader can be told about, whereas a missing field
   * is a client guessing.
   *
   * It rides the `action: "files"` preview response too, which is the one the
   * wizard shows the step from; nothing is deleted by that call.
   */
  removals: z.array(z.string()),
  pr_url: z.string().nullable(),
});
export type CiExport = z.infer<typeof CiExport>;

/** The vocabulary of a `ci_runs` ROW — not of the artifact (see `CiResultArtifact.status`). */
export const CiRunStatus = z.enum(['succeeded', 'failed', 'no_findings', 'running', 'skipped']);
export type CiRunStatus = z.infer<typeof CiRunStatus>;

/** The run state the RUNNER writes into `devdigest-result.json`. */
export const CiArtifactStatus = z.enum(['succeeded', 'failed', 'skipped']);
export type CiArtifactStatus = z.infer<typeof CiArtifactStatus>;

/** A CI run row (mirrors `ci_runs`) — ingested from GitHub Actions artifacts. */
export const CiRun = z.object({
  id: z.string(),
  ci_installation_id: z.string().nullable(),
  pr_number: z.number().int().nullable(),
  ran_at: z.string().nullable(),
  status: z.string().nullable(),
  findings_count: z.number().int().nullable(),
  cost_usd: z.number().nullable(),
  github_url: z.string().nullable(),
  source: z.string().nullable(),
  agent: z.string().nullish(),
  duration_s: z.number().nullish(),
  /** "owner/name" of the repository the workflow run belongs to. */
  repo: z.string().nullish(),
  /** The GitHub Actions run this row was ingested from; unique per repo. */
  workflow_run_id: z.number().int().nullish(),
  head_sha: z.string().nullish(),
  bundle_version: z.string().nullish(),
  /** The REVIEW verdict, separate from `status`, which is the run's own state. */
  verdict: Verdict.nullish(),
});
export type CiRun = z.infer<typeof CiRun>;

/** The widest value a Postgres `integer` column can hold. */
const PG_INT_MAX = 2_147_483_647;

/**
 * A non-negative integer read out of an UNTRUSTED artifact and stored as one.
 *
 * The bound is the defect, not the type. `ci_runs.findings_count` and
 * `ci_runs.duration_ms` are `integer` columns fed straight from this artifact,
 * which is written by code living in the target repository's PR branch. An
 * unbounded `z.number().int()` let `3_000_000_000` past the parse, and the
 * driver then threw `integer out of range` from inside `upsertRun` — not a
 * `ValidationError`, so the ingest's per-run catch rethrew it, the repository's
 * remaining runs were skipped, `last_polled_at` was never stamped, and every
 * later refresh hit the same run and failed identically. One artifact wedged
 * that repository's ingest permanently.
 *
 * Refused here, it is one rejected run at the same edge every other malformed
 * field is refused at, and the per-run catch keeps meaning what it says.
 */
const ArtifactInt = z.number().int().min(0).max(PG_INT_MAX);

/**
 * The artifact shape uploaded by the CI action (`devdigest-result.json`).
 * Ingested back on refresh to populate `ci_runs` (L06).
 */
export const CiResultArtifact = z.object({
  findings_count: ArtifactInt,
  critical: ArtifactInt.nullish(),
  warning: ArtifactInt.nullish(),
  suggestion: ArtifactInt.nullish(),
  cost_usd: z.number().nullable(),
  duration_ms: ArtifactInt.nullish(),
  agent: z.string(),
  version: z.string().nullish(),
  /** A GitHub PR number, which starts at 1 — the run's own is what attributes the row. */
  pr_number: z.number().int().min(1).max(PG_INT_MAX).nullish(),
  /**
   * The run state, as a plain string on purpose.
   *
   * `CiArtifactStatus` is the vocabulary the runner writes, but parsing with it
   * here would fail the WHOLE artifact on an unknown value, and a failed parse
   * is a rejected run. An artifact from a newer runner must still be ingested,
   * with the unrecognised state dropped and logged; an artifact from an older
   * one carries no state at all. Hence `.nullish()` and not `.default()` —
   * a default would make "the runner wrote nothing" indistinguishable from
   * "the runner wrote 'succeeded'". The vocabulary is applied when mapping.
   */
  status: z.string().nullish(),
  /** Why the run failed or was skipped. */
  reason: z.string().nullish(),
  verdict: Verdict.nullish(),
  /** Diff size measured for this run, and the ceiling in force when it ran. */
  changed_lines: ArtifactInt.nullish(),
  max_changed_lines: ArtifactInt.nullish(),
});
export type CiResultArtifact = z.infer<typeof CiResultArtifact>;

// ===========================================================================
// Conformance (PRD ↔ PR) — API record (the analysis shape is `Conformance`)
// ===========================================================================

/**
 * The environment the generated workflow hands the runner, named once.
 *
 * `modules/ci/generate/workflow.ts` writes these keys into the YAML; the runner
 * reads them out of `process.env`. Nothing compares the two lists, so while
 * each side spelled them by hand a rename typechecked, linted and passed both
 * suites — and the runner then read `undefined` in production and took its
 * silent fallbacks (`agentLabel` → `'unknown'`, the default diff ceiling).
 *
 * The two secrets are here for the same reason, even though only the workflow
 * writes them: they are part of the same contract, and a rename of either is
 * the same silent failure.
 */
export const CI_ENV = {
  agent: 'DEVDIGEST_AGENT',
  repository: 'DEVDIGEST_REPOSITORY',
  prNumber: 'DEVDIGEST_PR_NUMBER',
  isFork: 'DEVDIGEST_IS_FORK',
  postAs: 'DEVDIGEST_POST_AS',
  maxDiffLines: 'DEVDIGEST_MAX_DIFF_LINES',
  openRouterKey: 'OPENROUTER_API_KEY',
  githubToken: 'GITHUB_TOKEN',
} as const;

/**
 * Where an export writes inside a target repository.
 *
 * Beside `CI_ENV` and for the same reason: `modules/ci/generate/bundle.ts`
 * WRITES these paths and `agent-runner/src/inputs.ts` READS them, across a
 * package boundary no gate spans. While each side spelled them itself, a
 * rename shipped a bundle the runner could not open with everything green on
 * both sides. `server/src/modules/_shared/bundle-paths.ts` re-exports them for
 * the two server slices that also share them.
 */
export const CI_BUNDLE = {
  root: '.devdigest',
  agents: 'agents',
  skills: 'skills',
} as const;

/** Request body for `POST /pulls/:id/conformance`. */
export const ConformanceInput = z.object({
  /** Spec path/id to compare against; if omitted, the first available spec. */
  spec: z.string().nullish(),
  provider: z.enum(['openai', 'anthropic', 'openrouter']).nullish(),
  model: z.string().nullish(),
});
export type ConformanceInput = z.infer<typeof ConformanceInput>;

/** A persisted conformance check (mirrors `conformance_checks` + the report). */
export const ConformanceReport = z.object({
  id: z.string(),
  pr_id: z.string(),
  report: Conformance,
});
export type ConformanceReport = z.infer<typeof ConformanceReport>;

// ===========================================================================
// Hooks (Secret-Leak + Phantom-API detectors) — emit grounding-exempt findings
// ===========================================================================

export const HookKind = z.enum(['secret_leak', 'phantom']);
export type HookKind = z.infer<typeof HookKind>;

/** Result of running the built-in detectors over a PR. */
export const HookScanResult = z.object({
  pr_id: z.string(),
  review_id: z.string().nullable(),
  findings: z.array(Finding),
});
export type HookScanResult = z.infer<typeof HookScanResult>;
