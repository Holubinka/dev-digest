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
      // `key: "eval"` is not a free choice: `activeKeyFor()` already returns
      // "eval" for a path starting `/eval`, and `messages/en/shell.json` already
      // holds `nav.eval` — the sidebar label is `t(`nav.${it.key}`)`, so any
      // other key renders an untranslated row AND leaves it unhighlighted on its
      // own screen. `g e` because p, o, d, s, a, c and , are taken. It sits last
      // in SKILLS LAB because the mockup fixes that order
      // (`specs/assets/SPEC-05-eval-pipeline-dashboard-all-agents.png`), and
      // this array is the order the sidebar renders in.
      { key: "eval", label: "Eval Dashboard", icon: "Gauge", href: "/evals", gKey: "e" },
    ],
  },
  {
    // GLOBAL carries ONE row, not the four the mockup draws
    // (`specs/assets/SPEC-05-multi-agent-review-configure-run.png` also shows
    // Memory, Agent Performance and CI Runs). AC-90 asks for the single row and
    // SPEC-05 § N7 puts the other three out of scope — they lead nowhere yet.
    section: "GLOBAL",
    items: [
      // `key: "multi-agent"` is not a free choice: `activeKeyFor()`
      // (`components/app-shell/helpers.ts:29`) already returns "multi-agent" for
      // any /multi-agent path and `messages/en/shell.json` already holds
      // `nav.multi-agent`, while the sidebar label is `t(`nav.${it.key}`)`. Any
      // other key renders an untranslated row that never lights (AC-91). `g m`
      // because p, o, d, s, a, c and , are taken.
      { key: "multi-agent", label: "Multi-Agent Review", icon: "Users", href: "/repos/:repoId/multi-agent", gKey: "m" },
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
  { keys: "g m", label: "Go to Multi-Agent Review", group: "Navigation" },
  { keys: "g e", label: "Go to Eval Dashboard", group: "Navigation" },
  { keys: "j / k", label: "Next / previous finding", group: "Findings" },
  { keys: "a", label: "Accept finding", group: "Findings" },
  { keys: "d", label: "Dismiss finding", group: "Findings" },
];

/** Resolve an :repoId-templated href against the active repo id. */
export function resolveHref(href: string, repoId: string | null | undefined): string {
  if (!href.includes(":repoId")) return href;
  return href.replace(":repoId", repoId ?? "_");
}
