/** Pure helpers for AppShell. */

import type { RepoSummary } from "@devdigest/ui";
import type { Repo } from "../../lib/types";

/** Map a lib `Repo` to the `RepoSummary` shape the AppFrame shell context expects. */
export function toShellRepo(r: Repo): RepoSummary {
  return {
    id: r.id,
    full_name: r.full_name,
    default_branch: r.default_branch,
    syncedLabel: r.last_polled_at ? "synced" : "not synced",
  };
}

/** Whether an event target is a text-entry element (guards typing-aware shortcuts). */
export function isTextInput(el: EventTarget | null): boolean {
  const node = el as HTMLElement | null;
  return (
    !!node &&
    (node.tagName === "INPUT" || node.tagName === "TEXTAREA" || node.isContentEditable)
  );
}

/** Derive the active sidebar key from the current pathname. */
export function activeKeyFor(pathname: string): string {
  if (pathname.startsWith("/settings")) return "settings";
  if (pathname.includes("/multi-agent")) return "multi-agent";
  // Only the REPO-SCOPED tour, never the plain `/onboarding` add-repository
  // screen. A bare `includes("/onboarding")` lit the Onboarding Tour row on
  // that screen the moment a NAV row claimed the key — a behaviour change on a
  // route this feature is required to leave alone (SPEC-03 § AC-8), and the
  // e2e flow `06-onboarding.flow.json` is what would have found it.
  if (/^\/repos\/[^/]+\/onboarding/.test(pathname)) return "onboarding-tour";
  if (pathname.includes("/context")) return "context";
  if (pathname.includes("/conventions")) return "conventions";
  if (pathname.includes("/pulls")) return "pulls";
  if (pathname.startsWith("/skills")) return "skills";
  if (pathname.startsWith("/agents")) return "agents";
  if (pathname.startsWith("/eval")) return "eval";
  if (pathname.startsWith("/memory")) return "memory";
  if (pathname.startsWith("/agent-performance")) return "agent-performance";
  if (pathname.startsWith("/ci-runs")) return "ci-runs";
  return "";
}
