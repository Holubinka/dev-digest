import { and, asc, desc, eq, ne, notInArray, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { PrBriefRow } from '../../db/rows.js';
import type { BriefDiffStats, BriefPull, BriefReads, BriefRepoRef, BriefValues } from './types.js';

/**
 * brief — the ONLY layer here that touches the DB.
 *
 * Every read is either workspace-scoped or reached through a `prId` that
 * `getPull` already resolved inside a workspace, so there is no path from an
 * `:id` in a URL to a row belonging to someone else.
 */
export class BriefRepository implements BriefReads {
  constructor(private db: Db) {}

  /** The IDOR gate. `undefined` means "not in this workspace", which the route answers as 404. */
  async getPull(workspaceId: string, prId: string): Promise<BriefPull | undefined> {
    const [row] = await this.db
      .select({
        id: t.pullRequests.id,
        repoId: t.pullRequests.repoId,
        headSha: t.pullRequests.headSha,
        title: t.pullRequests.title,
        body: t.pullRequests.body,
        linkedIssue: t.pullRequests.linkedIssue,
      })
      .from(t.pullRequests)
      .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.id, prId)));
    return row ? { ...row, linkedIssue: row.linkedIssue ?? null } : undefined;
  }

  async getRepo(repoId: string): Promise<BriefRepoRef | undefined> {
    const [row] = await this.db
      .select({ owner: t.repos.owner, name: t.repos.name })
      .from(t.repos)
      .where(eq(t.repos.id, repoId));
    return row;
  }

  /**
   * `path` and nothing else. `patch` is not in the projection, which is what
   * makes "no hunk body reaches this prompt" (R17) a property of the query
   * rather than of a later filter someone could remove.
   */
  async getFilePaths(prId: string, limit: number): Promise<string[]> {
    const rows = await this.db
      .select({ path: t.prFiles.path })
      .from(t.prFiles)
      .where(eq(t.prFiles.prId, prId))
      .orderBy(asc(t.prFiles.path))
      .limit(limit);
    return rows.map((row) => row.path);
  }

  /** Counts, summed in Postgres: the whole point is not to pull the rows to count them. */
  async getDiffStats(prId: string): Promise<BriefDiffStats> {
    const [row] = await this.db
      .select({
        files: sql<number>`count(*)::int`,
        additions: sql<number>`coalesce(sum(${t.prFiles.additions}), 0)::int`,
        deletions: sql<number>`coalesce(sum(${t.prFiles.deletions}), 0)::int`,
      })
      .from(t.prFiles)
      .where(eq(t.prFiles.prId, prId));
    return row ?? { files: 0, additions: 0, deletions: 0 };
  }

  async getBriefFor(prId: string, headSha: string): Promise<PrBriefRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.prBrief)
      .where(and(eq(t.prBrief.prId, prId), eq(t.prBrief.headSha, headSha)));
    return row;
  }

  /**
   * When the head commit was authored, or `null` when this PR has no `pr_commits`
   * row for that sha — a force-push, a shallow import, or a PR whose commits were
   * never synced. `null` is `unknown` freshness, never `fresh` (R25).
   */
  async getHeadCommittedAt(prId: string, headSha: string): Promise<Date | null> {
    const [row] = await this.db
      .select({ committedAt: t.prCommits.committedAt })
      .from(t.prCommits)
      .where(and(eq(t.prCommits.prId, prId), eq(t.prCommits.sha, headSha)));
    return row?.committedAt ?? null;
  }

  /**
   * Write this state, evict past the cap, stamp the eviction total — one
   * transaction.
   *
   * The three are one method because they are one fact. `evicted_count` is a
   * running total that only the write knows: the read cannot reconstruct it,
   * because the rows that would have carried it are the rows that were deleted.
   * Splitting it into `upsert` + `maxEvictedCount` + `evictOldest` and adding
   * them up in the service would put a crash window between the delete and the
   * count, leaving a row claiming a deletion that never happened — the exact
   * thing the plan asks the transaction to prevent.
   *
   * The eviction keeps the newest `maxStates` and NEVER touches the row just
   * written, so a clock skew that made the new row look oldest still cannot
   * delete what this call persisted.
   */
  async upsertBrief(
    prId: string,
    headSha: string,
    values: BriefValues,
    maxStates: number,
  ): Promise<PrBriefRow> {
    return this.db.transaction(async (tx) => {
      const computedAt = new Date();
      const [existingMax] = await tx
        .select({ evicted: sql<number>`coalesce(max(${t.prBrief.evictedCount}), 0)::int` })
        .from(t.prBrief)
        .where(eq(t.prBrief.prId, prId));
      const priorEvicted = existingMax?.evicted ?? 0;

      const [written] = await tx
        .insert(t.prBrief)
        .values({ prId, headSha, ...values, computedAt, evictedCount: priorEvicted })
        .onConflictDoUpdate({
          target: [t.prBrief.prId, t.prBrief.headSha],
          set: { ...values, computedAt, evictedCount: priorEvicted },
        })
        .returning();

      // The row just written is kept unconditionally, and the OTHER newest
      // `maxStates - 1` join it. Selecting the newest `maxStates` outright and
      // adding this one to the set would keep 21 rows on the day this row is not
      // the newest — a clock that moved, or an imported state stamped ahead —
      // and asking for the newest `maxStates` INCLUDING this one would let that
      // same day delete what the call just persisted.
      const survivors = await tx
        .select({ headSha: t.prBrief.headSha })
        .from(t.prBrief)
        .where(and(eq(t.prBrief.prId, prId), ne(t.prBrief.headSha, headSha)))
        .orderBy(desc(t.prBrief.computedAt))
        .limit(Math.max(maxStates - 1, 0));
      const keep = new Set(survivors.map((row) => row.headSha));
      keep.add(headSha);

      // `notInArray`, not a hand-built `array[...]`: the shas come from the
      // database, but string-interpolating an identifier into SQL is how a value
      // that stops coming from the database becomes an injection.
      const evicted = await tx
        .delete(t.prBrief)
        .where(and(eq(t.prBrief.prId, prId), notInArray(t.prBrief.headSha, [...keep])))
        .returning({ headSha: t.prBrief.headSha });

      if (evicted.length === 0) return written!;

      const [stamped] = await tx
        .update(t.prBrief)
        .set({ evictedCount: priorEvicted + evicted.length })
        .where(and(eq(t.prBrief.prId, prId), eq(t.prBrief.headSha, headSha)))
        .returning();
      return stamped!;
    });
  }
}
