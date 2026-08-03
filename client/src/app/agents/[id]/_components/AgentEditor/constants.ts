import type { IconName } from "@devdigest/ui";

/** Editor tab descriptor. `labelKey` resolves under the `agents` namespace. */
export interface EditorTab {
  key: string;
  labelKey: string;
  icon: IconName;
}

/** Editor tabs. Evals, Stats and CI arrive with the lessons that fill them. */
export const TABS: readonly EditorTab[] = [
  { key: "config", labelKey: "editor.tabs.config", icon: "Settings" },
  { key: "skills", labelKey: "editor.tabs.skills", icon: "Sparkles" },
];

/** What `?tab=` accepts. Derived, so the route cannot drift from the tab bar. */
export const VALID_TABS: readonly string[] = TABS.map((t) => t.key);
