import type { IconName } from "@devdigest/ui";

/** Editor tab descriptor. `labelKey` resolves under the `agents` namespace. */
export interface EditorTab {
  key: string;
  labelKey: string;
  icon: IconName;
}

/** Editor tabs. Evals and Stats arrive with the lessons that fill them. */
export const TABS: readonly EditorTab[] = [
  { key: "config", labelKey: "editor.tabs.config", icon: "Settings" },
  { key: "skills", labelKey: "editor.tabs.skills", icon: "Sparkles" },
  { key: "context", labelKey: "editor.tabs.context", icon: "FileText" },
  { key: "ci", labelKey: "editor.tabs.ci", icon: "Workflow" },
];

/** What `?tab=` accepts. Derived, so the route cannot drift from the tab bar. */
export const VALID_TABS: readonly string[] = TABS.map((t) => t.key);
