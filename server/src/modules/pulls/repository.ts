import { desc, eq, inArray } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

/**
 * F1 — pulls data-access. Drizzle only: rows out, no DTOs, no policy.
 *
 * The PR list computes its rollups on read (see `INSIGHTS.md`, "Rollups on
 * GET /repos/:id/pulls are read-time maps"), so each rollup is one `inArray`
 * query over the page's PR ids that the caller groups in JS. This class owns
 * those queries; the grouping and the null-vs-zero distinction stay with the
 * caller, which is the only layer that knows which PRs were ever reviewed.
 */

/**
 * One finding as the PR list's rollup needs it: the columns `rollupSeverities`
 * and `topFindings` read, plus the `pr_id` carried over from the review the
 * finding hangs off. Findings have no `pr_id` of their own — the join is how a
 * finding reaches a PR.
 */
export interface PrListFindingRow {
  prId: string;
  id: string;
  severity: string;
  category: string;
  title: string;
  file: string;
  startLine: number;
  endLine: number;
  confidence: number;
  rationale: string;
}

/**
 * One review as the PR list's rollup needs it. `kind` rides along because the
 * caller reads the two columns for different things off the same pass: SCORE is
 * the latest `kind='review'`, while "has this PR ever been reviewed at all" —
 * what separates a reviewed-and-clean `0 · 0 · 0` from a never-reviewed `—` in
 * the FINDINGS column — counts every kind.
 */
export interface PrListReviewRow {
  prId: string;
  score: number | null;
  kind: 'summary' | 'review';
}

export class PullsRepository {
  constructor(private db: Db) {}

  /**
   * Reviews for a page of PRs, newest first, across every review kind.
   *
   * The ordering is load-bearing and belongs with the query: the caller walks
   * the rows once and takes the FIRST it sees per PR as that PR's latest
   * review. Dropping the `ORDER BY` would silently hand it whatever order
   * Postgres felt like returning.
   *
   * No `kind` predicate — filtering happens in the caller, which needs both the
   * narrow set (score) and the wide one (ever-reviewed) out of one query.
   */
  async reviewsForPrs(prIds: string[]): Promise<PrListReviewRow[]> {
    if (prIds.length === 0) return [];
    return this.db
      .select({ prId: t.reviews.prId, score: t.reviews.score, kind: t.reviews.kind })
      .from(t.reviews)
      .where(inArray(t.reviews.prId, prIds))
      .orderBy(desc(t.reviews.createdAt));
  }

  /**
   * Findings for a page of PRs, across EVERY review of each PR and every review
   * kind — the PR detail page tallies the same way (`review.repo.ts` filters by
   * `pr_id` alone), and a narrower filter here would let the list and the page
   * it links to disagree.
   *
   * Unordered: the caller ranks what it previews (`topFindings` sorts by
   * severity, then confidence, then id).
   */
  async findingsForPrs(prIds: string[]): Promise<PrListFindingRow[]> {
    if (prIds.length === 0) return [];
    return this.db
      .select({
        prId: t.reviews.prId,
        id: t.findings.id,
        severity: t.findings.severity,
        category: t.findings.category,
        title: t.findings.title,
        file: t.findings.file,
        startLine: t.findings.startLine,
        endLine: t.findings.endLine,
        confidence: t.findings.confidence,
        rationale: t.findings.rationale,
      })
      .from(t.findings)
      .innerJoin(t.reviews, eq(t.reviews.id, t.findings.reviewId))
      .where(inArray(t.reviews.prId, prIds));
  }
}
