import type { PrDetail, PrMeta } from '@devdigest/shared';
import {
  deriveReviewStatus,
  deriveScoreState,
  type ListFinding,
  type SeverityCounts,
} from './status.js';

/**
 * F1 — pulls DTO mapping. Pure: no DB, no `this`, and no clock — `now` arrives
 * as a parameter so the mapping unit-tests without faking time.
 *
 * A `pull_requests` row is a schema shape and must not reach an HTTP response
 * unchanged; this is where it becomes the `PrMeta` the list endpoint promises.
 * It used to be written inline in `routes.ts`'s `rows.map`, which coupled the
 * wire format to the column names.
 */

/**
 * The `pull_requests` columns the list's DTO reads. Declared structurally rather
 * than as the Drizzle row type, so this file stays free of `db/` and the row
 * type stays inside the module (§3.5).
 */
export interface PrListRow {
  id: string;
  number: number;
  title: string;
  author: string;
  branch: string;
  base: string;
  headSha: string;
  lastReviewedSha: string | null;
  additions: number;
  deletions: number;
  filesCount: number;
  /** GitHub's merge state (open/merged/closed) — not the review status below. */
  status: string;
  openedAt: Date | null;
  updatedAt: Date | null;
}

/** The rollups the list computes per PR, each already grouped by the caller. */
export interface PrRollups {
  /**
   * The `kind='review'` this PR's score speaks for — `pickListReview`'s answer,
   * or undefined if the PR has none.
   *
   * NOT "the latest". That was the older rule and it disagreed with the PR page
   * off the same rows: several agents answer one state differently, and the
   * newest of them is not the one that decides whether the state is blocked.
   *
   * `headSha` rides along with the score because the two are only meaningful
   * together: the number answers "how did it score", the head answers "which
   * state scored that", and shipping the first without the second is what let
   * the list show a stranger's number as this PR's current one.
   */
  review: { score: number | null; headSha: string | null } | undefined;
  /** Every run's cost summed; null when no run ever priced anything. */
  costUsd: number | null;
  /**
   * Severity counts and the hover-card preview — undefined for a PR that has
   * never been reviewed.
   *
   * The undefined-vs-zeros distinction is the whole reason this is not a plain
   * `SeverityCounts`: a reviewed-and-clean PR serialises zeros and renders
   * `0 · 0 · 0`, a never-reviewed one serialises null and renders `—`.
   * Collapsing them loses information the UI acts on.
   */
  findings: { counts: SeverityCounts; top: ListFinding[] } | undefined;
}

/**
 * One `reviews` row as the score pick reads it.
 *
 * Structural, like `PrListRow` above and for the same reason: this file stays
 * free of `db/`, and `repository.ts`'s `PrListReviewRow` satisfies it by shape.
 */
export interface ListReviewCandidate {
  score: number | null;
  headSha: string | null;
  verdict: string | null;
  createdAt: Date;
  id: string;
}

/**
 * How much a verdict blocks a merge. Higher wins.
 *
 * THE SECOND COPY OF THIS TABLE. The first is
 * `client/src/app/repos/[repoId]/pulls/[number]/_components/PrBriefBanner/helpers.ts`,
 * which is what the PR page's banner ranks with — and the two agreeing is the
 * entire point of this function, so a change to either is a change to both.
 * They are apart because one ranks rows out of Postgres and the other ranks a
 * validated `ReviewRecord`; nothing in `vendor/shared` holds behaviour today.
 *
 * `Object.hasOwn` rather than a bare index: `reviews.verdict` is `text` with no
 * enum (`db/schema/reviews.ts:40`), so the column can hold `constructor`, which
 * every object literal answers to. An unrecognised verdict ranks as `comment` —
 * it is not evidence the state is blocked, and it is not an approval either.
 */
const BLOCKING_RANK: Record<string, number> = {
  request_changes: 2,
  comment: 1,
  approve: 0,
};

const blockingRank = (review: ListReviewCandidate): number => {
  const verdict = review.verdict ?? '';
  return Object.hasOwn(BLOCKING_RANK, verdict) ? BLOCKING_RANK[verdict]! : BLOCKING_RANK.comment!;
};

