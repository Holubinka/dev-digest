import type { IconName } from "@devdigest/ui";

/**
 * The four target cards, in the order AC-10 fixes and the mockup draws
 * (`SPEC-05-export-to-ci-mockup.jsx` → `CI_TARGETS`).
 *
 * `implemented` is the whole of AC-12/AC-13: the three false ones carry a
 * visible "not implemented" mark, are `aria-disabled` and select nothing when
 * activated. They are NOT `disabled` — a `disabled` button drops out of the tab
 * order, and a card the reader cannot reach cannot tell them why it is there.
 */
export interface CiTargetCard {
  key: string;
  labelKey: string;
  descKey: string;
  icon: IconName;
  implemented: boolean;
}

export const CI_TARGETS: readonly CiTargetCard[] = [
  {
    key: "gha",
    labelKey: "exportWizard.targets.gha",
    descKey: "exportWizard.targets.ghaDesc",
    icon: "Workflow",
    implemented: true,
  },
  {
    key: "circle",
    labelKey: "exportWizard.targets.circle",
    descKey: "exportWizard.targets.circleDesc",
    icon: "RefreshCw",
    implemented: false,
  },
  {
    key: "jenkins",
    labelKey: "exportWizard.targets.jenkins",
    descKey: "exportWizard.targets.jenkinsDesc",
    icon: "Settings",
    implemented: false,
  },
  {
    key: "cli",
    labelKey: "exportWizard.targets.cli",
    descKey: "exportWizard.targets.cliDesc",
    icon: "Command",
    implemented: false,
  },
];

/** The `pull_request` activity types AC-27 offers, in the order it lists them. */
export const TRIGGERS = ["opened", "synchronize", "reopened"] as const;

/** The three "Post results as" options, first one selected (AC-29). */
export const POST_AS_OPTIONS = [
  { key: "github_review", labelKey: "exportWizard.postAs.githubReview", recommended: true },
  { key: "pr_comment", labelKey: "exportWizard.postAs.prComment", recommended: false },
  { key: "none", labelKey: "exportWizard.postAs.none", recommended: false },
] as const;

/** The step labels, in the order `ExportWizardSteps` renders them (AC-4). */
export const STEP_LABEL_KEYS = [
  "exportWizard.steps.target",
  "exportWizard.steps.preview",
  "exportWizard.steps.configure",
  "exportWizard.steps.install",
] as const;

/**
 * Above this many bytes a file shows its header and its size instead of its
 * text (AC-24). The bundle carries `.devdigest/runner.mjs`, a single-file ESM
 * build the plan budgets at up to 1.5 MiB — putting that in a `<pre>` is a
 * multi-second layout on a modal that is meant to open instantly.
 */
export const PREVIEW_MAX_BYTES = 64 * 1024;

/** The base branch used when the selected repo reports none. */
export const FALLBACK_BASE = "main";
