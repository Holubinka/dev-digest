import { and, asc, count, countDistinct, desc, eq, inArray } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { SkillSource, SkillType } from '@devdigest/shared';
import { DEFAULT_SKILL_DESCRIPTION, INITIAL_SKILL_VERSION } from './constants.js';
import type { SkillWithUsage } from './helpers.js';

/**
 * Skills data-access. Owns `skills` and `skill_versions`. The `agent_skills`
 * link table is NOT owned here — the agents module owns both sides of a binding,
 * so a skill never learns which agents use it except through the count below.
 * Workspace-scoped throughout.
 */

import type { SkillRow, SkillVersionRow } from '../../db/rows.js';
export type { SkillRow, SkillVersionRow };

export interface InsertSkill {
  workspaceId: string;
  name: string;
  description?: string;
  type: SkillType;
  source: SkillSource;
  body: string;
  enabled: boolean;
  evidenceFiles?: string[] | null;
}

interface UpdateSkill {
  name?: string;
  description?: string;
  type?: SkillType;
  body?: string;
  enabled?: boolean;
}

export class SkillsRepository {
  constructor(private db: Db) {}

  /** Skills in the workspace, alphabetical, each with the number of agents that
   *  bind it. The left join keeps skills nobody has bound yet. */
  async list(workspaceId: string): Promise<SkillWithUsage[]> {
    const rows = await this.db
      // Counting `t.agents.id` rather than `agent_skills.agent_id`, with the
      // workspace test in the JOIN and not the WHERE: in the WHERE it would
      // drop every skill nobody binds, and counting the link column would
      // count an agent this workspace cannot see. Same scoping as
      // `agentsBinding` below.
      .select({ skill: t.skills, agentCount: countDistinct(t.agents.id) })
      .from(t.skills)
      .leftJoin(t.agentSkills, eq(t.agentSkills.skillId, t.skills.id))
      .leftJoin(
        t.agents,
        and(eq(t.agents.id, t.agentSkills.agentId), eq(t.agents.workspaceId, workspaceId)),
      )
      .where(eq(t.skills.workspaceId, workspaceId))
      .groupBy(t.skills.id)
      .orderBy(asc(t.skills.name));
    return rows.map((r) => ({ skill: r.skill, agentCount: Number(r.agentCount) }));
  }

