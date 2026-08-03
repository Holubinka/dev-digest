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

export interface UpdateSkill {
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
      .select({ skill: t.skills, agentCount: countDistinct(t.agentSkills.agentId) })
      .from(t.skills)
      .leftJoin(t.agentSkills, eq(t.agentSkills.skillId, t.skills.id))
      .where(eq(t.skills.workspaceId, workspaceId))
      .groupBy(t.skills.id)
      .orderBy(asc(t.skills.name));
    return rows.map((r) => ({ skill: r.skill, agentCount: Number(r.agentCount) }));
  }

  async getById(workspaceId: string, id: string): Promise<SkillRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)));
    return row;
  }

  /** How many agents bind this skill. */
  async countAgents(skillId: string): Promise<number> {
    const [row] = await this.db
      .select({ n: countDistinct(t.agentSkills.agentId) })
      .from(t.agentSkills)
      .where(eq(t.agentSkills.skillId, skillId));
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
  async statsFor(skillId: string): Promise<{
    runs: number;
    findings: number;
    accepted: number;
    dismissed: number;
  }> {
    const boundAgents = this.db
      .select({ agentId: t.agentSkills.agentId })
      .from(t.agentSkills)
      .where(eq(t.agentSkills.skillId, skillId));

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
  async update(
    workspaceId: string,
    id: string,
    patch: UpdateSkill,
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
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)))
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
