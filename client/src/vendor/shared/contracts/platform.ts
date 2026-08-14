import { z } from 'zod';
import { Provider } from './knowledge.js';

/**
 * Platform / scaffolding DTOs owned by F1:
 *  - settings (GET/PUT /settings, POST /settings/test-connection)
 *  - repos (POST/GET /repos, refresh, delete)
 *  - pulls (GET /repos/:id/pulls, GET /pulls/:id)
 *  - context (Project Context folder)
 */

// ---- Feature → model selection ----
/** System LLM features whose model is selectable in Settings (per-workspace). */
export const FeatureModelId = z.enum([
  'onboarding',
  'review_intent',
  'risk_brief',
  'conformance',
  'conventions',
]);
export type FeatureModelId = z.infer<typeof FeatureModelId>;

/** A chosen provider + model for one feature. */
export const FeatureModelChoice = z.object({
  provider: Provider,
  model: z.string().min(1),
});
export type FeatureModelChoice = z.infer<typeof FeatureModelChoice>;

/**
 * Registry of the selectable features: stable id, display label, and the
 * built-in default used when the workspace hasn't overridden the choice. The
 * defaults MIRROR each module's constants, so behaviour is unchanged until a
 * model is explicitly picked.
 */
export interface FeatureModelDef {
  id: FeatureModelId;
  label: string;
  description: string;
  defaultProvider: Provider;
  defaultModel: string;
}
export const FEATURE_MODELS: FeatureModelDef[] = [
  {
    id: 'onboarding',
    label: 'Onboarding Tour',
    description: 'Writes the per-repo onboarding tour.',
    defaultProvider: 'openrouter',
    defaultModel: 'deepseek/deepseek-v4-flash',
  },
  {
    id: 'review_intent',
    label: 'PR Review · Intent',
    description: 'Derives a PR’s intent and scope before review.',
    defaultProvider: 'openrouter',
    defaultModel: 'z-ai/glm-4.7-flash',
  },
  {
    id: 'risk_brief',
    label: 'Risk Brief',
    description: 'Assesses merge risks for a pull request.',
    defaultProvider: 'openai',
    defaultModel: 'gpt-4.1',
  },
  {
    id: 'conformance',
    label: 'Conformance',
    description: 'Checks a PR against the project spec.',
    defaultProvider: 'openai',
    defaultModel: 'gpt-4.1',
  },
  {
    id: 'conventions',
    label: 'Conventions',
    description: 'Extracts coding conventions from the repo.',
    // Cheap by default, like the onboarding tour: this call reads a dozen files
    // and returns a list of sentences, and everything it claims is verified
    // against the clone afterwards. Paying flagship prices for it buys nothing
    // the grounding step does not already enforce.
    defaultProvider: 'openrouter',
    defaultModel: 'anthropic/claude-haiku-4.5',
  },
];

// ---- Settings ----
/**
 * Non-secret prefs/config. Secrets (API keys) are NOT stored here — they go
 * through SecretsProvider (.env in MVP). Settings is a flat key/value bag,
 * surfaced as a typed object for the well-known keys.
 */
export const SettingsKnown = z.object({
  polling_interval_min: z.number().int().min(1).default(5),
  theme: z.enum(['dark', 'light']).default('dark'),
  density: z.enum(['regular', 'compact']).default('regular'),
  sync_to_folder: z.boolean().default(true),
  automatic_reviews: z.boolean().default(false),
  /** Per-feature model overrides (provider+model), keyed by FeatureModelId. */
  feature_models: z.record(FeatureModelId, FeatureModelChoice).default({}),
  /**
   * Repo-relative folder names the Project Context scan walks for `.md`
   * documents. Changing them invalidates every repo's persisted scan — the rows
   * were produced under the old roots and nothing re-derives them — so the
   * Settings screen says so and rescan stays the user's action.
   */
  context_scan_roots: z.array(z.string()).default(['specs', 'docs', 'insights']),
  /**
   * Token budget for the assembled `## Project context` section, per prompt.
   * Under `map-reduce` the block is charged once per changed file.
   */
  context_token_budget: z.number().int().positive().default(16000),
});
export type SettingsKnown = z.infer<typeof SettingsKnown>;

/** Full settings payload: well-known keys + arbitrary extras. */
export const Settings = SettingsKnown.passthrough();
export type Settings = z.infer<typeof Settings>;

export const SettingsUpdate = Settings.partial();
export type SettingsUpdate = z.infer<typeof SettingsUpdate>;

// ---- Connection test ----
export const ConnTestProvider = z.enum(['openai', 'anthropic', 'openrouter', 'github']);
export type ConnTestProvider = z.infer<typeof ConnTestProvider>;