  /**
   * Tenancy without the payload. Three endpoints only need to know the skill is
   * in this workspace — the version list, one snapshot, and a restore — and
   * `getById` would fetch a body up to 64 KB for them to throw away.
   */
  async existsInWorkspace(workspaceId: string, id: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: t.skills.id })
      .from(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)));
    return row !== undefined;
  }

  async getById(workspaceId: string, id: string): Promise<SkillRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)));
    return row;
  }

  /**
   * The agents in this workspace that bind this skill.
   *
   * The workspace predicate is belt-and-braces: `AgentsService` refuses to link
   * across workspaces, so `agent_skills` should never hold a mixed pair. But a
   * link table's foreign key proves existence, not tenancy (INSIGHTS.md), and
   * every count below reads that table — so the scope is stated here rather
   * than assumed of a table this module does not own.
   */
  private agentsBinding(workspaceId: string, skillId: string) {
    return this.db
      .select({ agentId: t.agentSkills.agentId })
      .from(t.agentSkills)
      .innerJoin(t.agents, eq(t.agents.id, t.agentSkills.agentId))
      .where(and(eq(t.agentSkills.skillId, skillId), eq(t.agents.workspaceId, workspaceId)));
  }

  /** How many agents bind this skill. */
  async countAgents(workspaceId: string, skillId: string): Promise<number> {
    const [row] = await this.db
      .select({ n: countDistinct(t.agentSkills.agentId) })
      .from(t.agentSkills)
      .innerJoin(t.agents, eq(t.agents.id, t.agentSkills.agentId))
      .where(and(eq(t.agentSkills.skillId, skillId), eq(t.agents.workspaceId, workspaceId)));
    return Number(row?.n ?? 0);
  }

  /**
   * What the agents binding this skill have actually produced.
   *
   * Attribution is by CURRENT binding, not by what was bound when the run
   * happened — `agent_versions.config_json.skills` holds that history, but a
   * run does not record which version it used, so a per-run attribution would
   * be a guess dressed as a number. Counting current bindings is the honest
   * approximation, and the UI says so.
   */
  async statsFor(
    workspaceId: string,
    skillId: string,
  ): Promise<{
    runs: number;
    findings: number;
    accepted: number;
    dismissed: number;
  }> {
    const boundAgents = this.agentsBinding(workspaceId, skillId);

    const [runRow] = await this.db
      .select({ n: count() })
      .from(t.agentRuns)
      .where(inArray(t.agentRuns.agentId, boundAgents));

    const [findingRow] = await this.db
      .select({
        total: count(),
        accepted: count(t.findings.acceptedAt),
        dismissed: count(t.findings.dismissedAt),
      })
      .from(t.findings)
      .innerJoin(t.reviews, eq(t.reviews.id, t.findings.reviewId))
      .innerJoin(t.agentRuns, eq(t.agentRuns.id, t.reviews.runId))
      .where(inArray(t.agentRuns.agentId, boundAgents));

    return {
      runs: Number(runRow?.n ?? 0),
      findings: Number(findingRow?.total ?? 0),
      accepted: Number(findingRow?.accepted ?? 0),
      dismissed: Number(findingRow?.dismissed ?? 0),
    };
  }

  /** Delete a skill (scoped to workspace). Its versions and any agent bindings
   *  cascade. Returns false when no such skill existed in the workspace. */
  async deleteById(workspaceId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)))
      .returning({ id: t.skills.id });
    return rows.length > 0;
  }

  /** Insert a skill AND record version 1 of its body in `skill_versions`. */
  async insert(values: InsertSkill): Promise<SkillRow> {
    const [row] = await this.db
      .insert(t.skills)
      .values({
        workspaceId: values.workspaceId,
        name: values.name,
        description: values.description ?? DEFAULT_SKILL_DESCRIPTION,
        type: values.type,
        source: values.source,
        body: values.body,
        enabled: values.enabled,
        version: INITIAL_SKILL_VERSION,
        evidenceFiles: values.evidenceFiles ?? null,
      })
      .returning();
    await this.snapshotVersion(row!, INITIAL_SKILL_VERSION);
    return row!;
  }

  /**
   * Update a skill. Unlike an agent, where any config change bumps the version,
   * ONLY a body change does: `skill_versions` stores `(skill_id, version, body)`,
   * so bumping on a rename would record a row identical to the one before it.
   */
  /**
   * Apply a patch. When `expectedVersion` is given the write only lands if the
   * row is still at that version, and `undefined` comes back if it is not.
   *
   * That is what makes the caller's injection check atomic without a
   * transaction: the check is only invalidated by the body moving, and the
   * version bumps on exactly that. Two concurrent renames still both succeed —
   * neither changes what the check was about.
   */
  async update(
    workspaceId: string,
    id: string,
    patch: UpdateSkill,
    expectedVersion?: number,
  ): Promise<SkillRow | undefined> {
    const existing = await this.getById(workspaceId, id);
    if (!existing) return undefined;

    const bodyChanged = patch.body !== undefined && patch.body !== existing.body;
    const nextVersion = bodyChanged ? existing.version + 1 : existing.version;

    const [row] = await this.db
      .update(t.skills)
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.type !== undefined ? { type: patch.type } : {}),
        ...(patch.body !== undefined ? { body: patch.body } : {}),
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
        ...(bodyChanged ? { version: nextVersion } : {}),
      })
      .where(
        and(
          eq(t.skills.workspaceId, workspaceId),
          eq(t.skills.id, id),
          ...(expectedVersion !== undefined ? [eq(t.skills.version, expectedVersion)] : []),
        ),
      )
      .returning();

    if (bodyChanged && row) await this.snapshotVersion(row, nextVersion);
    return row;
  }

  private async snapshotVersion(row: SkillRow, version: number): Promise<void> {
    await this.db
      .insert(t.skillVersions)
      .values({ skillId: row.id, version, body: row.body })
      .onConflictDoNothing();
  }

  // ---- skill_versions (immutable body snapshots) --------------------------

  /** All body snapshots for a skill, newest version first. */
  async listVersions(skillId: string): Promise<SkillVersionRow[]> {
    return this.db
      .select()
      .from(t.skillVersions)
      .where(eq(t.skillVersions.skillId, skillId))
      .orderBy(desc(t.skillVersions.version));
  }

  /** A single body snapshot, or undefined if that version was never recorded. */
  async getVersion(skillId: string, version: number): Promise<SkillVersionRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.skillVersions)
      .where(and(eq(t.skillVersions.skillId, skillId), eq(t.skillVersions.version, version)));
    return row;
  }
}
