import { and, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

/**
 * settings — data access for the non-secret preference rows.
 *
 * It exists so `modules/_shared/feature-models.ts` can resolve a workspace's
 * model choice without holding Drizzle: `_shared/` is neither a repository nor
 * a route, so `no-sql-outside-repository` applies to it in full. The reader
 * reaches this through `container.settingsRepo`, which keeps `_shared/` free of
 * an import into the `settings` slice as well.
 *
 * `settings/routes.ts` still queries `container.db` directly; that is one of the
 * four entries already in the arch baseline and is not this change's business.
 */
export class SettingsRepository {
  constructor(private db: Db) {}

  /**
   * One preference value for a workspace, or `undefined` when the key was never
   * written. The unique index is (workspace, user, key), so several users can
   * each hold a row for one key; the last one wins, which is exactly what
   * `rowsToSettings` does when it collapses the full set.
   */
  async value(workspaceId: string, key: string): Promise<unknown> {
    const rows = await this.db
      .select({ value: t.settings.value })
      .from(t.settings)
      .where(and(eq(t.settings.workspaceId, workspaceId), eq(t.settings.key, key)));
    return rows.at(-1)?.value;
  }
}
