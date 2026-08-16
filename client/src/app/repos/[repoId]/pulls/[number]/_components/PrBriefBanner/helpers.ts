/* Which review the banner speaks for. Pure, and tested on its own: a component
   test cannot tell a deterministic pick from a lucky one. */

/* `ReviewRecord` is one of the names `@/lib/types` does not re-export, so it
   comes from the vendored contract directly — the same way
   `ReviewRunAccordion.tsx` next door takes it. */
import type { ReviewRecord } from "@devdigest/shared";

/**
 * Which state of the PR a review describes, normalised.
 *
 * `?? null` rather than a bare read, and it is not defensive noise: the client
 * validates no response at runtime (`client/AGENTS.md`), so before the server
 * side of this feature ships — or against any older API — the field arrives as
 * `undefined`, not as the `null` the contract promises. Left unnormalised, a
 * test whose fixture says `null` and a browser whose response says `undefined`
 * would take different branches of every comparison below.
 */
export const reviewHead = (review: ReviewRecord): string | null => review.head_sha ?? null;

/** A review that actually produced a verdict — a run that failed produced none. */
const isCompleted = (review: ReviewRecord): boolean => review.verdict != null;

const at = (review: ReviewRecord): number => {
  const ms = Date.parse(review.created_at);
  return Number.isNaN(ms) ? 0 : ms;
};

/**
 * Newest first, ties broken by `id` ASCENDING.
 *
 * The API already returns reviews newest-first (`review.repo.ts` orders by
 * `created_at` descending), but the banner must not rest on an order it does not
 * state: two agents can finish inside the same `now()`, and an incidental order
 * would show a different one of them between two loads with no test failing.
 * The id tie-break is what makes the pick reproducible rather than merely
 * usually-stable.
 */
export function byNewestThenId(a: ReviewRecord, b: ReviewRecord): number {
  const diff = at(b) - at(a);
  if (diff !== 0) return diff;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

/**
 * The completed review for THIS state of the PR, or null.
 *
 * A `head_sha` of `null` is "the row was written before that column existed", so
 * it is never this state — treating it as the current head would make every
 * historical review a review of whatever is checked out now (AC-69). A null
 * `headSha` on the PR side means we do not know which state is current, so
 * nothing can match it either.
 */
export function pickReviewForHead(
  reviews: ReviewRecord[],
  headSha: string | null,
): ReviewRecord | null {
  if (headSha == null) return null;
  const candidates = reviews.filter((r) => isCompleted(r) && reviewHead(r) === headSha);
  if (candidates.length === 0) return null;
  // A copy: `sort` mutates, and the array here is TanStack's cached response.
  return [...candidates].sort(byNewestThenId)[0] ?? null;
}

/**
 * Whether a completed review exists for some OTHER state of the pull request —
 * what turns "not reviewed" into "reviewed, but not this state" (AC-75).
 */
export function hasReviewForOtherState(reviews: ReviewRecord[], headSha: string | null): boolean {
  return reviews.some((r) => isCompleted(r) && reviewHead(r) !== headSha);
}
