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
 * How much a verdict blocks a merge. Higher wins.
 *
 * `src/lib/api.ts` validates nothing at runtime, so the lookup is `Object.hasOwn`
 * with an explicit fallback rather than a bare index — `"constructor"` is a key
 * every object literal answers to (`client/INSIGHTS.md:594-618`). An unrecognised
 * verdict lands on `comment`, which is where `VerdictBanner` already renders it:
 * it is not evidence that the state is blocked, and it is not an approval either.
 */
/* THE SECOND COPY OF THIS TABLE is `server/src/modules/pulls/helpers.ts`, which
   the PR LIST ranks its score with. The two agreeing is what stops one PR
   carrying two numbers on two screens, so a change here is a change there. */
const BLOCKING_RANK: Record<string, number> = {
  request_changes: 2,
  comment: 1,
  approve: 0,
};

const blockingRank = (review: ReviewRecord): number => {
  const verdict = review.verdict ?? "";
  return Object.hasOwn(BLOCKING_RANK, verdict) ? BLOCKING_RANK[verdict]! : BLOCKING_RANK.comment!;
};

/**
 * Most blocking first; ties broken by `byNewestThenId`.
 *
 * The banner's question is "can this merge", and several agents can answer it
 * differently about the same state: Security returning `request_changes` and a
 * Docs agent returning `approve` minutes later is an ordinary multi-agent run
 * (`ReviewRunAccordion.tsx:3`). Presenting the NEWEST as the verdict of the state
 * would put **Approve · 0 blockers** at the top of the page while a blocking
 * review sat one tab away, so recency is the tie-break and never the rule.
 *
 * Nothing is summed or averaged across reviews: `score` and `blockers` belong to
 * one run, and mixing them produces a number no run produced.
 */
export function byMostBlockingThenNewest(a: ReviewRecord, b: ReviewRecord): number {
  const rank = blockingRank(b) - blockingRank(a);
  return rank !== 0 ? rank : byNewestThenId(a, b);
}

/**
 * Every completed review for THIS state of the PR, most blocking first.
 *
 * A `head_sha` of `null` is "the row was written before that column existed", so
 * it is never this state — treating it as the current head would make every
 * historical review a review of whatever is checked out now (AC-69). A null
 * `headSha` on the PR side means we do not know which state is current, so
 * nothing can match it either.
 *
 * `filter` already returns a new array, so the `sort` cannot touch TanStack's
 * cached response.
 */
export function reviewsForHead(reviews: ReviewRecord[], headSha: string | null): ReviewRecord[] {
  if (headSha == null) return [];
  return reviews
    .filter((r) => isCompleted(r) && reviewHead(r) === headSha)
    .sort(byMostBlockingThenNewest);
}

/**
 * The one review the banner speaks with, or null.
 *
 * It is one of several when several ran, which is why the banner also reports
 * HOW MANY stand behind it — a reader who sees one verdict has to be able to
 * tell that there were others.
 */
export function pickReviewForHead(
  reviews: ReviewRecord[],
  headSha: string | null,
): ReviewRecord | null {
  return reviewsForHead(reviews, headSha)[0] ?? null;
}

/**
 * Whether a completed review exists for some OTHER state of the pull request —
 * what turns "not reviewed" into "reviewed, but not this state" (AC-75).
 */
export function hasReviewForOtherState(reviews: ReviewRecord[], headSha: string | null): boolean {
  return reviews.some((r) => isCompleted(r) && reviewHead(r) !== headSha);
}
