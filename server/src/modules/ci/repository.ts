import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { CiTarget } from '@devdigest/shared';
import { stripNul } from '../../db/text.js';
import { MAX_ARTIFACT_TEXT } from './constants.js';
import type { CiRunRowLike } from './helpers.js';
import type {
  CiAgentRunWrite,
  CiRunWrite,
  InstallationRecord,
  InstallationTarget,
  InstallationWithLastRun,
  PollObservation,
} from './types.js';

/**
 * `ci` data-access — `ci_installations`, `ci_runs`, and the `agent_runs` row an
 * accepted artifact leaves behind. Every read is workspace-scoped through
 * `ci_installations.agent_id → agents.workspace_id`: the installation table
 * carries no workspace of its own, so the join is the tenancy boundary.
 */

export interface UpsertInstallation {
  agentId: string;
  repo: string;
  targetType: CiTarget;
  /** `agents.version` the published bundle was generated from (AC-115). */
  agentVersion: number;
}

/** `true` however the driver spelled it — postgres.js and pg differ on booleans. */
function isTrue(value: unknown): boolean {
  return value === true || value === 't' || value === 'true';
}

/**
 * A free-text field from the artifact, made safe for a `text` column.
 *
 * NUL first, because Postgres refuses the whole statement on one — and here
 * that refusal is not a `ValidationError`, so `ingest-executor` rethrows it,
 * the run loop aborts before `recordPoll`, and every later refresh re-reads the
 * same artifact and fails identically. One artifact would wedge that
 * repository's ingest for good. Every other module that writes untrusted text
 * already carries this (`brief/repository.ts`, `reviews/repository/*`); this
 * one was the fifth path and the only one without it.
 *
 * Then the length, by CODE POINT, because a `slice` counts UTF-16 units and
 * splits a surrogate pair — the trap `server/INSIGHTS.md` § *Cut by code point*
 * records.
 */
function fromArtifact(value: string | null): string | null {
  if (value === null) return null;
  const clean = stripNul(value);
  const points = [...clean];
  return points.length <= MAX_ARTIFACT_TEXT ? clean : points.slice(0, MAX_ARTIFACT_TEXT).join('');
}

export class CiRepository {
  constructor(private db: Db) {}

  // -------------------------------------------------------------------------
  // Installations
  // -------------------------------------------------------------------------

  /** Every installation in the workspace, as the ingest needs to poll it. */
  async listTargets(workspaceId: string): Promise<InstallationTarget[]> {
    const rows = await this.db
      .select({
        id: t.ciInstallations.id,
        agentId: t.ciInstallations.agentId,
        // The join was already here for tenancy; the name is one more column on
        // it, and it is what the polled file name is derived from (AC-68).
        agentName: t.agents.name,
        workspaceId: t.agents.workspaceId,
        repo: t.ciInstallations.repo,
        agentVersion: t.ciInstallations.agentVersion,
        lastPolledAt: t.ciInstallations.lastPolledAt,
      })
      .from(t.ciInstallations)
      .innerJoin(t.agents, eq(t.agents.id, t.ciInstallations.agentId))
      .where(eq(t.agents.workspaceId, workspaceId))
      .orderBy(asc(t.ciInstallations.installedAt));
    return rows;
  }

