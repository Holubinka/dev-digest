import type { PrMeta } from "../../../../lib/types";

/** Constants for the PR list page (/repos/:repoId/pulls). */

/**
 * Review status → colour token + i18n label key (under `list.status`). Open PRs
 * carry a derived review status (needs_review / reviewed / stale); merged/closed
 * keep their GitHub merge state.
 */
export const STATUS_META: Record<string, { c: string; labelKey: string }> = {
  needs_review: { c: "var(--warn)", labelKey: "needs_review" },
  reviewed: { c: "var(--ok)", labelKey: "reviewed" },
  stale: { c: "var(--stale)", labelKey: "stale" },
  open: { c: "var(--warn)", labelKey: "open" },
  merged: { c: "var(--ok)", labelKey: "merged" },
  closed: { c: "var(--stale)", labelKey: "closed" },
};

/** Size bucket → colour token. */
export const SIZE_COLOR: Record<string, string> = {
  S: "var(--ok)",
  M: "var(--warn)",
  L: "var(--crit)",
};

/**
 * Grid template for both the header row and PR rows. The title takes what is
 * left, so every fixed column is sized to its content and no wider — adding
 * FINDINGS cost the title 100px and it truncates first on a narrow window.
 */
export const GRID = "1fr 104px 84px 56px 96px 108px 68px 70px";

/** Column gap, shared by the header row and the PR rows. */
export const GRID_GAP = 12;

/**
 * The FINDINGS column, worst severity first: which `PrMeta` count feeds each
 * chip. Typed against `PrMeta` so a contract rename breaks the build here
 * rather than rendering `undefined` in the browser.
 */
export const FINDINGS_FIELDS = [
  { sev: "CRITICAL", field: "findings_critical" },
  { sev: "WARNING", field: "findings_warning" },
  { sev: "SUGGESTION", field: "findings_suggestion" },
] as const satisfies readonly { sev: string; field: keyof PrMeta }[];

/** Line-count thresholds for the S/M/L size bucket. */
export const SIZE_SMALL_MAX = 100;
export const SIZE_MEDIUM_MAX = 400;

/** Filter chips: status key + i18n label key (under `list.filter`). */
export const STATUS_FILTERS: { key: string; labelKey: string }[] = [
  { key: "all", labelKey: "all" },
  { key: "needs_review", labelKey: "needs_review" },
  { key: "reviewed", labelKey: "reviewed" },
  { key: "stale", labelKey: "stale" },
];

/** Column header i18n keys (under `list.columns`), in display order. */
export const COLUMN_KEYS: string[] = [
  "pullRequest",
  "author",
  "size",
  "score",
  "findings",
  "status",
  "cost",
  "updated",
];

/** Number of skeleton rows shown while loading. */
export const SKELETON_ROWS = 4;

export type PrSize = "S" | "M" | "L";
export type SizeInfo = { size: PrSize; lines: number };

/** Re-exported for helpers that consume PrMeta. */
export type { PrMeta };
