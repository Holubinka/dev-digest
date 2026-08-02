import { eq, inArray } from 'drizzle-orm';
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

export class PullsRepository {
  constructor(private db: Db) {}

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
