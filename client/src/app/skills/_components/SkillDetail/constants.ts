import type { IconName } from "@devdigest/ui";

export interface DetailTab {
  key: string;
  labelKey: string;
  icon: IconName;
}

/**
 * Detail tabs. Stats and Evals are both here because every number either shows
 * is derived from rows that already exist: Stats from bindings, runs and
 * accepted/dismissed findings; Evals from `eval_cases`/`eval_runs`, the
 * reciprocal of an agent's own Evals tab — which cases this skill actually
 * shaped, not which agents nominally bind it (D4, L06).
 */
export const TABS: readonly DetailTab[] = [
  { key: "config", labelKey: "detail.tabs.config", icon: "Settings" },
  { key: "preview", labelKey: "detail.tabs.preview", icon: "Eye" },
  { key: "context", labelKey: "detail.tabs.context", icon: "FileText" },
  { key: "stats", labelKey: "detail.tabs.stats", icon: "BarChart" },
  { key: "evals", labelKey: "detail.tabs.evals", icon: "Gauge" },
  { key: "versions", labelKey: "detail.tabs.versions", icon: "History" },
];

export const VALID_TABS: readonly string[] = TABS.map((t) => t.key);
