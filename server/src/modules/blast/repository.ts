import { and, asc, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { BlastPull } from './types.js';

/**
 * blast — the only file in this slice holding Drizzle (`no-sql-outside-repository`).
 *
 * Two reads, both scoped, neither returning a `*Row`: the service is handed the
 * three values the view needs, so no database shape crosses out of here
 * (`onion-architecture` §3.5).
 */
export class BlastRepository {
  constructor(private db: Db) {}

  /**
   * The PR and its repo, scoped by workspace. `undefined` means "not in this
   * workspace" — the route turns that into a 404 rather than a 200, which is
   * what stops a PR id from another tenant being answered at all.
   *
   * `repos.full_name` is selected rather than rebuilt from `owner`/`name`: it is
   * the column the unique index is on and the string GitHub gave us, and the
   * card feeds it straight to `githubBlobUrl`, where a guess would produce a
   * link to a repository that does not exist.
   */
  async getPullForBlast(workspaceId: string, prId: string): Promise<BlastPull | undefined> {
    const [row] = await this.db
      .select({
        repoId: t.pullRequests.repoId,
        headSha: t.pullRequests.headSha,
        repoFullName: t.repos.fullName,
      })
      .from(t.pullRequests)
      .innerJoin(t.repos, eq(t.repos.id, t.pullRequests.repoId))
      .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.id, prId)));
    return row;
  }

  /**
   * The PR's changed paths, ordered by path. The ORDER BY is the whole point:
   * this list seeds both `getBlastRadius` and the downstream walk, and an
   * unordered read makes two identical requests answer in a different order for
   * no visible reason (`server/INSIGHTS.md:69-80`).
   */
  async getChangedFiles(prId: string): Promise<string[]> {
    const rows = await this.db
      .select({ path: t.prFiles.path })
      .from(t.prFiles)
      .where(eq(t.prFiles.prId, prId))
      .orderBy(asc(t.prFiles.path));
    return rows.map((row) => row.path);
  }
}