export const ConnTestRequest = z.object({
  provider: ConnTestProvider,
  /** Optional API key/PAT to persist and then test (BYO key from the UI). */
  key: z.string().min(1).optional(),
});
export type ConnTestRequest = z.infer<typeof ConnTestRequest>;

export const ConnTestResult = z.object({
  provider: ConnTestProvider,
  ok: z.boolean(),
  message: z.string(),
  detail: z.unknown().optional(),
});
export type ConnTestResult = z.infer<typeof ConnTestResult>;

// ---- Secrets status (which provider keys are configured; never the values) ----
/** Boolean per provider: true ⇒ a key/PAT is stored. The value is never exposed. */
export const SecretsStatus = z.object({
  openai: z.boolean(),
  anthropic: z.boolean(),
  openrouter: z.boolean(),
  github: z.boolean(),
});
export type SecretsStatus = z.infer<typeof SecretsStatus>;

// ---- Repos ----
export const RepoInput = z.object({
  url: z.string().url(),
});
export type RepoInput = z.infer<typeof RepoInput>;

export const Repo = z.object({
  id: z.string(),
  workspace_id: z.string(),
  owner: z.string(),
  name: z.string(),
  full_name: z.string(),
  default_branch: z.string(),
  clone_path: z.string().nullable(),
  last_polled_at: z.string().nullable(),
  created_by: z.string().nullable(),
});
export type Repo = z.infer<typeof Repo>;

// ---- Pull requests ----
export const PrStatus = z.enum(['needs_review', 'reviewed', 'stale', 'open', 'closed', 'merged']);
export type PrStatus = z.infer<typeof PrStatus>;

/**
 * A finding as the PR LIST carries it — the subset a hover card needs. The full
 * record (`FindingRecord` in `review-api`) stays on the PR detail endpoints.
 */
export const ListFinding = z.object({
  id: z.string(),
  severity: z.string(),
  category: z.string(),
  title: z.string(),
  file: z.string(),
  start_line: z.number().int(),
  end_line: z.number().int(),
  confidence: z.number(),
  rationale: z.string(),
});
export type ListFinding = z.infer<typeof ListFinding>;

export const PrMeta = z.object({
  id: z.string().nullish(),
  number: z.number().int(),
  title: z.string(),
  author: z.string(),
  branch: z.string(),
  base: z.string(),
  head_sha: z.string(),
  additions: z.number().int(),
  deletions: z.number().int(),
  files_count: z.number().int(),
  status: PrStatus,
  opened_at: z.string().nullish(),
  updated_at: z.string().nullish(),
  // Latest-review score (list endpoint only; null/absent until reviewed).
  score: z.number().int().nullish(),
  // TOTAL USD spent on this PR — every agent run summed (list endpoint only).
  // Unlike `score`, this is cumulative, not latest-wins: "Review all" fans out
  // to every enabled agent. Null/absent until a run records a cost.
  cost_usd: z.number().nullish(),
  // FINDINGS breakdown across EVERY review on the PR, not just the latest one,
  // so the list and the PR page's severity bar can never disagree (list
  // endpoint only). Zero means reviewed-and-clean; null means never reviewed —
  // the UI renders those differently and must be able to tell them apart.
  findings_critical: z.number().int().nullish(),
  findings_warning: z.number().int().nullish(),
  findings_suggestion: z.number().int().nullish(),
  // The worst few findings behind those counts, for the list's hover card:
  // worst severity first, then most confident, rationale truncated. Capped so
  // the list payload stays bounded no matter how noisy a review was.
  findings_top: z.array(ListFinding).nullish(),
});
export type PrMeta = z.infer<typeof PrMeta>;

export const PrFile = z.object({
  path: z.string(),
  additions: z.number().int(),
  deletions: z.number().int(),
  patch: z.string().nullish(),
});
export type PrFile = z.infer<typeof PrFile>;

export const PrCommit = z.object({
  sha: z.string(),
  message: z.string(),
  author: z.string(),
  committed_at: z.string().nullish(),
});
export type PrCommit = z.infer<typeof PrCommit>;

export const IssueMeta = z.object({
  number: z.number().int(),
  title: z.string(),
  body: z.string().nullish(),
  state: z.string(),
});
export type IssueMeta = z.infer<typeof IssueMeta>;

export const PrDetail = PrMeta.extend({
  body: z.string().nullish(),
  files: z.array(PrFile),
  commits: z.array(PrCommit),
  linked_issue: IssueMeta.nullish(),
});
export type PrDetail = z.infer<typeof PrDetail>;

// ---- PR review (inline) comments ----
/**
 * A GitHub PR review comment anchored to a diff line. Mirrors the fields the
 * "Files changed" tab needs to render threads inline; `line` is the position in
 * the current diff (null when GitHub can no longer anchor it → `is_outdated`).
 */
