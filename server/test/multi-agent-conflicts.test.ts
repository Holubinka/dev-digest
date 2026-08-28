/**
 * The disagreement grouper — `modules/reviews/conflicts.ts`.
 *
 * Hermetic and model-free by construction: the rule is deterministic
 * (SPEC-05 § AC-65) while its INPUT is not, so every case here hands it a fixed
 * finding set rather than running an agent. Nothing in this file touches a
 * network, a disk or a clock.
 *
 * The case that matters most is `a failed run with no findings is not ignored`.
 * It is the defect the 2026-08-26 amendment exists for (AC-119, AC-120): a run
 * that never reached `done` produced no findings, and a grouper that asks "did
 * this agent flag here?" before it asks "did this agent get to look?" answers
 * `ignored` — the word for an agent that looked and passed. The shape of the
 * response is identical either way; only the word is a lie.
 */
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_TITLE_SIMILARITY,
  DEFAULT_TITLE_STOP_WORDS,
  buildConflicts,
  normalizeTitle,
} from '../src/modules/reviews/conflicts.js';
import type { AgentColumnStatus, FindingRecord } from '@devdigest/shared';

const finding = (over: Partial<FindingRecord> & { id: string }): FindingRecord => ({
  severity: 'WARNING',
  category: 'bug',
  title: 'Unbounded loop over the request body',
  file: 'src/limiter.ts',
  start_line: 10,
  end_line: 12,
  rationale: 'The loop has no upper bound.',
  suggestion: null,
  confidence: 0.5,
  kind: 'finding',
  trifecta_components: null,
  evidence: null,
  review_id: 'rev-1',
  accepted_at: null,
  dismissed_at: null,
  ...over,
});

const agentRow = (n: number, status: AgentColumnStatus = 'done') => ({
  runId: `run-${n}`,
  agentId: `agent-${n}`,
  agentName: `Agent ${n}`,
  status,
});

const from = (n: number, f: FindingRecord) => ({ runId: `run-${n}`, finding: f });

describe('normalizeTitle', () => {
  it('lowercases, splits on non-alphanumerics, drops short tokens and stop-words, dedupes and sorts', () => {
    expect(normalizeTitle('The SQL injection in the SQL query (a big one)')).toEqual([
      'big',
      'injection',
      'one',
      'query',
      'sql',
    ]);
  });

  it('never builds a pattern out of the title — a regex metacharacter is just a separator', () => {
    // If the splitter were built from the input this would throw or hang; it
    // must simply tokenize (SPEC-05 § Untrusted inputs, `security` § ReDoS).
    expect(normalizeTitle('(a+)+$ ^(([a-z])+.)+[A-Z]?$ overflow')).toEqual(['overflow']);
  });

  it('returns nothing for a title made only of stop-words and punctuation', () => {
    expect(normalizeTitle('the ... of a')).toEqual([]);
  });

  it('exposes its parameters with named defaults (AC-67)', () => {
    expect(DEFAULT_TITLE_SIMILARITY).toBe(0.5);
    expect(DEFAULT_TITLE_STOP_WORDS.has('the')).toBe(true);
  });
});

