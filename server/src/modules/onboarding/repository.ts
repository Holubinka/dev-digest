import { and, eq } from 'drizzle-orm';
import { OnboardingRecord } from '@devdigest/shared';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { OnboardingLogger, OnboardingReads, OnboardingRepo } from './types.js';

/**
 * onboarding data-access. Owns `onboarding` — one row per repo, primary key
 * `repo_id` — and reads `repos` for the owner/name/clone a generation needs.
 * That read is a read, not ownership, which is why it is a select here rather
 * than a call into the repos module.
 *
 * `onboarding` HAS NO `workspace_id` COLUMN and gains none. Every path into this
 * table starts from a repo the service has already resolved through
 * `getRepo(workspaceId, repoId)`, so the tenancy proof is one query rather than
 * a column repeated on every table below `repos` — exactly what
 * `db/schema/context.ts` documents for `repo_doc_edits`.
 */
export class OnboardingRepository implements OnboardingReads {
  constructor(private db: Db) {}

  /**
   * The repo, scoped to the workspace. `undefined` is the IDOR gate: it means
   * "not yours", and the route answers it identically to "no such id" so the
   * response never confirms that a repo exists somewhere else.
   */
  async getRepo(workspaceId: string, repoId: string): Promise<OnboardingRepo | undefined> {
    const [row] = await this.db
      .select({
        id: t.repos.id,
        owner: t.repos.owner,
        name: t.repos.name,
        fullName: t.repos.fullName,
        defaultBranch: t.repos.defaultBranch,
        clonePath: t.repos.clonePath,
      })
      .from(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.id, repoId)));
    return row;
  }

  /**
   * The one saved tour for this repo, parsed, or `null`.
   *
   * THE PARSE IS THE POINT. A jsonb column is untyped input — a cast would be a
   * promise the type system never checked — so the contract is applied here, at
   * the edge where the value re-enters the program.
   *
   * A document that no longer matches the contract degrades to `null` and a
   * warning, NEVER to a thrown error. The difference is who gets blamed: a
   * `.parse()` here would surface as a 422 against the caller who merely opened
   * the page, for a row written months earlier by code they never ran
   * (`server/INSIGHTS.md`, "a contract field removed later is a 422 blamed on the
   * caller"). `null` says "nothing saved yet, press Generate", which is both
   * recoverable and true.
   *
   * The warning is what keeps that from being silent, and it needs the caller's
   * logger: this object is built once by the composition root, which has none,
   * while the request that reached this row has one carrying its id.
   */
  async get(repoId: string, log: OnboardingLogger): Promise<OnboardingRecord | null> {
    const [row] = await this.db
      .select({ json: t.onboarding.json })
      .from(t.onboarding)
      .where(eq(t.onboarding.repoId, repoId));
    if (!row) return null;

    const parsed = OnboardingRecord.safeParse(row.json);
    if (!parsed.success) {
      log.warn(
        { repoId, issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.code}`) },
        'onboarding tour: stored document no longer matches the contract, serving it as absent',
      );
      return null;
    }
    return parsed.data;
  }

  /**
   * Replace the one row for this repo.
   *
   * `INSERT ... ON CONFLICT (repo_id) DO UPDATE` over both columns, which is what
   * makes AC-59 true: one row per repo means no previous tour is reachable
   * anywhere afterwards. There is no history table and no second write path, so
   * "replaced" is a property of the schema rather than of a cleanup that has to
   * run.
   *
   * `generated_at` is written twice on purpose and from ONE value: the record's
   * own stamp is what is served, and the column is what SQL can order and filter
   * on without opening the document. Deriving the column from the record rather
   * than calling the clock again is what keeps them from disagreeing by the
   * width of the write.
   */
  async upsert(repoId: string, record: OnboardingRecord): Promise<void> {
    const generatedAt = new Date(record.generated_at);
    await this.db
      .insert(t.onboarding)
      .values({ repoId, json: record, generatedAt })
      .onConflictDoUpdate({
        target: t.onboarding.repoId,
        set: { json: record, generatedAt },
      });
  }
}
