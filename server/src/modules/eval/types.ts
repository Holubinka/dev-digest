import type {
  EvalBatchResult,
  EvalCase,
  EvalCaseFromFinding,
  EvalCaseSet,
  EvalCompare,
  EvalDashboardAll,
  EvalAgentDashboard,
  EvalExpectations,
  EvalRunAllResult,
  EvalRunResult,
  LLMProvider,
  Provider,
  ReviewStrategy,
  SkillEvalCaseSet,
} from '@devdigest/shared';
import type { LinkedSkillLike } from '../_shared/skill-prompt.js';
import type { PrDiffSource } from '../_shared/pr-diff.js';

/**
 * eval — the ports this slice codes against.
 *
 * NOTHING here is imported from `modules/reviews/**` or `modules/agents/**`.
 * That is the binding constraint, not a preference: `no-cross-module` follows
 * `import type` too (`.dependency-cruiser.cjs` sets `tsPreCompilationDeps: true`
 * with no `dependencyTypesNot` on that rule), so `import type { AgentRow }` from
 * that slice would be a violation exactly like a value import.
 *
 * `Container` is not imported either, for the reason `modules/brief/types.ts`
 * records: `platform/container.ts` constructs `EvalService`, so naming
 * `Container` from inside this slice closes a cycle `no-circular` rejects. A
 * `Container` satisfies `EvalContainer` by construction, so the composition root
 * passes `this` unchanged.
 */

/** The `agents` columns a batch reads: identity, model, and the prompt itself. */
export interface EvalAgent {
  id: string;
  name: string;
  version: number;
  provider: Provider;
  model: string;
  systemPrompt: string;
  strategy: ReviewStrategy;
}

/** The `findings` columns a case is cut from. */
export interface EvalFinding {
  id: string;
  file: string;
  startLine: number;
  endLine: number;
  severity: string;
  category: string;
  title: string;
  acceptedAt: Date | null;
  dismissedAt: Date | null;
}

/** The `reviews` columns that say WHICH AGENT produced the finding (R1's `owner_id`). */
export interface EvalReview {
  id: string;
  agentId: string | null;
  prId: string;
}

/** The `pull_requests` columns a case's input is built from. */
export interface EvalPull {
  id: string;
  workspaceId: string;
  repoId: string;
  number: number;
  title: string;
  body: string | null;
  base: string;
  headSha: string;
}

/**
 * The slice of the composition root this module needs, stated structurally.
 *
 * `agentsRepo` and `reviewRepo` are named as the narrowest set of methods that
 * answers this feature's questions rather than as the two repository classes:
 * a class would carry its whole surface — and its slice — across the boundary,
 * and `no-cross-module` is only silent here because these are shapes.
 *
 * It extends `PrDiffSource` so `loadPrDiff` can be called with the container
 * itself; the `reviewRepo` member below widens that base's one method.
 */
export interface EvalContainer extends PrDiffSource {
  readonly agentsRepo: {
    getById(workspaceId: string, id: string): Promise<EvalAgent | undefined>;
    list(workspaceId: string): Promise<{ agent: EvalAgent }[]>;
    linkedSkills(agentId: string): Promise<LinkedSkillLike[]>;
    /**
     * The immutable config snapshot of one version — where the comparison's
     * two prompt texts come from (AC-61). Scoped by the agent id its caller has
     * already resolved through the workspace.
     */
    getVersion(
      agentId: string,
      version: number,
    ): Promise<{ configJson: unknown } | undefined>;
  };
  /** Tenancy only — a skill's own Evals tab needs nothing else to 404 correctly. */
  readonly skillsRepo: {
    existsInWorkspace(workspaceId: string, id: string): Promise<boolean>;
  };
  readonly reviewRepo: {
    findingContext(findingId: string): Promise<
      | {
          finding: EvalFinding;
          review: EvalReview;
          pull: EvalPull;
        }
      | undefined
    >;
    getRepo(repoId: string): Promise<{ owner: string; name: string } | undefined>;
    getPrFiles(prId: string): Promise<{ path: string; patch: string | null }[]>;
  };
  llm(id: Provider): Promise<LLMProvider>;
}

/**
 * The one thing this module logs, injected so a hermetic test can assert on it.
 *
 * Per call rather than per instance: the service is built once by the
 * composition root, which has no logger, and the caller that has one is the
 * request. `BriefService` and `ReviewService` pass theirs the same way.
 */
export interface EvalLogger {
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
}

/** A case as the executor consumes it — already parsed, already workspace-checked. */
export interface RunnableCase {
  id: string;
  name: string;
  inputDiff: string;
  /** The PR body stored with the case; reaches the model only as `prDescription`. */
  prDescription: string | null;
  expectations: EvalExpectations;
}

/**
 * The port `platform/container.ts` exposes for this slice.
 *
 * The argument for memoising it is the one `briefService` records and is
 * stronger here: `EvalService` carries the single-flight map keyed by agent id
 * that AC-28 and AC-35 rest on, and a map on a second instance is not the same
 * lock. Any second construction — a second `app.register`, or the first
 * non-HTTP caller — would get a fresh empty Map and "one batch per agent at a
 * time" would silently stop holding, with every test still green.
 */
export interface EvalReader {
  caseFromFinding(
    workspaceId: string,
    findingId: string,
  ): Promise<EvalCaseFromFinding | undefined>;
  listCases(workspaceId: string, agentId: string): Promise<EvalCaseSet | undefined>;
  listCasesForSkill(workspaceId: string, skillId: string): Promise<SkillEvalCaseSet | undefined>;
  createCase(
    workspaceId: string,
    agentId: string,
    input: NewCaseInput,
  ): Promise<EvalCase | undefined>;
  getCase(workspaceId: string, caseId: string): Promise<EvalCase | undefined>;
  updateCase(
    workspaceId: string,
    caseId: string,
    patch: UpdateCaseInput,
  ): Promise<EvalCase | undefined>;
  deleteCase(workspaceId: string, caseId: string): Promise<boolean>;
  runCase(workspaceId: string, caseId: string): Promise<EvalRunResult | undefined>;
  runSet(workspaceId: string, agentId: string, log: EvalLogger): Promise<EvalBatchResult | undefined>;
  runAll(workspaceId: string, log: EvalLogger): Promise<EvalRunAllResult>;
  dashboard(workspaceId: string): Promise<EvalDashboardAll>;
  agentDashboard(
    workspaceId: string,
    agentId: string,
    range: { from?: Date; to?: Date },
  ): Promise<EvalAgentDashboard | undefined>;
  compare(workspaceId: string, a: string, b: string): Promise<EvalCompare | undefined>;
}

/** `POST /agents/:id/eval-cases` — a hand-made case. Parsed at the route (C10). */
export interface NewCaseInput {
  name: string;
  input_diff: string;
  input_meta: { title?: string | null; body?: string | null } | null;
  expected_output: EvalExpectations;
  notes: string | null;
}

/** `PUT /eval-cases/:id`. Every field optional; `input_files` is derived, never set. */
export interface UpdateCaseInput {
  name?: string;
  input_diff?: string;
  input_meta?: { title?: string | null; body?: string | null } | null;
  expected_output?: EvalExpectations;
  notes?: string | null;
}