export const PrReviewComment = z.object({
  id: z.number().int(),
  path: z.string(),
  line: z.number().int().nullable(),
  original_line: z.number().int().nullable(),
  side: z.enum(['LEFT', 'RIGHT']),
  body: z.string(),
  user: z.string(),
  created_at: z.string(),
  html_url: z.string(),
  in_reply_to_id: z.number().int().nullable(),
  /** GitHub couldn't anchor it to the current diff (line == null). */
  is_outdated: z.boolean(),
});
export type PrReviewComment = z.infer<typeof PrReviewComment>;

/** Body for POST /pulls/:id/comments (create one inline comment / reply). */
export const PrCommentInput = z.object({
  path: z.string().min(1),
  line: z.number().int().positive(),
  side: z.enum(['LEFT', 'RIGHT']).optional(),
  body: z.string().min(1),
  /** Reply to an existing review comment thread (its comment id). */
  in_reply_to: z.number().int().optional(),
});
export type PrCommentInput = z.infer<typeof PrCommentInput>;

// ---- Project Context ----

/**
 * Which configured root a scanned document came from.
 *
 * FOUR values, and the fourth is a requirement rather than a fallback: a
 * document found under a workspace-configured root whose folder name is not
 * `specs`, `docs` or `insights` is kind `other` and gets its own badge. Anywhere
 * this enum is restated — the Drizzle column's `{ enum: [...] }`, the badge map
 * on the page, a test fixture — it carries all four. Three values plus a default
 * is the version that silently mislabels every custom root.
 */
export const ContextDocKind = z.enum(['specs', 'docs', 'insights', 'other']);
export type ContextDocKind = z.infer<typeof ContextDocKind>;

/**
 * Where a repo's document scan stands.
 *
 * Deliberately NOT `IndexStatus` below, and deliberately not named that either:
 * that name already denotes three different shapes in this repo, and its
 * `parsing` / `embedding` / `chunks_indexed` vocabulary describes the
 * chunk-and-embed feature Project Context puts out of scope.
 */
export const ContextScanState = z.enum(['no_clone', 'scanning', 'scanned', 'failed']);
export type ContextScanState = z.infer<typeof ContextScanState>;

/** What happened to one attached document when a review's prompt was assembled. */
export const ContextDocStatus = z.enum([
  'included',
  'truncated',
  'dropped',
  'missing',
  'refused',
  'binary',
]);
export type ContextDocStatus = z.infer<typeof ContextDocStatus>;

/**
 * One scanned project-context document.
 *
 * `content` is populated only by the single-document read; the list endpoints
 * leave it null, so there is ONE document shape rather than a list shape and a
 * detail shape that drift.
 */
export const SpecFile = z.object({
  path: z.string(),
  content: z.string().nullish(),
  size: z.number().int().nullish(),
  updated_at: z.string().nullish(),
  /** The configured scan root this document was found under, e.g. `docs`. */
  root: z.string(),
  kind: ContextDocKind,
  /** Counted at scan time by the SAME counter the run measures the budget with. */
  tokens: z.number().int(),
  /** Enabled agents whose effective set holds this document, directly or via a skill. */
  used_by_agents: z.number().int(),
  /**
   * Created or uploaded through DevDigest rather than found in the repository.
   * ABSENT MEANS FALSE — an ordinary scanned document omits it, which is what
   * keeps every fixture written before documents could be authored valid.
   */
  local: z.boolean().optional(),
  /**
   * The disk no longer holds the text DevDigest saved here: a tracked file was
   * edited and a later `git reset --hard` returned it to the branch. ABSENT
   * MEANS FALSE, i.e. either nothing was ever saved for this path or what is on
   * disk is still what was saved.
   */
  stale: z.boolean().optional(),
});
export type SpecFile = z.infer<typeof SpecFile>;

export const IndexStatus = z.object({
  status: z.enum(['idle', 'cloning', 'parsing', 'embedding', 'done', 'error']),
  pct: z.number().min(0).max(100),
  message: z.string().nullish(),
  chunks_indexed: z.number().int().nullish(),
});
export type IndexStatus = z.infer<typeof IndexStatus>;

// ---- Run request (review trigger; owned by A2, contract lives here) ----
export const RunRequest = z.object({
  agentId: z.string().optional(),
  all: z.boolean().optional(),
});
export type RunRequest = z.infer<typeof RunRequest>;

// ---- Structured API error envelope (returned by the API; UX taxonomy is FE) ----
export const ApiErrorBody = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ApiErrorBody = z.infer<typeof ApiErrorBody>;
