import { and, eq, isNull } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { FindingRange, SmartDiffInputFile } from './helpers.js';

/**
 * Smart Diff data-access. Drizzle only: rows out, no DTOs, no policy.
 *
 * Both reads are keyed by `pr_id` alone. The caller has already resolved that id
 * through the workspace, which is the tenancy check — see `routes.ts`.
 */
export class SmartDiffRepository {
  constructor(private db: Db) {}

  /** Returns `null` when the PR does not exist in this workspace. */
  async findPullInWorkspace(workspaceId: string, prId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ id: t.pullRequests.id })
      .from(t.pullRequests)
      .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.id, prId)));
    return row?.id ?? null;
  }

  async filesForPull(prId: string): Promise<SmartDiffInputFile[]> {
    return this.db
      .select({
        path: t.prFiles.path,
        additions: t.prFiles.additions,
        deletions: t.prFiles.deletions,
      })
      .from(t.prFiles)
      .where(eq(t.prFiles.prId, prId));
  }

  /**
   * Cited ranges from EVERY review of this PR, dismissed findings excluded.
   *
   * Not "the newest review only": the PR detail page tallies findings across all
   * of a PR's reviews (`page.tsx` flattens them), so a narrower filter here would
   * badge fewer findings than the Findings tab lists two clicks away, and the
   * disagreement would read as a bug. `pulls/repository.ts` settled the same
   * question the same way for the PR list.
   */
  async findingRangesForPull(prId: string): Promise<FindingRange[]> {
    return this.db
      .select({
        file: t.findings.file,
        startLine: t.findings.startLine,
        endLine: t.findings.endLine,
      })
      .from(t.findings)
      .innerJoin(t.reviews, eq(t.reviews.id, t.findings.reviewId))
      .where(and(eq(t.reviews.prId, prId), isNull(t.findings.dismissedAt)));
  }
}
