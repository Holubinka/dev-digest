/**
 * Shared contract types re-exported from @devdigest/shared (single source of
 * truth). F2 imports these rather than redefining them.
 *
 * F1 (@devdigest/shared) currently exports all the platform/findings/brief/
 * knowledge/trace contracts we need for the scaffolding screens, so there are
 * NO local placeholders required at this time. If a feature agent's contract is
 * not yet exported, add a placeholder below marked
 * `// TODO: reconcile with @devdigest/shared`.
 */
export type {
  Settings,
  SettingsUpdate,
  ConnTestProvider,
  ConnTestResult,
  SecretsStatus,
  FeatureModelId,
  FeatureModelChoice,
  FeatureModelDef,
  Provider,
  ModelInfo,
  Repo,
  RepoInput,
  PrMeta,
  PrDetail,
  PrFile,
  PrCommit,
  PrReviewComment,
  PrStatus,
  SpecFile,
  IndexStatus,
} from "@devdigest/shared";

/** Project Context (08) — the page, the two editors' attachment sets, the run trace. */
export type {
  ContextDocKind,
  ContextScanState,
  ContextDocStatus,
  ContextDocsPage,
  AttachedContextDoc,
  InheritedContextDoc,
  AgentContextDocs,
  SkillContextDocs,
  SetContextDocsBody,
  RunProjectContextDoc,
  CreateContextDocBody,
  CreateContextFolderBody,
  SaveContextDocBody,
  ContextFolderCreated,
} from "@devdigest/shared";

export type { Review, Finding, Severity, Verdict } from "@devdigest/shared";
export type { PrBrief, SmartDiff } from "@devdigest/shared";
export type {
  BlastRadiusView,
  BlastSymbol,
  BlastViewCaller,
  BlastEndpoint,
  BlastIndexStatus,
  BlastSummaryResponse,
} from "@devdigest/shared";
export type {
  Intent,
  IntentRecord,
  IntentConfidence,
  IntentEvidenceSource,
} from "@devdigest/shared";

/** PR Why + Risk Brief (10) — the per-head_sha brief card and its history. */
export type {
  RiskBriefRecord,
  RiskBriefInput,
  RiskBriefRefLine,
  ReviewFocusItem,
  IntentFreshness,
} from "@devdigest/shared";

/**
 * Onboarding Tour (SPEC-03) — the page envelope and everything the tour is made
 * of. Types only, never the schemas: nothing on this screen validates, and
 * importing the Zod object would put a parser in the client bundle that no call
 * site runs.
 *
 * `OnboardingSectionKind` is the one the rest of the feature keys on — the
 * section descriptor, the rail and the empty-state copy all index by it — so a
 * rename in the contract becomes a compile error here rather than a section
 * that quietly stops rendering.
 *
 * `OnboardingDraft`, `OnboardingDropped` and `OnboardingTokenizer` are
 * deliberately NOT here. They ride inside the record and nothing on the page
 * draws them; re-exporting a type no screen reads is how a "the client uses
 * this" claim gets made by accident.
 */
export type {
  OnboardingPage,
  OnboardingRecord,
  OnboardingIndexState,
  OnboardingRefusal,
  Onboarding,
  OnboardingSection,
  OnboardingSectionKind,
  OnboardingFlow,
  OnboardingReadingStep,
  OnboardingTask,
  OnboardingTaskStep,
  OnboardingTaskComplexity,
  OnboardingPackageBlock,
  OnboardingSetupCommand,
  OnboardingEnvVar,
  OnboardingPackageScan,
  OnboardingInput,
} from "@devdigest/shared";

/**
 * Eval pipeline (SPEC-05) — the case set, the run envelope and the three
 * screens' read models. Types only, never the schemas: nothing on the dashboard
 * validates a response, and `lib/api.ts` does not parse.
 *
 * `EvalExpectations` is the one exception and it is imported directly from
 * `@devdigest/shared` by the case editor, not re-exported here: that screen
 * genuinely runs `.safeParse()` on hand-edited JSON to block a save (AC-19), so
 * it needs the schema object rather than the type.
 *
 * `AgentVersion` rides along because «Promote vN» reads a version's config
 * snapshot before applying it — it is an agents contract serving an eval flow.
 */
export type {
  EvalCase,
  EvalCaseInput,
  EvalOwnerKind,
  EvalRun,
  EvalPerTrace,
  EvalRunRecord,
  EvalRunResult,
  EvalTrendPoint,
  EvalDashboard,
  EvalExpectation,
  EvalExpectationInput,
  EvalExpectationPolarity,
  EvalExpectations,
  EvalExpectationsInput,
  EvalBatchAggregate,
  EvalRunEnvelope,
  EvalCaseRow,
  EvalCaseSet,
  SkillEvalCaseRow,
  SkillEvalCaseSet,
  EvalBatchSummary,
  EvalBatchResult,
  EvalCaseFromFinding,
  EvalDashboardCard,
  EvalDashboardAll,
  EvalAgentDashboard,
  EvalCompare,
  EvalRunAllResult,
  Agent,
  AgentVersion,
  AgentVersionConfig,
} from "@devdigest/shared";

/** UI-only view model for a PR list row (derives display fields from PrMeta). */
export interface PrRowView {
  number: number;
  title: string;
  author: string;
  size: "S" | "M" | "L";
  sizeLines: string;
  score: number;
  findings: { CRITICAL: number; WARNING: number; SUGGESTION: number };
  status: "needs_review" | "reviewed" | "stale";
  updated: string;
}
