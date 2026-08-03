import { and, desc, eq, inArray } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { ConventionRow, ConventionScanRow } from '../../db/rows.js';
import {
  FeatureModelChoice,
  type ConventionStatus,
  type FeatureModelId,
} from '@devdigest/shared';
import type { VerifiedEvidence } from './helpers.js';

export type { ConventionRow, ConventionScanRow };

/**
 * Conventions data-access. Owns `conventions` and `convention_scans`, and reads
 * `repos` for the owner/name/clone a scan needs — a read, not ownership, which
 * is why it is a select here rather than a call into the repos module.
 * Workspace-scoped throughout.
 */

export interface InsertScan {
  workspaceId: string;
  repoId: string;
  headSha: string | null;
  model: string;
  sampleFiles: number;
  candidatesReturned: number;
  candidatesKept: number;
}

export interface InsertCandidate {
  workspaceId: string;
  repoId: string;
  scanId: string;
  category: string;
  rule: string;
  evidence: VerifiedEvidence[];
  headSha: string | null;
  confidence: number;
}

export interface RepoRef {
  id: string;
  owner: string;
  name: string;
  fullName: string;
  defaultBranch: string;
  clonePath: string | null;
}

export class ConventionsRepository {
  constructor(private db: Db) {}

  async getRepo(workspaceId: string, repoId: string): Promise<RepoRef | undefined> {
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
   * The workspace's model choice for a feature, or undefined when unset.
   *
   * Read here rather than through `settings/feature-models.ts`: one module
   * reaching into another's folder is what `no-cross-module` forbids, and the
   * settings table is data, not another slice's code. The registry default is
   * the service's business, not this row's.
   */
  async featureModelOverride(
    workspaceId: string,
    feature: FeatureModelId,
  ): Promise<FeatureModelChoice | undefined> {
    const [row] = await this.db
      .select({ value: t.settings.value })
      .from(t.settings)
      .where(and(eq(t.settings.workspaceId, workspaceId), eq(t.settings.key, 'feature_models')));
    const bag = row?.value as Record<string, unknown> | null | undefined;
    const parsed = FeatureModelChoice.safeParse(bag?.[feature]);
    return parsed.success ? parsed.data : undefined;
  }

  /** Newest scan for the repo, or undefined before the first extraction. */
  async latestScan(workspaceId: string, repoId: string): Promise<ConventionScanRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.conventionScans)
      .where(
        and(eq(t.conventionScans.workspaceId, workspaceId), eq(t.conventionScans.repoId, repoId)),
      )
      .orderBy(desc(t.conventionScans.createdAt))
      .limit(1);
    return row;
  }

  /** Candidates for the repo: highest confidence first, judged ones included. */
  async listForRepo(workspaceId: string, repoId: string): Promise<ConventionRow[]> {
    return this.db
      .select()
      .from(t.conventions)
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.repoId, repoId)))
      .orderBy(desc(t.conventions.confidence), desc(t.conventions.createdAt));
  }

  async getById(workspaceId: string, id: string): Promise<ConventionRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.conventions)
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.id, id)));
    return row;
  }

  async update(
    workspaceId: string,
    id: string,
    patch: { status?: ConventionStatus; rule?: string; category?: string },
  ): Promise<ConventionRow | undefined> {
    const [row] = await this.db
      .update(t.conventions)
      .set(patch)
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.id, id)))
      .returning();
    return row;
  }

  /**
   * Replace the unjudged half of a repo's list.
   *
   * A re-scan is allowed to change its mind about what it proposes, but not
   * about what a person already decided: accepted and rejected rows stay, and
   * the caller dedupes new candidates against them. Insert and delete share one
   * transaction so a failure mid-scan cannot leave the screen empty.
   */
  async replacePending(
    workspaceId: string,
    repoId: string,
    scan: InsertScan,
    candidates: Omit<InsertCandidate, 'scanId'>[],
  ): Promise<{ scan: ConventionScanRow; rows: ConventionRow[] }> {
    return this.db.transaction(async (tx) => {
      await tx
        .delete(t.conventions)
        .where(
          and(
            eq(t.conventions.workspaceId, workspaceId),
            eq(t.conventions.repoId, repoId),
            eq(t.conventions.status, 'pending'),
          ),
        );

      const [scanRow] = await tx.insert(t.conventionScans).values(scan).returning();
      if (candidates.length === 0) return { scan: scanRow!, rows: [] };

      const rows = await tx
        .insert(t.conventions)
        .values(
          candidates.map((c) => {
            const [first, ...rest] = c.evidence;
            return {
              workspaceId: c.workspaceId,
              repoId: c.repoId,
              scanId: scanRow!.id,
              category: c.category,
              rule: c.rule,
              evidencePath: first?.path ?? null,
              evidenceSnippet: first?.snippet ?? null,
              evidenceLine: first?.line ?? null,
              evidenceEndLine: first?.end_line ?? null,
              extraEvidence: rest,
              headSha: c.headSha,
              confidence: c.confidence,
              status: 'pending' as const,
            };
          }),
        )
        .returning();
      return { scan: scanRow!, rows };
    });
  }

  /** Rules a person already judged — what a re-scan must not propose again. */
  async judgedRules(workspaceId: string, repoId: string): Promise<string[]> {
    const rows = await this.db
      .select({ rule: t.conventions.rule })
      .from(t.conventions)
      .where(
        and(
          eq(t.conventions.workspaceId, workspaceId),
          eq(t.conventions.repoId, repoId),
          inArray(t.conventions.status, ['accepted', 'rejected']),
        ),
      );
    return rows.map((r) => r.rule);
  }
}
