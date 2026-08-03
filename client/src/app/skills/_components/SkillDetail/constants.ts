import type { IconName } from "@devdigest/ui";

export interface DetailTab {
  key: string;
  labelKey: string;
  icon: IconName;
}

/**
 * Detail tabs. Evals and Stats belong to a later lesson — the `eval` tables are
 * provisioned and empty by design, and a tab that can only ever show zeros is
 * worse than no tab.
 */
export const TABS: readonly DetailTab[] = [
  { key: "config", labelKey: "detail.tabs.config", icon: "Settings" },
  { key: "preview", labelKey: "detail.tabs.preview", icon: "Eye" },
  { key: "versions", labelKey: "detail.tabs.versions", icon: "History" },
];

export const VALID_TABS: readonly string[] = TABS.map((t) => t.key);