  /** One agent's installations, each with its most recent run (AC-85, AC-86, AC-90). */
  async listForAgent(workspaceId: string, agentId: string): Promise<InstallationWithLastRun[]> {
    const rows = await this.db
      .select({
        id: t.ciInstallations.id,
        agentId: t.ciInstallations.agentId,
        repo: t.ciInstallations.repo,
        targetType: t.ciInstallations.targetType,
        installedAt: t.ciInstallations.installedAt,
        agentVersion: t.ciInstallations.agentVersion,
        currentAgentVersion: t.agents.version,
        agentName: t.agents.name,
        lastPolledAt: t.ciInstallations.lastPolledAt,
        workflowPresent: t.ciInstallations.workflowPresent,
        observedAgent: t.ciInstallations.observedAgent,
      })
      .from(t.ciInstallations)
      .innerJoin(t.agents, eq(t.agents.id, t.ciInstallations.agentId))
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.ciInstallations.agentId, agentId)))
      .orderBy(asc(t.ciInstallations.installedAt));
    if (rows.length === 0) return [];

    const last = await this.lastRunByInstallation(rows.map((r) => r.id));
    return rows.map((row) => ({
      ...row,
      targetType: row.targetType as CiTarget,
      lastRunStatus: last.get(row.id)?.status ?? null,
      lastRunAt: last.get(row.id)?.ranAt ?? null,
    }));
  }

  /**
   * Newest run per installation, folded in memory.
   *
   * One query ordered newest-first and a first-wins fold, rather than a lateral
   * join per installation: a workspace has a handful of installations, and the
   * `DISTINCT ON` this would otherwise need is the only part of the module that
   * would stop being portable Drizzle.
   */
  private async lastRunByInstallation(
    installationIds: string[],
  ): Promise<Map<string, { status: string | null; ranAt: Date | null }>> {
    const rows = await this.db
      .select({
        ciInstallationId: t.ciRuns.ciInstallationId,
        status: t.ciRuns.status,
        ranAt: t.ciRuns.ranAt,
      })
      .from(t.ciRuns)
      .where(inArray(t.ciRuns.ciInstallationId, installationIds))
      .orderBy(sql`${t.ciRuns.ranAt} desc nulls last`);

    const byInstallation = new Map<string, { status: string | null; ranAt: Date | null }>();
    for (const row of rows) {
      if (row.ciInstallationId === null) continue;
      if (!byInstallation.has(row.ciInstallationId)) {
        byInstallation.set(row.ciInstallationId, { status: row.status, ranAt: row.ranAt });
      }
    }
    return byInstallation;
  }

  /** The installation for (`agent_id`, `repo`), if this agent already has one. */
  async findInstallation(agentId: string, repo: string): Promise<InstallationRecord | undefined> {
    const [row] = await this.db
      .select({
        id: t.ciInstallations.id,
        agentId: t.ciInstallations.agentId,
        repo: t.ciInstallations.repo,
        targetType: t.ciInstallations.targetType,
        installedAt: t.ciInstallations.installedAt,
        agentVersion: t.ciInstallations.agentVersion,
      })
      .from(t.ciInstallations)
      .where(and(eq(t.ciInstallations.agentId, agentId), eq(t.ciInstallations.repo, repo)))
      .limit(1);
    return row ? { ...row, targetType: row.targetType as CiTarget } : undefined;
  }

  /**
   * Exactly one row per (`agent_id`, `repo`) (AC-42).
   *
   * Read-then-write inside ONE transaction, not an upsert, because
   * `ci_installations` carries no unique index on the pair — `ci_runs` got one
   * in migration 0021 and this table did not. The transaction is what keeps a
   * double-click from leaving two rows.
   *
   * A unique index on (`agent_id`, `repo`) would be stronger, because it would
   * also bind a writer that does not come through this method. Adding one is
   * deliberately not part of this change.
   *
   * `installed_at` is left as the first install's: the column records when the
   * agent arrived in the repository, not when it was last republished.
   */
  async upsertInstallation(input: UpsertInstallation): Promise<InstallationRecord> {
    return this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: t.ciInstallations.id })
        .from(t.ciInstallations)
        .where(
          and(eq(t.ciInstallations.agentId, input.agentId), eq(t.ciInstallations.repo, input.repo)),
        )
        .limit(1);

      const [row] = existing
        ? await tx
            .update(t.ciInstallations)
            .set({ targetType: input.targetType, agentVersion: input.agentVersion })
            .where(eq(t.ciInstallations.id, existing.id))
            .returning()
        : await tx
            .insert(t.ciInstallations)
            .values({
              agentId: input.agentId,
              repo: input.repo,
              targetType: input.targetType,
              agentVersion: input.agentVersion,
            })
            .returning();

      const saved = row!;
      return {
        id: saved.id,
        agentId: saved.agentId,
        repo: saved.repo,
        targetType: saved.targetType as CiTarget,
        installedAt: saved.installedAt,
        agentVersion: saved.agentVersion,
      };
    });
  }

  /**
   * Record a poll that RETURNED, with what it saw. Never called on the failure
   * path (AC-128, AC-129).
   *
   * The stamp and the observation are ONE statement, so the tab can never show
   * a poll time next to an observation from an earlier poll. Both observation
   * fields are overwritten every time, `null` included: they describe the last
   * poll, and a mismatch that has since been fixed by a republish must stop
   * being reported.
   */
  async recordPoll(installationId: string, at: Date, seen: PollObservation): Promise<void> {
    await this.db
      .update(t.ciInstallations)
      .set({
        lastPolledAt: at,
        workflowPresent: seen.workflowPresent,
        observedAgent: fromArtifact(seen.observedAgent),
      })
      .where(eq(t.ciInstallations.id, installationId));
  }

  /**
   * Every installation in this repository, whichever agent owns it (AC-137).
   *
   * Workspace-scoped through the same join every other read here uses: a
   * repository name is not a tenant, and two workspaces may well have imported
   * the same public repository.
   */
  async listInstallationsInRepo(
    workspaceId: string,
    repo: string,
  ): Promise<{ agentId: string; agentName: string }[]> {
    return this.db
      .select({ agentId: t.ciInstallations.agentId, agentName: t.agents.name })
      .from(t.ciInstallations)
      .innerJoin(t.agents, eq(t.agents.id, t.ciInstallations.agentId))
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.ciInstallations.repo, repo)));
  }

  /** The most recent successful poll across the workspace's installations (AC-84). */
  async lastPolledAt(workspaceId: string): Promise<Date | null> {
    const [row] = await this.db
      .select({ at: t.ciInstallations.lastPolledAt })
      .from(t.ciInstallations)
      .innerJoin(t.agents, eq(t.agents.id, t.ciInstallations.agentId))
      .where(eq(t.agents.workspaceId, workspaceId))
      .orderBy(sql`${t.ciInstallations.lastPolledAt} desc nulls last`)
      .limit(1);
    return row?.at ?? null;
  }

  // -------------------------------------------------------------------------
  // Runs
  // -------------------------------------------------------------------------

  /** Every ingested run in the workspace, newest first (AC-79). */
  async listRuns(workspaceId: string): Promise<CiRunRowLike[]> {
    return this.db
      .select({
        id: t.ciRuns.id,
        ciInstallationId: t.ciRuns.ciInstallationId,
        prNumber: t.ciRuns.prNumber,
        ranAt: t.ciRuns.ranAt,
        status: t.ciRuns.status,
        findingsCount: t.ciRuns.findingsCount,
        costUsd: t.ciRuns.costUsd,
        githubUrl: t.ciRuns.githubUrl,
        source: t.ciRuns.source,
        repo: t.ciRuns.repo,
        workflowRunId: t.ciRuns.workflowRunId,
        agent: t.ciRuns.agent,
        durationMs: t.ciRuns.durationMs,
        headSha: t.ciRuns.headSha,
        bundleVersion: t.ciRuns.bundleVersion,
        verdict: t.ciRuns.verdict,
      })
      .from(t.ciRuns)
      .innerJoin(t.ciInstallations, eq(t.ciInstallations.id, t.ciRuns.ciInstallationId))
      .innerJoin(t.agents, eq(t.agents.id, t.ciInstallations.agentId))
      .where(eq(t.agents.workspaceId, workspaceId))
      .orderBy(sql`${t.ciRuns.ranAt} desc nulls last`, desc(t.ciRuns.id));
  }

  /**
   * One row per (`repo`, `workflow_run_id`), in ONE statement (AC-75, AC-124).
   *
   * `onConflictDoUpdate` against `ci_runs_repo_run_idx` and not a `select`
   * followed by an `insert` or an `update`: two ingest passes over the same run
   * would both find no row, both insert, and neither fail. There is no branch in
   * this module that decides whether a run is new — the database decides, and
   * `xmax = 0` is how the statement reports which half it took.
   */
  async upsertRun(write: CiRunWrite): Promise<{ id: string; inserted: boolean }> {
    const mutable = {
      prNumber: write.prNumber,
      ranAt: write.ranAt,
      status: write.status,
      findingsCount: write.findingsCount,
      costUsd: write.costUsd,
      githubUrl: write.githubUrl,
      source: 'ci',
      agent: fromArtifact(write.agent),
      durationMs: write.durationMs,
      headSha: write.headSha,
      bundleVersion: fromArtifact(write.bundleVersion),
      verdict: write.verdict,
    };
    const [row] = await this.db
      .insert(t.ciRuns)
      .values({
        repo: write.repo,
        workflowRunId: write.workflowRunId,
        ciInstallationId: write.ciInstallationId,
        ...mutable,
      })
      .onConflictDoUpdate({
        target: [t.ciRuns.repo, t.ciRuns.workflowRunId],
        set: {
          ...mutable,
          // AC-144: THE ROW KEEPS THE INSTALLATION WHOSE AGENT RAN IT. Two
          // installations in one repository poll two different workflow files,
          // but a run reached by both — however it happened — must not be
          // re-attributed by whichever polled last, or the CI tab's history
          // would flip between agents on every refresh. `COALESCE` still fills
          // in a row whose installation was deleted (`on delete set null`).
          ciInstallationId: sql`coalesce(${t.ciRuns.ciInstallationId}, excluded.ci_installation_id)`,
        },
      })
      .returning({ id: t.ciRuns.id, inserted: sql`(xmax = 0)` });
    return { id: row!.id, inserted: isTrue(row!.inserted) };
  }

  /**
   * The `agent_runs` row an accepted artifact leaves in the run history (AC-76).
   *
   * `pr_id` is filled only when this PR was imported into the workspace; a CI
   * run on a PR nobody opened in the studio is still a run, and inventing a
   * `pull_requests` row for it would put a PR on screens that never imported it.
   */
  async insertAgentRun(write: CiAgentRunWrite): Promise<string> {
    const prId = write.prNumber === null ? null : await this.findPrId(write);
    const [row] = await this.db
      .insert(t.agentRuns)
      .values({
        workspaceId: write.workspaceId,
        agentId: write.agentId,
        prId,
        ...(write.ranAt ? { ranAt: write.ranAt } : {}),
        durationMs: write.durationMs,
        costUsd: write.costUsd,
        status: write.status,
        source: 'ci',
        findingsCount: write.findingsCount,
      })
      .returning({ id: t.agentRuns.id });
    return row!.id;
  }

  private async findPrId(write: CiAgentRunWrite): Promise<string | null> {
    const [row] = await this.db
      .select({ id: t.pullRequests.id })
      .from(t.pullRequests)
      .innerJoin(t.repos, eq(t.repos.id, t.pullRequests.repoId))
      .where(
        and(
          eq(t.repos.workspaceId, write.workspaceId),
          eq(t.repos.fullName, write.repo),
          eq(t.pullRequests.number, write.prNumber!),
        ),
      )
      .limit(1);
    return row?.id ?? null;
  }
}