describe('grouping findings into positions (AC-66, AC-68)', () => {
  it('groups two agents on the same file, overlapping lines and the same category', () => {
    const out = buildConflicts(
      [agentRow(1), agentRow(2)],
      [
        from(1, finding({ id: 'f1', title: 'Missing rate limit', category: 'security' })),
        from(2, finding({ id: 'f2', title: 'No throttling anywhere', category: 'security', start_line: 11, end_line: 14 })),
      ],
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ file: 'src/limiter.ts', start_line: 10, end_line: 14 });
  });

  it('groups on similar titles when the categories differ', () => {
    const out = buildConflicts(
      [agentRow(1), agentRow(2)],
      [
        from(1, finding({ id: 'f1', title: 'Hardcoded Stripe secret key', category: 'security' })),
        from(2, finding({ id: 'f2', title: 'Stripe secret key hardcoded here', category: 'bug' })),
      ],
    );
    expect(out).toHaveLength(1);
  });

  it('does not group the same file when the line ranges do not overlap', () => {
    const out = buildConflicts(
      [agentRow(1), agentRow(2)],
      [
        from(1, finding({ id: 'f1', start_line: 10, end_line: 12 })),
        from(2, finding({ id: 'f2', start_line: 13, end_line: 20 })),
      ],
    );
    // TWO positions, not one span from 10 to 20. The case is about the absence
    // of a JOIN, and since 2026-08-27 an unjoined finding is still a position.
    expect(out.map((c) => [c.start_line, c.end_line])).toEqual([
      [10, 12],
      [13, 20],
    ]);
  });

  it('does not group different files, however similar the titles', () => {
    const out = buildConflicts(
      [agentRow(1), agentRow(2)],
      [
        from(1, finding({ id: 'f1', file: 'src/a.ts' })),
        from(2, finding({ id: 'f2', file: 'src/b.ts' })),
      ],
    );
    expect(out.map((c) => c.file)).toEqual(['src/a.ts', 'src/b.ts']);
    // Each is its own place, and the other agent is silent about it rather than
    // absent from it — one take per agent, always (AC-70).
    expect(out.map((c) => c.takes.map((t) => t.verdict))).toEqual([
      ['WARNING', 'ignored'],
      ['ignored', 'WARNING'],
    ]);
  });

  it('puts a chain A~B, B~C into ONE component even when A and C do not relate', () => {
    const out = buildConflicts(
      [agentRow(1), agentRow(2), agentRow(3)],
      [
        from(1, finding({ id: 'a', start_line: 10, end_line: 12 })),
        from(2, finding({ id: 'b', start_line: 12, end_line: 20 })),
        from(3, finding({ id: 'c', start_line: 19, end_line: 25 })),
      ],
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.start_line).toBe(10);
    expect(out[0]!.end_line).toBe(25);
  });

  /**
   * THE 2026-08-27 DECISION, and the case that forced it. A component only one
   * run touched used to be dropped as soon as two agents had finished, which
   * emptied the section in exactly the situation the mockup draws — one agent
   * flags, the rest finish and say nothing
   * (`specs/assets/SPEC-05-multi-agent-review-columns.png`, "Magic number 3600":
   * one SUGGESTION beside two `did not flag`). A finished agent's silence is an
   * opinion, so the component stays and the others speak as `ignored`.
   */
  it('keeps a single-agent cluster while three agents reached done (2026-08-27)', () => {
    const out = buildConflicts(
      [agentRow(1), agentRow(2), agentRow(3)],
      [
        from(1, finding({ id: 'shared-a', file: 'src/a.ts' })),
        from(2, finding({ id: 'shared-b', file: 'src/a.ts' })),
        // Nobody else looked at src/lonely.ts.
        from(3, finding({ id: 'lonely', file: 'src/lonely.ts' })),
      ],
    );
    expect(out.map((c) => c.file)).toEqual(['src/a.ts', 'src/lonely.ts']);
    expect(out[1]!.takes.map((t) => t.verdict)).toEqual(['ignored', 'ignored', 'WARNING']);
  });

  /**
   * The only remaining way the grouping returns nothing with two finished
   * agents: they found nothing. Findings in DIFFERENT places no longer empty it
   * — each is now its own position, which the different-files case above pins —
   * so AC-111's "the agents looked at different places" text is left addressing
   * this line alone.
   * Reported to the human on 2026-08-27; the wording is the spec's to re-decide,
   * not this function's.
   */
  it('is empty when the finished agents found nothing at all (AC-111)', () => {
    expect(buildConflicts([agentRow(1), agentRow(2)], [])).toEqual([]);
  });

  it('returns a deep-equal result for the same input twice, in the same order (AC-69)', () => {
    const agents = [agentRow(1), agentRow(2), agentRow(3)];
    const findings = [
      from(1, finding({ id: 'z', file: 'src/z.ts', start_line: 5, end_line: 6 })),
      from(2, finding({ id: 'y', file: 'src/z.ts', start_line: 6, end_line: 9, severity: 'CRITICAL' })),
      from(3, finding({ id: 'x', file: 'src/a.ts', start_line: 1, end_line: 2 })),
      from(1, finding({ id: 'w', file: 'src/a.ts', start_line: 2, end_line: 3 })),
    ];
    const first = buildConflicts(agents, findings);
    const second = buildConflicts(agents, findings);
    expect(second).toEqual(first);
    // And the order is the stated one: file ascending.
    expect(first.map((c) => c.file)).toEqual(['src/a.ts', 'src/z.ts']);
  });

  it('groups 10 agents × 50 findings in well under 250 ms (§ Non-functional requirements)', () => {
    const agents = Array.from({ length: 10 }, (_, i) => agentRow(i + 1));
    const findings = agents.flatMap((_, a) =>
      Array.from({ length: 50 }, (_, k) =>
        from(a + 1, finding({
          id: `f-${a}-${k}`,
          file: `src/file-${k % 10}.ts`,
          start_line: k * 2,
          end_line: k * 2 + 3,
          title: `Issue number ${k} in module ${k % 4}`,
        })),
      ),
    );
    expect(findings).toHaveLength(500);
    const start = performance.now();
    const out = buildConflicts(agents, findings);
    const elapsed = performance.now() - start;
    expect(out.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(250);
  });
});

