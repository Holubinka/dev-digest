import type { PrStatus, ScoreState } from '@devdigest/shared';

/**
 * PR-list rollup helpers (pure — no DB / `this`, so they unit-test cleanly).
 *
 * The Pull Requests list shows, per PR: the latest review's SCORE, a FINDINGS
 * severity breakdown, and a review STATUS. The DB `status` column holds
 * GitHub's merge state (open/merged/closed); the review status
 * (needs_review / reviewed / stale) is DERIVED here for OPEN PRs from the
 * commit a review last ran against (`lastReviewedSha`) vs the PR head, plus age.
 * So is the SCORE's own state (`deriveScoreState`) — which commit the number
 * came from, which is a different column and a different question.
 */

/** Open PRs whose current head was reviewed but untouched this long read "stale". */
export const STALE_DAYS = 7;

export interface SeverityCounts {
  critical: number;
  warning: number;
  suggestion: number;
}

/** Tally finding severities (CRITICAL / WARNING / SUGGESTION) for one review. */
export function rollupSeverities(rows: { severity: string }[]): SeverityCounts {
  const c: SeverityCounts = { critical: 0, warning: 0, suggestion: 0 };
  for (const r of rows) {
    if (r.severity === 'CRITICAL') c.critical += 1;
    else if (r.severity === 'WARNING') c.warning += 1;
    else if (r.severity === 'SUGGESTION') c.suggestion += 1;
  }
  return c;
}

/**
 * Rank per severity for the list's hover card (lower = shown first).
 *
 * Membership is tested with `Object.hasOwn`, never `in`: this is a plain object
 * literal, so `in` walks `Object.prototype` and answers true for `constructor`,
 * `toString`, `valueOf`, `hasOwnProperty`, `__proto__`, `isPrototypeOf`,
 * `toLocaleString` and `propertyIsEnumerable`. `severity` is an unconstrained
 * `text` column filled from agent JSON, so any of them can reach here.
 */
const SEVERITY_RANK: Record<string, number> = { CRITICAL: 0, WARNING: 1, SUGGESTION: 2 };

/** Longest rationale the list payload carries per finding; the rest is elided. */
export const LIST_RATIONALE_CHARS = 200;

/** One finding as the PR list carries it — enough for a hover card, no more. */
export interface ListFinding {
  id: string;
  severity: string;
  category: string;
  title: string;
  file: string;
  start_line: number;
  end_line: number;
  confidence: number;
  rationale: string;
}

/**
 * Cut a string to `max` CODE POINTS, not UTF-16 units: `String.slice` counts
 * units, so a boundary inside an astral character (emoji, and anything else
 * outside the BMP) leaves an orphaned surrogate in the JSON response.
 */
function truncateChars(text: string, max: number): string {
  const chars = [...text];
  return chars.length > max ? `${chars.slice(0, max).join('')}…` : text;
}

/**
 * The `limit` findings worth previewing on the PR list: worst severity first,
 * then most confident, then by id. Severities outside the contract are dropped
 * rather than ranked last — the client maps severity to an icon with no fallback.
 *
 * The id breaks ties because the browser re-ranks. The list card opens on this
 * slice and swaps in the PR's full findings a moment later; the source query has
 * no ORDER BY and equal confidences are common, so without a total order those
 * rows reshuffle on screen. `rankFindings` in
 * `client/src/components/findings-preview/helpers.ts` sorts identically — change
 * one and the other has to follow.
 *
 * Rationales are truncated here, not in the browser: the list ships one payload
 * for every PR in the repo, and a few hundred findings' worth of markdown would
 * dwarf everything else on it.
 */
export function topFindings(
  rows: {
    id: string;
    severity: string;
    category: string;
    title: string;
    file: string;
    startLine: number;
    endLine: number;
    confidence: number;
    rationale: string;
  }[],
  limit: number,
): ListFinding[] {
  return rows
    .filter((r) => Object.hasOwn(SEVERITY_RANK, r.severity))
    .sort(
      (a, b) =>
        (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9) ||
        b.confidence - a.confidence ||
        a.id.localeCompare(b.id),
    )
    .slice(0, limit)
    .map((r) => ({
      id: r.id,
      severity: r.severity,
      category: r.category,
      title: r.title,
      file: r.file,
      start_line: r.startLine,
      end_line: r.endLine,
      confidence: r.confidence,
      rationale: truncateChars(r.rationale, LIST_RATIONALE_CHARS),
    }));
}

/**
 * Review-freshness status for the PR list. Merged/closed PRs keep their GitHub
 * merge state; open PRs map to:
 *  - `needs_review` — never reviewed, OR head moved since the last review
 *  - `stale`        — current head was reviewed but the PR is older than STALE_DAYS
 *  - `reviewed`     — current head reviewed and recent
 */
export function deriveReviewStatus(args: {
  /** DB `status` column = GitHub merge state (open/merged/closed). */
  ghStatus: string;
  lastReviewedSha: string | null;
  headSha: string;
  updatedAt: Date | null;
  now: number;
  staleDays?: number;
}): PrStatus {
  const { ghStatus, lastReviewedSha, headSha, updatedAt, now } = args;
  if (ghStatus === 'merged' || ghStatus === 'closed') return ghStatus as PrStatus;
  if (!lastReviewedSha || lastReviewedSha !== headSha) return 'needs_review';
  const staleMs = (args.staleDays ?? STALE_DAYS) * 86_400_000;
  if (updatedAt && now - updatedAt.getTime() > staleMs) return 'stale';
  return 'reviewed';
}

/**
 * Which state of the PR the list's SCORE describes.
 *
 * Not the same question as `deriveReviewStatus` above, and the two disagree on
 * purpose. That one reads `pull_requests.last_reviewed_sha` — "which state did
 * the newest completed RUN see" — and answers with the row's overall freshness.
 * This one reads the head of the review the score itself came from, because the
 * score is the number on screen and it is the number that has to be honest. A PR
 * can read `needs_review` while its score column shows 100 from a commit nobody
 * is looking at any more; that pair is what this makes visible.
 *
 * `reviewHeadSha` is the head of the review the score was taken from, NOT
 * "some review's head": if a PR has ten reviews and the newest ran on an old
 * commit, the marker belongs on that number even if an older row happens to
 * match the current head.
 *
 * A null or empty `reviewHeadSha` is `earlier`, never `current` — the column is
 * nullable only for rows written before it existed, and treating "unknown" as
 * "the state you are looking at" is precisely the promotion SPEC-02 AC-69
 * forbids on the PR page. The empty-string guard covers the PR side too, so two
 * blank shas cannot compare equal into a false `current`.
 */
export function deriveScoreState(args: {
  /** The head of the review the score came from, or undefined when there is none. */
  reviewHeadSha: string | null | undefined;
  /** The PR's current head. */
  headSha: string;
  /** False when no review supplied a score at all. */
  hasReview: boolean;
}): ScoreState {
  const { reviewHeadSha, headSha, hasReview } = args;
  if (!hasReview) return 'none';
  if (!reviewHeadSha || !headSha) return 'earlier';
  return reviewHeadSha === headSha ? 'current' : 'earlier';
}
