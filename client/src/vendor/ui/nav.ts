/* nav.ts — sidebar nav groups + keyboard shortcut registry.
   hrefs use :repoId token; the web app fills it from the active repo. */
import type { IconName } from "./icons";

export interface NavItemDef {
  key: string;
  label: string;
  icon: IconName;
  /** Route template; :repoId is replaced with the active repo id by the app. */
  href: string;
  /** Optional g-nav shortcut suffix (e.g. "p" → g then p). */
  gKey?: string;
  badge?: string;
}

export interface NavGroup {
  section: string;
  items: NavItemDef[];
}

export const NAV: NavGroup[] = [
  {
    section: "WORKSPACE",
    items: [
      { key: "pulls", label: "Pull Requests", icon: "GitPullRequest", href: "/repos/:repoId/pulls", gKey: "p" },
      // `key: "onboarding-tour"` is not a free choice either: `messages/en/shell.json`
      // already holds `nav.onboarding-tour`, and the sidebar label is
      // `t(`nav.${it.key}`)` — any other key renders an untranslated row. `g o`
      // because p, d, s, a, c and , are taken. It sits between Pull Requests and
      // Project Context because the mockup fixes that order
      // (`specs/assets/SPEC-03-onboarding-tour.png`), and this array is the order
      // the sidebar renders in.
      { key: "onboarding-tour", label: "Onboarding Tour", icon: "Workflow", href: "/repos/:repoId/onboarding", gKey: "o" },
      // `key: "context"` is not a free choice: `activeKeyFor()` already returns
      // "context" for a /context path and `messages/en/shell.json` already holds
      // `nav.context`. `g d` because p, s, a, c and , are taken — and `c` is the
      // easy collision, since it is Conventions.
      { key: "context", label: "Project Context", icon: "FileText", href: "/repos/:repoId/context", gKey: "d" },
    ],
  },
  {
    section: "SKILLS LAB",
    items: [
      { key: "skills", label: "Skills", icon: "Sparkles", href: "/skills", gKey: "s" },
      { key: "agents", label: "Agents", icon: "Cpu", href: "/agents", gKey: "a" },
      { key: "conventions", label: "Conventions", icon: "ListChecks", href: "/repos/:repoId/conventions", gKey: "c" },
    ],
  },
];

export const SETTINGS_ITEM: NavItemDef = {
  key: "settings",
  label: "Settings",
  icon: "Settings",
  href: "/settings/api-keys",
  gKey: ",",
};

export const SETTINGS_SECTIONS = [
  { key: "api-keys", label: "API Keys" },
  { key: "models", label: "Feature Models" },
  { key: "project-context", label: "Project Context" },
] as const;

/**
 * Keyboard shortcut registry. Wiring is finalized by A6.
 *
 * NOT derived from `NAV.items[].gKey` — it is hand-maintained, and
 * `ShortcutsHelp.tsx` renders it in the `?` modal. Adding a row to `NAV` alone
 * gives you a shortcut that works and never appears in the help; every nav row
 * with a `gKey` needs an entry here too.
 */
export interface ShortcutDef {
  keys: string;
  label: string;
  group: "Navigation" | "Findings" | "Actions" | "Global";
}

export const SHORTCUTS: ShortcutDef[] = [
  { keys: "⌘K", label: "Open command palette", group: "Global" },
  { keys: "?", label: "Show keyboard shortcuts", group: "Global" },
  { keys: "g p", label: "Go to Pull Requests", group: "Navigation" },
  { keys: "g o", label: "Go to Onboarding Tour", group: "Navigation" },
  { keys: "g d", label: "Go to Project Context", group: "Navigation" },
  { keys: "g s", label: "Go to Skills", group: "Navigation" },
  { keys: "g a", label: "Go to Agents", group: "Navigation" },
  { keys: "g c", label: "Go to Conventions", group: "Navigation" },
  { keys: "j / k", label: "Next / previous finding", group: "Findings" },
  { keys: "a", label: "Accept finding", group: "Findings" },
  { keys: "d", label: "Dismiss finding", group: "Findings" },
];

/** Resolve an :repoId-templated href against the active repo id. */
export function resolveHref(href: string, repoId: string | null | undefined): string {
  if (!href.includes(":repoId")) return href;
  return href.replace(":repoId", repoId ?? "_");
}