describe('the take each agent gets in a position (AC-70 … AC-73)', () => {
  it('gives one take per agent, in the agents array order (AC-46, AC-70)', () => {
    const out = buildConflicts(
      [agentRow(3), agentRow(1), agentRow(2)],
      [
        from(3, finding({ id: 'f3' })),
        from(1, finding({ id: 'f1' })),
      ],
    );
    expect(out[0]!.takes.map((t) => t.run_id)).toEqual(['run-3', 'run-1', 'run-2']);
    expect(out[0]!.takes.map((t) => t.persona)).toEqual(['Agent 3', 'Agent 1', 'Agent 2']);
  });

  it('gives a done agent that did not flag here `ignored` and no note (AC-71)', () => {
    const out = buildConflicts(
      [agentRow(1), agentRow(2), agentRow(3)],
      [from(1, finding({ id: 'f1' })), from(2, finding({ id: 'f2' }))],
    );
    const silent = out[0]!.takes.find((t) => t.run_id === 'run-3')!;
    expect(silent).toMatchObject({ verdict: 'ignored', note: null });
  });

  it('gives a flagging agent its severity and the finding rationale as the note (AC-72)', () => {
    const out = buildConflicts(
      [agentRow(1), agentRow(2)],
      [
        from(1, finding({ id: 'f1', severity: 'CRITICAL', rationale: 'A live key is committed.' })),
        from(2, finding({ id: 'f2', severity: 'SUGGESTION' })),
      ],
    );
    expect(out[0]!.takes[0]).toMatchObject({
      verdict: 'CRITICAL',
      note: 'A live key is committed.',
    });
    expect(out[0]!.takes[1]!.verdict).toBe('SUGGESTION');
  });

  it('speaks through the heaviest finding when one agent has two in a position (AC-73)', () => {
    const out = buildConflicts(
      [agentRow(1), agentRow(2)],
      [
        from(1, finding({ id: 'light', severity: 'SUGGESTION', rationale: 'minor' })),
        from(1, finding({ id: 'heavy', severity: 'CRITICAL', rationale: 'severe', start_line: 11 })),
        from(2, finding({ id: 'other', severity: 'WARNING' })),
      ],
    );
    expect(out[0]!.takes[0]).toMatchObject({ verdict: 'CRITICAL', note: 'severe' });
  });

  it('takes the position title from the heaviest member (AC-74)', () => {
    const out = buildConflicts(
      [agentRow(1), agentRow(2)],
      [
        from(1, finding({ id: 'f1', severity: 'SUGGESTION', title: 'Consider a limiter' })),
        from(2, finding({ id: 'f2', severity: 'CRITICAL', title: 'No rate limit at all' })),
      ],
    );
    expect(out[0]!.title).toBe('No rate limit at all');
  });

  it('breaks a severity tie by confidence, then start line, then id — a total order', () => {
    const out = buildConflicts(
      [agentRow(1), agentRow(2)],
      [
        from(1, finding({ id: 'b', severity: 'WARNING', confidence: 0.9, title: 'Second by id' })),
        from(1, finding({ id: 'a', severity: 'WARNING', confidence: 0.9, title: 'First by id' })),
        from(2, finding({ id: 'c', severity: 'WARNING', confidence: 0.4, title: 'Least confident' })),
      ],
    );
    expect(out[0]!.title).toBe('First by id');
  });
});