/** Newest first, ties broken by `id` ascending — a total order over any two rows. */
function byNewestThenId(a: ListReviewCandidate, b: ListReviewCandidate): number {
  const age = b.createdAt.getTime() - a.createdAt.getTime();
  if (age !== 0) return age;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

/** Most blocking first, recency only as the tie-break. */
function byMostBlockingThenNewest(a: ListReviewCandidate, b: ListReviewCandidate): number {
  const rank = blockingRank(b) - blockingRank(a);
  return rank !== 0 ? rank : byNewestThenId(a, b);
}

/**
 * Which review the list's SCORE column speaks for.
 *
 * Two decisions, and they are deliberately answered by different questions:
 *
 * **Which state** is a recency question. The current one when any review
 * describes it, otherwise the most recently reviewed one — the list, unlike the
 * banner, keeps showing an earlier state's number and marks it (`score_state`),
 * because scanning a page of PRs is a different job from deciding whether one
 * of them can merge.
 *
 * **Which review of that state** is a blocking question, and this is where the
 * list used to differ from the page: three agents answering the same commit
 * 100 / 60 / 80 gave the list the newest and the banner the most blocking, so
 * one PR carried two numbers on two screens. Ranking runs from DIFFERENT states
 * against each other would be worse than either — a `request_changes` from three
 * commits ago would outrank an `approve` on the commit in front of the reader —
 * which is why the state is settled first and the rank applies only within it.
 *
 * Nothing is summed or averaged: `score` belongs to one run, and mixing them
 * produces a number no run produced.
 */
export function pickListReview(
  candidates: ListReviewCandidate[],
  prHeadSha: string | null,
): { score: number | null; headSha: string | null } | undefined {
  if (candidates.length === 0) return undefined;
  // The spread is load-bearing HERE and nowhere else in this function: `sort`
  // mutates, and `candidates` is a slice of the caller's grouping map. The
  // second chain needs none, because `filter` already returns a new array.
  const state = candidates.some((c) => c.headSha === prHeadSha)
    ? prHeadSha
    : [...candidates].sort(byNewestThenId)[0]!.headSha;
  // A KNOWN state's reviews all describe one commit, so the most blocking of
  // them is that commit's answer. Rows with no head describe unknown and
  // possibly DIFFERENT commits — `head_sha` was added late and nothing
  // backfilled it — so ranking those against each other would put a
  // `request_changes` from three weeks ago over today's `approve` and call it
  // this PR's score. Measured on live data 2026-08-17, not hypothetical: 69 of
  // PR #7's 69 reviews carry `head_sha = NULL`, spanning the whole branch.
  // For them the newest is the only defensible pick, and it is what the list
  // already showed.
  const ranked = state ? byMostBlockingThenNewest : byNewestThenId;
  const pick = candidates.filter((c) => c.headSha === state).sort(ranked)[0]!;
  return { score: pick.score, headSha: pick.headSha };
}

/**
 * One `pull_requests` row plus its rollups as the list endpoint ships it.
 *
 * `status` is derived here, not read: the column holds GitHub's merge state,
 * while the list shows review freshness (needs_review / reviewed / stale).
 */
export function toPrMeta(row: PrListRow, rollups: PrRollups, now: number): PrMeta {
  const { review, costUsd, findings } = rollups;
  return {
    id: row.id,
    number: row.number,
    title: row.title,
    author: row.author,
    branch: row.branch,
    base: row.base,
    head_sha: row.headSha,
    additions: row.additions,
    deletions: row.deletions,
    files_count: row.filesCount,
    status: deriveReviewStatus({
      ghStatus: row.status,
      lastReviewedSha: row.lastReviewedSha,
      headSha: row.headSha,
      updatedAt: row.updatedAt,
      now,
    }),
    opened_at: row.openedAt?.toISOString() ?? null,
    updated_at: row.updatedAt?.toISOString() ?? null,
    score: review ? review.score : null,
    score_state: deriveScoreState({
      reviewHeadSha: review?.headSha,
      headSha: row.headSha,
      hasReview: review !== undefined,
    }),
    cost_usd: costUsd,
    findings_critical: findings ? findings.counts.critical : null,
    findings_warning: findings ? findings.counts.warning : null,
    findings_suggestion: findings ? findings.counts.suggestion : null,
    findings_top: findings ? findings.top : null,
  };
}

/**
 * The extra `pull_requests` columns the detail DTO reads. Same table as
 * `PrListRow`, so it extends it rather than restating fourteen fields.
 */
export interface PrDetailRow extends PrListRow {
  body: string | null;
  linkedIssue: PrDetail['linked_issue'];
}

/** The `pr_files` columns the detail DTO reads. */
export interface PrFileRow {
  path: string;
  additions: number;
  deletions: number;
  patch: string | null;
}

/** The `pr_commits` columns the detail DTO reads. */
export interface PrCommitRow {
  sha: string;
  message: string;
  author: string;
  committedAt: Date | null;
}

/**
 * A PR and its persisted files and commits as the detail endpoint ships them.
 *
 * This is the offline path: `GET /pulls/:id` serves it when GitHub is
 * unreachable or no token is configured, which makes it the only branch of that
 * route a hermetic test can reach — and the reason it is worth having out here
 * rather than inline in the handler's `catch`.
 *
 * `status` is passed through, unlike `toPrMeta`'s: detail reports GitHub's
 * merge state, the list reports review freshness. They are different fields
 * that happen to share a column.
 */
export function toPrDetail(row: PrDetailRow, files: PrFileRow[], commits: PrCommitRow[]): PrDetail {
  return {
    id: row.id,
    number: row.number,
    title: row.title,
    author: row.author,
    branch: row.branch,
    base: row.base,
    head_sha: row.headSha,
    additions: row.additions,
    deletions: row.deletions,
    files_count: row.filesCount,
    status: row.status as PrDetail['status'],
    opened_at: row.openedAt?.toISOString() ?? null,
    updated_at: row.updatedAt?.toISOString() ?? null,
    body: row.body ?? null,
    files: files.map((f) => ({
      path: f.path,
      additions: f.additions,
      deletions: f.deletions,
      patch: f.patch ?? null,
    })),
    commits: commits.map((c) => ({
      sha: c.sha,
      message: c.message,
      author: c.author,
      committed_at: c.committedAt?.toISOString() ?? null,
    })),
    linked_issue: row.linkedIssue ?? null,
  };
}
