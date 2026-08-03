import { describe, it, expect } from 'vitest';
import {
  toSkillDto,
  toSkillListItemDto,
  toSkillVersionDto,
} from '../src/modules/skills/helpers.js';
import type { SkillRow, SkillVersionRow } from '../src/db/rows.js';

const ROW: SkillRow = {
  id: 'sk-1',
  workspaceId: 'ws-1',
  name: 'Uncovered branch rubric',
  description: 'List every branch the diff adds and name the test covering it.',
  type: 'rubric',
  source: 'manual',
  body: '# Rubric\nList every branch…',
  enabled: true,
  version: 3,
  evidenceFiles: null,
  createdAt: new Date('2026-08-03T10:00:00.000Z'),
};

describe('toSkillDto', () => {
  it('maps the camelCase row onto the snake_case wire shape', () => {
    expect(toSkillDto({ ...ROW, evidenceFiles: ['docs/a.md'] })).toEqual({
      id: 'sk-1',
      name: 'Uncovered branch rubric',
      description: 'List every branch the diff adds and name the test covering it.',
      type: 'rubric',
      source: 'manual',
      body: '# Rubric\nList every branch…',
      enabled: true,
      version: 3,
      evidence_files: ['docs/a.md'],
    });
  });

  it('reports absent evidence as null rather than dropping the key', () => {
    expect(toSkillDto(ROW).evidence_files).toBeNull();
  });

  it('does not leak the workspace id to the client', () => {
    expect(toSkillDto(ROW)).not.toHaveProperty('workspaceId');
  });
});

describe('toSkillListItemDto', () => {
  it('carries the binding count alongside the skill', () => {
    expect(toSkillListItemDto({ skill: ROW, agentCount: 2 })).toMatchObject({
      id: 'sk-1',
      agent_count: 2,
    });
  });

  it('keeps a skill nobody has bound at zero', () => {
    expect(toSkillListItemDto({ skill: ROW, agentCount: 0 }).agent_count).toBe(0);
  });
});

describe('toSkillVersionDto', () => {
  it('serialises the snapshot with an ISO timestamp', () => {
    const row: SkillVersionRow = {
      skillId: 'sk-1',
      version: 2,
      body: '# Rubric v2',
      createdAt: new Date('2026-08-03T10:00:00.000Z'),
    };
    expect(toSkillVersionDto(row)).toEqual({
      skill_id: 'sk-1',
      version: 2,
      body: '# Rubric v2',
      created_at: '2026-08-03T10:00:00.000Z',
    });
  });
});
