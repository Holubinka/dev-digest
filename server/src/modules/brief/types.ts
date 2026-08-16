import type {
  BlastRadiusView,
  GitClient,
  IntentRecord,
  IssueMeta,
  LLMProvider,
  PromptTemplates,
  Provider,
  RiskBriefInput,
  RiskBriefInputId,
  RiskBriefRecord,
  RiskBriefTokenizer,
} from '@devdigest/shared';
import type { PrBriefRow } from '../../db/rows.js';
import type { SettingsReader } from '../_shared/feature-models.js';

/**
 * brief — the ports this slice codes against.
 *
 * NOTHING here is imported from `modules/intent/**`, `modules/blast/**` or
 * `modules/context/**`. That is the binding constraint, not a preference:
 * `no-cross-module` follows `import type` too (`.dependency-cruiser.cjs` sets
 * `tsPreCompilationDeps: true` with no `dependencyTypesNot` on that rule), so
 * `import type { BlastReads }` would be a violation exactly like a value import.
 * `Container` is not imported either, for the reason `modules/intent/types.ts`
 * records: the composition root constructs the graph, and naming it from inside
 * a slice closes a cycle `no-circular` rejects.
 *
 * Contract types from `@devdigest/shared` are fine — they are the innermost ring.
 * The ban is on `modules/<other-slice>/**`.
 */

/**
 * The slice of the composition root `BriefService` needs, stated structurally.
 *
 * `intentService` names ONLY `get`. That is the whole point of writing it out
 * rather than importing `IntentDeriver`: this feature must never derive an
 * intent (R21, one model call per computation), and a port that cannot express
 * `derive` cannot accidentally call it.
 *
 * There is deliberately no `db`: the repository arrives as a constructor
 * parameter, so this interface carries no data layer across the ring boundary
 * (`onion-architecture` §3.5).
 */
export interface BriefContainer extends SettingsReader {
  readonly git: GitClient;
  readonly prompts: PromptTemplates;
  readonly tokenizer: { count(text: string): number; readonly id: RiskBriefTokenizer };
  readonly intentService: { get(w: string, p: string): Promise<IntentRecord | null | undefined> };
  readonly blastService: { getBlast(w: string, p: string): Promise<BlastRadiusView | undefined> };
  llm(id: Provider): Promise<LLMProvider>;
}

/** Just enough of `pull_requests` to build a brief, flattened. A `*Row` never leaves the module. */
export interface BriefPull {
  id: string;
  repoId: string;
  headSha: string;
  title: string;
  body: string | null;
  linkedIssue: IssueMeta | null;
}

/** Just enough of `repos` to read the clone. */
export interface BriefRepoRef {
  owner: string;
  name: string;
}

/** The one line of diff shape the model is given. No hunks, no patches (R17). */
export interface BriefDiffStats {
  files: number;
  additions: number;
  deletions: number;
}

/** Everything the brief is allowed to read, gathered from the DB, the clone and two ports. */
export interface BriefSources {
  title: string;
  body: string | null;
  linkedIssue: IssueMeta | null;
  /** `null` = nothing derived for this PR. NOT a reason to derive one (R21). */
  intent: IntentRecord | null;
  /** `null` = the blast port answered `undefined`. Not a reason to fail (R22). */
  blast: BlastRadiusView | null;
  diff: BriefDiffStats;
  /** Already capped to `MAX_FILE_PATHS` by the query that fetched them. */
  filePaths: string[];
  /** Already capped to `MAX_SPEC_FILE_CHARS` each by the read that produced them. */
  specs: { path: string; text: string }[];
}

/**
 * One candidate input, with the references it puts in front of the model.
 *
 * `refs` is **exactly** what this block's own text names — not what the source it
 * came from could have named. That is what makes the allowed set the prompt's
 * inventory rather than the gatherer's wish list (see `buildAllowedRefs`).
 *
 * `text` is the block's finished contribution to the user message for every id
 * except `specs`. Spec blocks are per-file and carry the INNER section
 * (`### <path>\n<body>`); the budget walk selects among them and `fitToBudget`
 * wraps the survivors in one `plan-spec` fence, because a cap applied after
 * wrapping would cut the closing `</untrusted>`.
 */
export interface BriefBlock {
  id: RiskBriefInputId;
  text: string;
  refs: string[];
  /** What it was, in one line — echoed into `RiskBriefInput.detail`. */
  detail: string | null;
}

/** What `fitToBudget` decided: the user message, the provenance rows, and the blocks that survived. */
export interface BriefFit {
  user: string;
  inputs: RiskBriefInput[];
  /** Every block whose status came out `included` OR `truncated`. */
  included: BriefBlock[];
}

/** The columns one computation writes. `computed_at` is set by the repository. */
export interface BriefValues {
  what: string;
  why: string;
  riskLevel: 'high' | 'medium' | 'low';
  risks: unknown[];
  reviewFocus: unknown[];
  inputs: unknown[];
  droppedRefs: string[];
  droppedRisks: number;
  intentComputedAt: Date | null;
  intentFreshness: 'fresh' | 'stale' | 'unknown';
  blastStatus: string;
  linkSha: string | null;
  indexMatchesHead: boolean;
  budget: number;
  inputTokensCounted: number;
  tokenizer: string;
  attempts: number;
  tokensIn: number;
  provider: string;
  model: string;
  costUsd: number | null;
}

/**
 * The repository seam, declared as an INTERFACE rather than as the class.
 *
 * `BriefRepository` holds `private db: Db`, and a private member makes a plain
 * object literal unassignable to the class type — which is precisely why three
 * services in this repo have no hermetic tests (`onion-architecture` →
 * testing-the-rings §3). Typing the seam here is what lets
 * `test/brief-service.test.ts` run with no Docker.
 */
export interface BriefReads {
  /** Workspace-scoped. `undefined` is the IDOR gate: it means "not yours", not "no brief". */
  getPull(workspaceId: string, prId: string): Promise<BriefPull | undefined>;
  getRepo(repoId: string): Promise<BriefRepoRef | undefined>;
  getFilePaths(prId: string, limit: number): Promise<string[]>;
  getDiffStats(prId: string): Promise<BriefDiffStats>;
  getBriefFor(prId: string, headSha: string): Promise<PrBriefRow | undefined>;
  /** `null` when this sha has no `pr_commits` row — which is `unknown`, not `fresh` (R25). */
  getHeadCommittedAt(prId: string, headSha: string): Promise<Date | null>;
  /**
   * Upsert this state's row, evict everything past `maxStates`, and stamp the
   * running eviction total onto the row just written — ONE transaction, which is
   * what stops a crash leaving a count that claims a deletion that did not
   * happen. Returns the persisted row.
   */
  upsertBrief(
    prId: string,
    headSha: string,
    values: BriefValues,
    maxStates: number,
  ): Promise<PrBriefRow>;
}

/** The one thing the service logs. Injected so `test/brief-service.test.ts` can assert on it. */
export interface BriefLogger {
  warn(obj: unknown, msg?: string): void;
}

/**
 * The outcome of one computation.
 *
 * `compute` NEVER throws for a business failure — the shape `IntentDeriver.derive`
 * already uses — so the route decides the status code. The one exception is a
 * `ConfigError`, which propagates as itself so the route can answer
 * `config_error` rather than a generic 502 (R42).
 */
export type BriefComputation =
  | { ok: true; record: RiskBriefRecord }
  | { ok: false; reason: string };
