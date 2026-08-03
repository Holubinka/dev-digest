import type { Skill, SkillListItem, SkillVersion } from '@devdigest/shared';
import type { SkillRow, SkillVersionRow } from '../../db/rows.js';

/** Pure helpers for the skills module — DB row ⇄ DTO mapping. No I/O. */

/**
 * A skill row plus how many agents bind it. Declared here rather than in the
 * repository so the mapper below does not have to import the data layer.
 */
export interface SkillWithUsage {
  skill: SkillRow;
  agentCount: number;
}

/**
 * Map a persisted skill row to the public `Skill` DTO. `type` and `source` are
 * passed through uncast on purpose: the Drizzle column and the Zod enum infer
 * the same union, so letting them drift becomes a compile error here.
 */
export function toSkillDto(row: SkillRow): Skill {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    type: row.type,
    source: row.source,
    body: row.body,
    enabled: row.enabled,
    version: row.version,
    evidence_files: row.evidenceFiles ?? null,
  };
}

export function toSkillListItemDto(row: SkillWithUsage): SkillListItem {
  return { ...toSkillDto(row.skill), agent_count: row.agentCount };
}

export function toSkillVersionDto(row: SkillVersionRow): SkillVersion {
  return {
    skill_id: row.skillId,
    version: row.version,
    body: row.body,
    created_at: row.createdAt.toISOString(),
  };
}
