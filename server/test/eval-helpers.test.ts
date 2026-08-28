/**
 * L06 follow-up — `parseRunSkills`, the guard between raw jsonb and
 * `EvalCaseRow.last_run.skills`, and `toSkillCaseRow`, its skill-centric
 * mirror. Hermetic: no container, no DB.
 */
import { describe, it, expect } from 'vitest';
import { toCaseRow, toSkillCaseRow } from '../src/modules/eval/helpers.js';
import type { EvalCaseDbRow, LatestRunRow, SkillCaseRow } from '../src/modules/eval/repository.js';

function caseRow(over: Partial<EvalCaseDbRow> = {}): EvalCaseDbRow {
  return {
    id: 'c1',
    workspaceId: 'w1',
    ownerKind: 'agent',
    ownerId: 'a1',
    name: 'x',
    inputDiff: '',
    inputFiles: null,
    inputMeta: null,
    expectedOutput: [],
    notes: null,
    ...over,
  } as EvalCaseDbRow;
}

function runRow(over: Partial<LatestRunRow> = {}): LatestRunRow {
  return {
    case_id: 'c1',
    ran_at: new Date('2026-08-23T00:00:00Z'),
    pass: true,
    recall: 1,
    precision: 1,
    citation_accuracy: 1,
    findings_count: 0,
    skills: undefined,
    ...over,
  };
}

describe('toCaseRow — last_run.skills', () => {
  it('carries a well-formed skills array through as-is', () => {
    const row = toCaseRow(caseRow(), runRow({ skills: [{ id: 's1', name: 'Attack surface inventory' }] }));
    expect(row.last_run?.skills).toEqual([{ id: 's1', name: 'Attack surface inventory' }]);
  });

  it('reads an empty array as no skills linked at run time — not the same as unknown', () => {
    const row = toCaseRow(caseRow(), runRow({ skills: [] }));
    expect(row.last_run?.skills).toEqual([]);
  });

  it('reads undefined (a row written before this field existed) as an empty array, not a throw', () => {
    const row = toCaseRow(caseRow(), runRow({ skills: undefined }));
    expect(row.last_run?.skills).toEqual([]);
  });

  it('drops an entry missing `name`, keeps the well-formed ones — malformed jsonb is a display gap, not a crash', () => {
    const row = toCaseRow(
      caseRow(),
      runRow({ skills: [{ id: 's1', name: 'Good' }, { id: 's2' }, 'not-even-an-object', null] }),
    );
    expect(row.last_run?.skills).toEqual([{ id: 's1', name: 'Good' }]);
  });

  it('never run at all — last_run is null, not an object with empty skills', () => {
    const row = toCaseRow(caseRow(), undefined);
    expect(row.last_run).toBeNull();
  });
});

function skillCaseRow(over: Partial<SkillCaseRow> = {}): SkillCaseRow {
  return {
    case_id: 'c1',
    case_name: 'stripe-key-leak',
    expected_output: [{ file: 'a.ts', start_line: 1, end_line: 1, polarity: 'must_find' }],
    notes: 'from finding:f1',
    agent_id: 'a1',
    agent_name: 'Security Reviewer',
    ran_at: new Date('2026-08-23T00:00:00Z'),
    pass: true,
    recall: 1,
    precision: 1,
    citation_accuracy: 1,
    findings_count: 1,
    skills: [{ id: 's1', name: 'Attack surface inventory' }],
    ...over,
  };
}

describe('toSkillCaseRow — the skill-centric mirror of toCaseRow', () => {
  it('carries the case, its agent, and the run that had this skill active', () => {
    const row = toSkillCaseRow(skillCaseRow());
    expect(row.id).toBe('c1');
    expect(row.name).toBe('stripe-key-leak');
    expect(row.owner_kind).toBe('agent');
    expect(row.owner_id).toBe('a1');
    expect(row.agent_name).toBe('Security Reviewer');
    expect(row.notes).toBe('from finding:f1');
    expect(row.expected_count).toBe(1);
    expect(row.last_run).toEqual({
      ran_at: '2026-08-23T00:00:00.000Z',
      pass: true,
      recall: 1,
      precision: 1,
      citation_accuracy: 1,
      findings_count: 1,
      skills: [{ id: 's1', name: 'Attack surface inventory' }],
    });
  });

  it('drops a malformed skills entry the same way toCaseRow does', () => {
    const row = toSkillCaseRow(skillCaseRow({ skills: [{ id: 's1', name: 'Good' }, { id: 's2' }] }));
    expect(row.last_run?.skills).toEqual([{ id: 's1', name: 'Good' }]);
  });
});
