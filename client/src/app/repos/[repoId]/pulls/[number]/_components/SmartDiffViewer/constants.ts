/** Constants for SmartDiffViewer. */

/**
 * Widest finding range that is expanded line by line.
 *
 * Mirrors `server/src/modules/smart-diff/constants.ts`, and is a SEPARATE
 * exposure rather than a duplicate: these findings arrive from `usePrReviews`,
 * not from the smart-diff endpoint, and `lib/api.ts` validates no response — so
 * `start_line`/`end_line` land here exactly as the model wrote them and the DB
 * clamped them. The expansion runs in a `useMemo` during render, so an
 * unbounded one throws inside render and takes the whole PR detail route down.
 *
 * Past this width the finding is marked on its start line alone.
 */
export const MAX_FINDING_LINE_SPAN = 200;
