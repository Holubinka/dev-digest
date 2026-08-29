import type { IconName } from "@devdigest/ui";

/** Editor tab descriptor. `labelKey` resolves under the `agents` namespace. */
export interface EditorTab {
  key: string;
  labelKey: string;
  icon: IconName;
}

/**
 * Editor tabs. Stats arrived with SPEC-07 and sits last: it reports on runs the
 * other five tabs configure, so it reads after them rather than before.
 */
export const TABS: readonly EditorTab[] = [
  { key: "config", labelKey: "editor.tabs.config", icon: "Settings" },
  { key: "skills", labelKey: "editor.tabs.skills", icon: "Sparkles" },
  { key: "context", labelKey: "editor.tabs.context", icon: "FileText" },
  { key: "evals", labelKey: "editor.tabs.evals", icon: "FlaskConical" },
  { key: "ci", labelKey: "editor.tabs.ci", icon: "Workflow" },
  { key: "stats", labelKey: "editor.tabs.stats", icon: "Activity" },
];

/** What `?tab=` accepts. Derived, so the route cannot drift from the tab bar. */
export const VALID_TABS: readonly string[] = TABS.map((t) => t.key);
