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
  RiskBrief,
  RiskBriefRecord,
  RiskBriefTimeline,
  RiskBriefTimelineEntry,
  RiskBriefInput,
  RiskBriefRefLine,
  RiskBriefRefLineSource,
  ReviewFocusItem,
  RiskBriefTokenizer,
  IntentFreshness,
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
