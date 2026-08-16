import { and, asc, desc, eq, ne, notInArray, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { PrBriefRow } from '../../db/rows.js';
import { stripNul, stripNulDeep } from '../../db/text.js';
import type { BriefDiffStats, BriefPull, BriefReads, BriefRepoRef, BriefValues } from './types.js';

/**
 * The columns that came out of the model, with U+0000 removed.
 *
 * `what` and `why` are `text`, `risks` / `review_focus` / `dropped_refs` are
 * `jsonb`, and Postgres refuses the byte in both — `invalid byte sequence for
 * encoding "UTF8": 0x00` and `unsupported Unicode escape sequence`
 * (`db/text.ts:20-21,40-41`). One NUL anywhere in that set kills the whole
 * INSERT, so a brief that was already computed and already paid for is lost and
 * the route answers 502. `insertReview` and `saveRunTrace` have carried this
 * since run `ce536de2` bought ~167k input tokens and stored nothing.
 *
 * FIELD BY FIELD, and not `stripNulDeep(values)` over the object: `stripNulDeep`
 * rebuilds any object from its own enumerable entries, and a `Date` has none —
 * the wholesale call would hand `{}` to `intent_computed_at`.
 *
 * `provider` and `model` are stripped too, and they are not model output —
 * `review.repo.ts:28-32` had to correct itself on exactly this point. They are
 * `z.string().min(1)` off a workspace's own settings with no charset
 * constraint, so a slug saved with a NUL in it loses every brief computed
 * against that model, which is the same row and the same 502 by a different
 * door. Unlike `insertReview`'s pair these two are non-nullable here
 * (`types.ts:185-186`), so they need no null branch.
 *
 * The rest is left alone with a reason each. `riskLevel`, `intentFreshness` and
 * `blastStatus` are Zod enums, so the value would have failed to parse long
 * before this; `linkSha` is a sha this server read off git; `inputs` and
 * `refLines` are composed here from file paths, labels and counters rather than
 * from the model's answer; numbers and booleans cannot hold the byte at all.
 */
const sanitize = (values: BriefValues): BriefValues => ({
  ...values,
  what: stripNul(values.what),
  why: stripNul(values.why),
  risks: stripNulDeep(values.risks),
  reviewFocus: stripNulDeep(values.reviewFocus),
  droppedRefs: stripNulDeep(values.droppedRefs),
  provider: stripNul(values.provider),
  model: stripNul(values.model),
});

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
    // ONE sanitised object for both halves of the upsert: `set` is what a
    // recomputation of a state that already has a row goes through, which is the
    // ordinary case rather than the corner one.
    const clean = sanitize(values);
    return this.db.transaction(async (tx) => {
      const computedAt = new Date();
      const [existingMax] = await tx
        .select({ evicted: sql<number>`coalesce(max(${t.prBrief.evictedCount}), 0)::int` })
        .from(t.prBrief)
        .where(eq(t.prBrief.prId, prId));
      const priorEvicted = existingMax?.evicted ?? 0;

      const [written] = await tx
        .insert(t.prBrief)
        .values({ prId, headSha, ...clean, computedAt, evictedCount: priorEvicted })
        .onConflictDoUpdate({
          target: [t.prBrief.prId, t.prBrief.headSha],
          set: { ...clean, computedAt, evictedCount: priorEvicted },
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
