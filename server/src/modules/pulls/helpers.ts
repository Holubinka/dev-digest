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
   * The PR's latest `kind='review'`, or undefined if it has none.
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
