import { describe, expect, it } from 'vitest';
import {
  AGENT_DESCRIPTION_CHARS,
  CONVENTIONS_DEFAULT_LIMIT,
  CONVENTIONS_MAX_LIMIT,
  FINDINGS_DEFAULT_LIMIT,
  FINDINGS_MAX_LIMIT,
  RATIONALE_CHARS,
  SUGGESTION_CHARS,
  projectAgents,
  projectConventions,
  projectFindings,
  truncate,
} from '../src/project.js';
import type { AgentSummary, ConventionSummary, FindingSummary } from '../src/api/schemas.js';

const finding = (over: Partial<FindingSummary> = {}): FindingSummary => ({
  severity: 'WARNING',
  category: 'bug',
  title: 'A title',
  file: 'src/a.ts',
  start_line: 10,
  end_line: 10,
  rationale: 'because it is wrong',
  suggestion: null,
  confidence: 0.5,
  ...over,
});

/** A lone (unpaired) UTF-16 surrogate — what `String.slice` leaves behind. */
const LONE_HIGH = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/;
const LONE_LOW = /(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

describe('truncate', () => {
  it('returns the text untouched when it is under the cap', () => {
    expect(truncate('short', 500)).toBe('short');
  });

  it('is code-point safe when the cap lands MID-SURROGATE-PAIR', () => {
    // One ASCII char, then astral characters: every 𝒳 is 2 UTF-16 units, so the
    // leading 'A' makes UTF-16 unit 500 fall in the middle of a pair. Without it
    // the cap lands on a pair boundary and the test proves nothing
    // (root INSIGHTS.md §"An astral-character truncation test proves nothing
    // unless the cap lands mid-pair").
    const text = `A${'\u{1D4B3}'.repeat(600)}`;
    expect([...text].length).toBeGreaterThan(RATIONALE_CHARS);

    // The fixture discriminates: the naive implementation really would break here.
    expect(LONE_HIGH.test(text.slice(0, RATIONALE_CHARS))).toBe(true);

    const out = truncate(text, RATIONALE_CHARS);
    expect([...out]).toHaveLength(RATIONALE_CHARS + 1); // + the ellipsis
    expect(out.endsWith('…')).toBe(true);
    expect(LONE_HIGH.test(out)).toBe(false);
    expect(LONE_LOW.test(out)).toBe(false);
  });
});

describe('projectFindings', () => {
  it('keeps only the projected keys and drops every persisted/nested field', () => {
    const raw = {
      ...finding({ suggestion: 'do this instead' }),
      // Fields the plan names as dropped. They never survive `safeParse` either,
      // but the projection must not re-introduce them by spreading.
      id: 'f-uuid',
      review_id: 'r-uuid',
      accepted_at: null,
      dismissed_at: null,
      kind: 'lethal_trifecta',
      trifecta_components: ['private_data'],
      evidence: [{ file: 'x', line: 1 }],
    } as unknown as FindingSummary;

    const { findings } = projectFindings([raw]);
    const projected = findings[0];

    expect(Object.keys(projected!).sort()).toEqual([
      'category',
      'confidence',
      'file',
      'fix',
      'line',
      'severity',
      'title',
      'why',
    ]);
    for (const dropped of [
      'id',
      'review_id',
      'accepted_at',
      'dismissed_at',
      'kind',
      'trifecta_components',
      'evidence',
      'start_line',
      'end_line',
      'rationale',
      'suggestion',
    ]) {
      expect(projected).not.toHaveProperty(dropped);
    }
  });

  it('maps line/why/fix and rounds confidence to 2 decimal places', () => {
    const { findings } = projectFindings([
      finding({ start_line: 42, end_line: 42, confidence: 0.876_54, suggestion: 'use const' }),
    ]);
    expect(findings[0]).toMatchObject({
      line: 42,
      why: 'because it is wrong',
      fix: 'use const',
      confidence: 0.88,
    });
  });

  it('adds end_line only when it differs from start_line', () => {
    const { findings } = projectFindings([
      finding({ start_line: 10, end_line: 10 }),
      finding({ start_line: 20, end_line: 25, file: 'src/b.ts' }),
    ]);
    expect(findings[0]).not.toHaveProperty('end_line');
    expect(findings[1]).toMatchObject({ line: 20, end_line: 25 });
  });

  it('omits fix when there is no suggestion, and caps why/fix', () => {
    const { findings } = projectFindings([
      finding({ suggestion: null, rationale: 'r'.repeat(RATIONALE_CHARS + 50) }),
      finding({ suggestion: 's'.repeat(SUGGESTION_CHARS + 50), file: 'src/b.ts' }),
    ]);
    expect(findings[0]).not.toHaveProperty('fix');
    expect([...findings[0]!.why]).toHaveLength(RATIONALE_CHARS + 1);
    expect([...findings[1]!.fix!]).toHaveLength(SUGGESTION_CHARS + 1);
  });

  it('pins the order: severity, then confidence desc, then file, then line, then title', () => {
    const input = [
      finding({ severity: 'SUGGESTION', confidence: 0.99, file: 'a.ts', start_line: 1, title: 's1' }),
      finding({ severity: 'CRITICAL', confidence: 0.5, file: 'z.ts', start_line: 9, title: 'c-low' }),
      finding({ severity: 'CRITICAL', confidence: 0.9, file: 'b.ts', start_line: 3, title: 'c-b' }),
      finding({ severity: 'CRITICAL', confidence: 0.9, file: 'a.ts', start_line: 7, title: 'c-a7' }),
      finding({ severity: 'CRITICAL', confidence: 0.9, file: 'a.ts', start_line: 2, title: 'c-a2' }),
      finding({ severity: 'WARNING', confidence: 0.8, file: 'm.ts', start_line: 4, title: 'w1' }),
      finding({ severity: 'CRITICAL', confidence: 0.9, file: 'a.ts', start_line: 2, title: 'aaa' }),
    ];
    const { findings } = projectFindings(input);
    expect(findings.map((f) => f.title)).toEqual([
      'aaa',
      'c-a2',
      'c-a7',
      'c-b',
      'c-low',
      'w1',
      's1',
    ]);
  });

  it('defaults to 20 findings and explains the trim in a note', () => {
    const many = Array.from({ length: 47 }, (_, i) =>
      finding({ file: `src/${String(i).padStart(3, '0')}.ts` }),
    );
    const out = projectFindings(many);
    expect(out.findings).toHaveLength(FINDINGS_DEFAULT_LIMIT);
    expect(out.note).toBe(
      'showing 20 of 47 — call get_findings with severity="CRITICAL" or a higher limit',
    );
  });

  it('has no note when nothing was trimmed', () => {
    const out = projectFindings([finding()]);
    expect(out.note).toBeUndefined();
    expect(out).not.toHaveProperty('note');
  });

  it('caps an oversized limit at 100', () => {
    const many = Array.from({ length: 150 }, (_, i) =>
      finding({ file: `src/${String(i).padStart(3, '0')}.ts` }),
    );
    const out = projectFindings(many, { limit: 5000 });
    expect(out.findings).toHaveLength(FINDINGS_MAX_LIMIT);
    expect(out.note).toBe(
      'showing 100 of 150 — call get_findings with severity="CRITICAL" or a higher limit',
    );
  });
});

describe('projectAgents', () => {
  const agent = {
    id: 'a-uuid',
    name: 'Security Reviewer',
    description: 'd'.repeat(AGENT_DESCRIPTION_CHARS + 40),
    provider: 'openai',
    model: 'gpt-4o',
    system_prompt: 'THE-WHOLE-SYSTEM-PROMPT-THOUSANDS-OF-TOKENS',
    enabled: false,
    version: 3,
  } as unknown as AgentSummary;

  it('keeps name/description/model/enabled and drops system_prompt', () => {
    const [out] = projectAgents([agent]);
    expect(Object.keys(out!).sort()).toEqual(['description', 'enabled', 'model', 'name']);
    expect(JSON.stringify(out)).not.toContain('THE-WHOLE-SYSTEM-PROMPT');
    expect(out).toMatchObject({ name: 'Security Reviewer', model: 'gpt-4o', enabled: false });
  });

  it('caps the description', () => {
    const [out] = projectAgents([agent]);
    expect([...out!.description]).toHaveLength(AGENT_DESCRIPTION_CHARS + 1);
  });

  it('lists disabled agents rather than filtering them out', () => {
    const out = projectAgents([agent, { ...agent, name: 'Other', enabled: true } as AgentSummary]);
    expect(out.map((a) => a.enabled)).toEqual([false, true]);
  });
});

describe('projectConventions', () => {
  const candidate = (over: Partial<ConventionSummary> = {}): ConventionSummary => ({
    category: 'testing',
    rule: 'Server tests that touch Postgres are named *.it.test.ts',
    evidence_path: 'server/TESTING.md',
    evidence_line: 42,
    confidence: 0.9,
    status: 'accepted',
    ...over,
  });

  it('keeps category/rule/evidence/confidence and drops every persisted field', () => {
    const raw = {
      ...candidate(),
      id: 'c-uuid',
      repo_id: 'r-uuid',
      scan_id: 's-uuid',
      head_sha: 'deadbeef',
      created_at: '2026-08-08T10:00:00.000Z',
      evidence_snippet: 'export const x = 1;',
      evidence_end_line: 44,
      extra_evidence: [{ path: 'a.ts', line: 1, end_line: 2, snippet: 'x' }],
    } as unknown as ConventionSummary;

    const { conventions } = projectConventions([raw]);
    expect(Object.keys(conventions[0]!).sort()).toEqual([
      'category',
      'confidence',
      'evidence',
      'rule',
    ]);
    for (const dropped of [
      'id',
      'repo_id',
      'scan_id',
      'head_sha',
      'created_at',
      'evidence_snippet',
      'evidence_path',
      'evidence_line',
      'extra_evidence',
      'status',
    ]) {
      expect(conventions[0]!).not.toHaveProperty(dropped);
    }
    expect(JSON.stringify(conventions)).not.toContain('c-uuid');
  });

  it('collapses evidence to "path:line" and rounds confidence to 2 dp', () => {
    const { conventions } = projectConventions([candidate({ confidence: 0.876_54 })]);
    expect(conventions[0]).toMatchObject({
      evidence: 'server/TESTING.md:42',
      confidence: 0.88,
    });
  });

  it('keeps the path alone when the line is unknown, and omits evidence entirely when the path is', () => {
    const { conventions } = projectConventions([
      candidate({ evidence_line: null }),
      candidate({ evidence_path: null, evidence_line: null, rule: 'b', confidence: 0.8 }),
    ]);
    expect(conventions[0]!.evidence).toBe('server/TESTING.md');
    expect(conventions[1]).not.toHaveProperty('evidence');
  });

  it('omits confidence rather than reporting null', () => {
    const { conventions } = projectConventions([candidate({ confidence: null })]);
    expect(conventions[0]).not.toHaveProperty('confidence');
  });

  it('pins the order: confidence desc, unscored last, then category, then rule', () => {
    const input = [
      candidate({ confidence: null, rule: 'unscored', category: 'a' }),
      candidate({ confidence: 0.5, rule: 'low', category: 'a' }),
      candidate({ confidence: 0.9, rule: 'b-rule', category: 'style' }),
      candidate({ confidence: 0.9, rule: 'a-rule', category: 'style' }),
      candidate({ confidence: 0.9, rule: 'z-rule', category: 'errors' }),
    ];
    const { conventions } = projectConventions(input);
    expect(conventions.map((c) => c.rule)).toEqual([
      'z-rule',
      'a-rule',
      'b-rule',
      'low',
      'unscored',
    ]);
  });

  it('defaults to 50 and explains the trim in a note', () => {
    const many = Array.from({ length: 63 }, (_, i) =>
      candidate({ rule: `rule ${String(i).padStart(3, '0')}` }),
    );
    const out = projectConventions(many);
    expect(out.conventions).toHaveLength(CONVENTIONS_DEFAULT_LIMIT);
    expect(out.note).toBe('showing 50 of 63 — call get_conventions with a higher limit');
  });

  it('has no note when nothing was trimmed, and caps an oversized limit', () => {
    expect(projectConventions([candidate()])).not.toHaveProperty('note');
    const many = Array.from({ length: 250 }, (_, i) => candidate({ rule: `rule ${i}` }));
    expect(projectConventions(many, { limit: 5000 }).conventions).toHaveLength(
      CONVENTIONS_MAX_LIMIT,
    );
  });
});
