import type { CiFailOn } from "@devdigest/shared";
import type { IconName } from "@devdigest/ui";
import type { CiUnconfirmedReason } from "@/lib/types";

/**
 * The three options the `Fail CI on` control offers (AC-87), in the mockup's
 * order (`SPEC-05-export-to-ci-mockup.jsx` → `FAIL_OPTS`).
 *
 * `CiFailOn` has a fourth value, `any`. It is deliberately NOT here: AC-101
 * forbids the tab ever sending it, and typing the array as
 * `Exclude<CiFailOn, "any">` is what makes that a compile error rather than a
 * habit. A stored `any` is shown by name instead (AC-102).
 */
export const FAIL_ON_OPTIONS: readonly Exclude<CiFailOn, "any">[] = [
  "critical",
  "warning",
  "never",
];

/** Badge colour per last-run status. Anything unrecognised reads as muted. */
export const RUN_STATUS_COLOR: Record<string, { color: string; bg: string }> = {
  succeeded: { color: "var(--ok)", bg: "var(--ok-bg)" },
  no_findings: { color: "var(--ok)", bg: "var(--ok-bg)" },
  failed: { color: "var(--crit)", bg: "var(--crit-bg)" },
  running: { color: "var(--info)", bg: "var(--info-bg)" },
  skipped: { color: "var(--text-muted)", bg: "var(--bg-hover)" },
};

/**
 * How each reason an installation is unconfirmed is badged (AC-147…AC-149).
 *
 * `never_polled` is MUTED and the other two are WARN, because they are different
 * kinds of news: nothing has been checked yet, versus something was checked and
 * came back wrong. Every one of them carries a text label as well, so the colour
 * is never the only thing saying it.
 */
export const UNCONFIRMED_BADGE: Record<
  CiUnconfirmedReason,
  { color: string; bg: string; icon: IconName }
> = {
  never_polled: { color: "var(--text-muted)", bg: "var(--bg-hover)", icon: "Clock" },
  workflow_missing: { color: "var(--warn)", bg: "var(--warn-bg)", icon: "AlertTriangle" },
  other_agent: { color: "var(--warn)", bg: "var(--warn-bg)", icon: "AlertTriangle" },
};

/** Placeholder rows while the installations are loading. */
export const SKELETON_ROWS = 3;
