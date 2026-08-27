/**
 * The eight columns AC-79 fixes, in display order, keyed under `runs.table`.
 *
 * Eight, and no ninth: `CiRunStatus` (a run's own state) is NOT one of them —
 * AC-79 lists the review verdict instead, and the two answer different
 * questions. A skipped run therefore reaches this page as a row whose verdict
 * cell is empty.
 */
export const COLUMN_KEYS = [
  "repository",
  "pullRequest",
  "agent",
  "verdict",
  "findings",
  "cost",
  "duration",
  "job",
] as const;

/** The columns that carry a number or a link, and so are right-aligned. */
export const RIGHT_ALIGNED = new Set(["findings", "cost", "duration", "job"]);

/**
 * Grid template shared by the header row and every run row. The repository
 * takes what is left — it is the only value with no natural width, and the one
 * that may safely truncate.
 */
export const GRID = "1fr 104px 148px 132px 92px 96px 92px 64px";

/** Column gap, shared by the header row and the run rows. */
export const GRID_GAP = 12;

/** Placeholder rows while the first poll is in flight. */
export const SKELETON_ROWS = 4;
