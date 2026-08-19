import { SIZE_MEDIUM_MAX, SIZE_SMALL_MAX, type PrMeta, type SizeInfo } from "./constants";

/** Bucket a PR into S/M/L by total changed lines. */
export function sizeOf(pr: PrMeta): SizeInfo {
  const lines = pr.additions + pr.deletions;
  const size = lines < SIZE_SMALL_MAX ? "S" : lines < SIZE_MEDIUM_MAX ? "M" : "L";
  return { size, lines };
}

// `relativeTime` moved to `@/lib/relative-time` when the Onboarding Tour header
// became its second consumer. `sizeOf` stays: a PR's S/M/L bucket is this
// route's own idea and has no reader anywhere else.
