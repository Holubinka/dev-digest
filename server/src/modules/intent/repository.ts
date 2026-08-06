import { and, eq } from 'drizzle-orm';
import type { IntentConfidence } from '@devdigest/shared';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { PrIntentRow, PullRow, RepoRow } from '../../db/rows.js';

/**
 * intent — the ONLY layer touching the DB for this module, and after 05 the
 * only owner of `pr_intent` anywhere: `ReviewRepository`'s copy of these two
 * methods was retired precisely because two repositories writing one table is
 * how the two drift.
 */

/** The column values one derivation writes. `computed_at` is set by the repository. */
export interface IntentValues {
  intent: string;
  inScope: string[];
  outOfScope: string[];
  riskAreas: string[];
  confidence: IntentConfidence;
  evidence: string[];
  planRefs: string[];
  provider: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number | null;
}

export class IntentRepository {
  constructor(private db: Db) {}

  async getPull(workspaceId: string, prId: string): Promise<PullRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.pullRequests)
      .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.id, prId)));
    return row;
  }

  async getRepo(repoId: string): Promise<RepoRow | undefined> {
    const [row] = await this.db.select().from(t.repos).where(eq(t.repos.id, repoId));
    return row;
  }

  async getCommitMessages(prId: string, limit: number): Promise<string[]> {
    const rows = await this.db
      .select({ message: t.prCommits.message })
      .from(t.prCommits)
      .where(eq(t.prCommits.prId, prId))
      .limit(limit);
    return rows.map((row) => row.message);
  }

  async getFilePaths(prId: string, limit: number): Promise<string[]> {
    const rows = await this.db
      .select({ path: t.prFiles.path })
      .from(t.prFiles)
      .where(eq(t.prFiles.prId, prId))
      .limit(limit);
    return rows.map((row) => row.path);
  }

  async getIntent(prId: string): Promise<PrIntentRow | undefined> {
    const [row] = await this.db.select().from(t.prIntent).where(eq(t.prIntent.prId, prId));
    return row;
  }

  /** `pr_intent.pr_id` is the primary key, which is the unique index ON CONFLICT needs. */
  async upsertIntent(prId: string, values: IntentValues): Promise<PrIntentRow> {
    const computedAt = new Date();
    const [row] = await this.db
      .insert(t.prIntent)
      .values({ prId, ...values, computedAt })
      .onConflictDoUpdate({ target: t.prIntent.prId, set: { ...values, computedAt } })
      .returning();
    return row!;
  }
}