describe('a run that never reached done has no opinion (AC-119 … AC-125)', () => {
  const NON_DONE: AgentColumnStatus[] = ['queued', 'running', 'failed', 'cancelled'];

  it.each(NON_DONE)('gives a %s run `not_reviewed` with no note', (status) => {
    const out = buildConflicts(
      [agentRow(1), agentRow(2), agentRow(3, status)],
      [from(1, finding({ id: 'f1' })), from(2, finding({ id: 'f2' }))],
    );
    const take = out[0]!.takes.find((t) => t.run_id === 'run-3')!;
    expect(take).toEqual({
      run_id: 'run-3',
      agent_id: 'agent-3',
      persona: 'Agent 3',
      verdict: 'not_reviewed',
      note: null,
    });
  });

  /**
   * THE REGRESSION THE 2026-08-26 AMENDMENT EXISTS FOR.
   *
   * A failed run persists no review, so it contributes no findings — exactly
   * like a `done` agent that flagged nothing. Ask about findings first and both
   * answer `ignored`, and the section then reports that a crashed agent looked
   * at the position and passed. The multi-run has ENDED here, so there is no
   * later moment at which the word gets corrected (AC-120).
   */
  it('does not let a failed run with no findings decay to `ignored` (AC-120)', () => {
    const out = buildConflicts(
      [agentRow(1), agentRow(2), agentRow(3, 'failed')],
      [from(1, finding({ id: 'f1' })), from(2, finding({ id: 'f2' }))],
    );
    const take = out[0]!.takes.find((t) => t.run_id === 'run-3')!;
    expect(take.verdict).toBe('not_reviewed');
    expect(take.verdict).not.toBe('ignored');
    expect(take.note).toBeNull();
  });

  /**
   * A run can be non-terminal and still have persisted findings — a `running`
   * multi-run whose map-reduce wrote a review already. The verdict is decided by
   * the STATE, not by the absence of findings, so those findings neither give it
   * an opinion here nor enter the grouping.
   */
  it('gives `not_reviewed` even to a non-done run that does carry findings', () => {
    const out = buildConflicts(
      [agentRow(1), agentRow(2), agentRow(3, 'running')],
      [
        from(1, finding({ id: 'f1' })),
        from(2, finding({ id: 'f2' })),
        from(3, finding({ id: 'f3', severity: 'CRITICAL' })),
      ],
    );
    const take = out[0]!.takes.find((t) => t.run_id === 'run-3')!;
    expect(take.verdict).toBe('not_reviewed');
    expect(take.note).toBeNull();
  });

  /**
   * AC-128: a lone finding stays visible with the no-opinion takes beside it, so
   * it cannot read as one the others rejected. Since 2026-08-27 EVERY one-agent
   * component survives, so this is no longer the exception it was — what it
   * still pins is the word: peers that never finished are `not_reviewed` here,
   * never the `ignored` that a finished silent agent gets.
   */
  it('keeps a lone finding visible when its two peers failed (AC-128)', () => {
    const out = buildConflicts(
      [agentRow(1), agentRow(2, 'failed'), agentRow(3, 'failed')],
      [from(1, finding({ id: 'f1' }))],
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.takes.map((t) => t.verdict)).toEqual([
      'WARNING',
      'not_reviewed',
      'not_reviewed',
    ]);
  });
});
