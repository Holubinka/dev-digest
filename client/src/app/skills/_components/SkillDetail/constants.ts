import type { IconName } from "@devdigest/ui";

export interface DetailTab {
  key: string;
  labelKey: string;
  icon: IconName;
}

/**
 * Detail tabs. Evals is absent on purpose — the `eval` tables are provisioned
 * and empty until a later lesson, and a tab that can only render zeros is worse
 * than no tab. Stats is here because every number it shows is derived from rows
 * that already exist: bindings, runs, and accepted/dismissed findings.
 */
export const TABS: readonly DetailTab[] = [
  { key: "config", labelKey: "detail.tabs.config", icon: "Settings" },
  { key: "preview", labelKey: "detail.tabs.preview", icon: "Eye" },
  { key: "stats", labelKey: "detail.tabs.stats", icon: "BarChart" },
  { key: "versions", labelKey: "detail.tabs.versions", icon: "History" },
];

export const VALID_TABS: readonly string[] = TABS.map((t) => t.key);
