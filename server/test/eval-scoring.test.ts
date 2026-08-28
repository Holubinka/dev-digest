/**
 * L06 — the scorer, AC-38 … AC-51.
 *
 * THIS FILE CONSTRUCTS NO CONTAINER AND NO PROVIDER, and that is the point
 * rather than tidiness: AC-38 says all three metrics are computed with zero
 * model calls, and a suite that reached a container would prove nothing about
 * it. The only import below is the module under test.
 */
import { describe, it, expect } from 'vitest';
import type { EvalExpectation, Finding } from '@devdigest/shared';
import {
  creditFindings,
  dedupeOverlapping,
  poolBatch,
  scoreCase,
  type ScoreCounters,
} from '../src/modules/eval/scoring.js';

function expectation(over: Partial<EvalExpectation> = {}): EvalExpectation {
  return {
    file: 'src/a.ts',
    start_line: 10,
    end_line: 12,
    polarity: 'must_find',
    severity: null,
    category: null,
    title: null,
    ...over,
  };
}

function finding(over: Partial<Finding> = {}): Finding {
  return {
    id: 'f1',
    severity: 'WARNING',
    category: 'bug',
    title: 'Something',
    file: 'src/a.ts',
    start_line: 11,
    end_line: 11,
    rationale: 'because',
    suggestion: null,
    confidence: 0.9,
    kind: 'finding',
    trifecta_components: null,
    evidence: null,
    ...over,
  };
}

describe('creditFindings — AC-39, AC-40', () => {
  it('credits on same file + intersecting range, ignoring severity/category/title', () => {
    const exps = [expectation({ severity: 'CRITICAL', category: 'security', title: 'X' })];
    const found = [finding({ severity: 'SUGGESTION', category: 'style', title: 'utterly different' })];
    const { findingForExpectation } = creditFindings(exps, found);
    expect(findingForExpectation).toEqual([0]);
  });

  it('does not credit across files, even at the same lines', () => {
    const { findingForExpectation } = creditFindings(
      [expectation({ file: 'src/a.ts' })],
      [finding({ file: 'src/b.ts' })],
    );
    expect(findingForExpectation).toEqual([-1]);
  });

  it('does not credit a non-intersecting range in the same file', () => {
    const { findingForExpectation } = creditFindings(
      [expectation({ start_line: 10, end_line: 12 })],
      [finding({ start_line: 40, end_line: 41 })],
    );
    expect(findingForExpectation).toEqual([-1]);
  });

  it('credits at most one finding per expectation (two duplicates → one credit)', () => {
    const { findingForExpectation, expectationForFinding } = creditFindings(
      [expectation()],
      [finding({ id: 'f1' }), finding({ id: 'f2' })],
    );
    expect(findingForExpectation).toEqual([0]);
    expect(expectationForFinding).toEqual([0, -1]);
  });

  it('credits at most one expectation per finding (one finding, two expectations)', () => {
    const { findingForExpectation } = creditFindings(
      [expectation({ start_line: 10, end_line: 12 }), expectation({ start_line: 11, end_line: 20 })],
      [finding({ start_line: 11, end_line: 11 })],
    );
    expect(findingForExpectation).toEqual([0, -1]);
  });

  it('is deterministic — array order decides, so AC-26 is checkable', () => {
    const exps = [expectation({ start_line: 1, end_line: 100 }), expectation({ start_line: 1, end_line: 100 })];
    const found = [finding({ id: 'a', start_line: 5, end_line: 5 }), finding({ id: 'b', start_line: 6, end_line: 6 })];
    for (let i = 0; i < 5; i++) {
      expect(creditFindings(exps, found).findingForExpectation).toEqual([0, 1]);
    }
  });
});

describe('dedupeOverlapping — one real issue reported as several adjacent findings', () => {
  it('collapses two findings that overlap each other into one, spanning their union', () => {
    const result = dedupeOverlapping([
      finding({ id: 'a', start_line: 63, end_line: 70 }),
      finding({ id: 'b', start_line: 64, end_line: 73 }),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]!.start_line).toBe(63);
    expect(result[0]!.end_line).toBe(73);
  });

  it('does NOT collapse findings whose ranges never touch — that is still noise (D7)', () => {
    const result = dedupeOverlapping([
      finding({ id: 'a', start_line: 10, end_line: 10 }),
      finding({ id: 'b', start_line: 50, end_line: 50 }),
    ]);
    expect(result).toHaveLength(2);
  });

  it('does not collapse across files, even at identical line numbers', () => {
    const result = dedupeOverlapping([
      finding({ id: 'a', file: 'src/a.ts', start_line: 10, end_line: 10 }),
      finding({ id: 'b', file: 'src/b.ts', start_line: 10, end_line: 10 }),
    ]);
    expect(result).toHaveLength(2);
  });

  it('is transitive — A-B overlap and B-C overlap merge all three, even though A and C do not touch', () => {
    const result = dedupeOverlapping([
      finding({ id: 'a', start_line: 10, end_line: 15 }),
      finding({ id: 'b', start_line: 14, end_line: 20 }),
      finding({ id: 'c', start_line: 19, end_line: 25 }),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]!.start_line).toBe(10);
    expect(result[0]!.end_line).toBe(25);
  });

  it('leaves a lone finding untouched, same object shape', () => {
    const result = dedupeOverlapping([finding({ id: 'solo' })]);
    expect(result).toEqual([finding({ id: 'solo' })]);
  });
});

describe('scoreCase — dedup changes precision/pass but never citation_accuracy', () => {
  it('two overlapping findings that both cover a real must_find no longer fail the case on noise', () => {
    const score = scoreCase({
      expectations: [expectation({ start_line: 17, end_line: 20 })],
      kept: [
        finding({ id: 'a', start_line: 15, end_line: 18 }),
        finding({ id: 'b', start_line: 16, end_line: 16 }),
      ],
      returned: 2,
    });
    expect(score.recall).toBe(1);
    expect(score.precision).toBe(1);
    expect(score.pass).toBe(true);
  });

  it('citation_accuracy is computed from the RAW count — dedup never touches it', () => {
    const score = scoreCase({
      expectations: [expectation({ start_line: 17, end_line: 20 })],
      kept: [
        finding({ id: 'a', start_line: 15, end_line: 18 }),
        finding({ id: 'b', start_line: 16, end_line: 16 }),
      ],
      returned: 3, // one finding was dropped by the gate
    });
    // 2 kept (raw) / 3 returned — unaffected by the two kept findings collapsing to one.
    expect(score.citation_accuracy).toBeCloseTo(2 / 3);
  });

  it('two findings in genuinely unrelated spots still fail the case — dedup does not launder real noise', () => {
    const score = scoreCase({
      expectations: [
        expectation({ start_line: 17, end_line: 20 }),
        expectation({ polarity: 'must_not_flag', file: 'src/b.ts', start_line: 5, end_line: 5 }),
      ],
      kept: [
        finding({ id: 'a', start_line: 17, end_line: 20 }),
        finding({ id: 'b', file: 'src/c.ts', start_line: 99, end_line: 99 }),
      ],
      returned: 2,
    });
    expect(score.recall).toBe(1);
    expect(score.pass).toBe(false); // the src/c.ts finding matches nothing and never touched the first
  });
});

describe('scoreCase — AC-41 … AC-49', () => {
  it('a credited must_find gives recall 1, precision 1 and a pass', () => {
    const score = scoreCase({ expectations: [expectation()], kept: [finding()], returned: 1 });
    expect(score).toMatchObject({ pass: true, recall: 1, precision: 1, citation_accuracy: 1 });
  });

  it('an uncredited must_find gives recall 0 and no pass', () => {
    const score = scoreCase({ expectations: [expectation()], kept: [], returned: 0 });
    expect(score.recall).toBe(0);
    expect(score.pass).toBe(false);
  });

  it('AC-43 — a finding on a must_not_flag is noise: precision drops, no pass', () => {
    const score = scoreCase({
      expectations: [expectation({ polarity: 'must_not_flag' })],
      kept: [finding()],
      returned: 1,
    });
    expect(score.precision).toBe(0);
    expect(score.pass).toBe(false);
    // AC-47 — no must_find at all, so per-case recall is 1 …
    expect(score.recall).toBe(1);
    // … and nothing is added to the pooled recall denominator.
    expect(score.counters.mustFindTotal).toBe(0);
  });

  it('AC-44 — an unrelated finding elsewhere in the same fragment is noise too', () => {
    const score = scoreCase({
      expectations: [expectation()],
      kept: [finding(), finding({ id: 'f2', start_line: 90, end_line: 90 })],
      returned: 2,
    });
    expect(score.recall).toBe(1);
    expect(score.precision).toBe(0.5);
    expect(score.pass).toBe(false);
  });

  it('AC-45/AC-46 — a dropped finding lowers citation_accuracy and is outside precision', () => {
    // 1 kept (credited) + 2 the gate dropped = 3 returned.
    const score = scoreCase({ expectations: [expectation()], kept: [finding()], returned: 3 });
    expect(score.citation_accuracy).toBeCloseTo(1 / 3);
    expect(score.precision).toBe(1);
    expect(score.counters.keptTotal).toBe(1);
  });

  it('AC-48 — no findings at all: precision and citation_accuracy are 1, denominators 0', () => {
    const score = scoreCase({ expectations: [], kept: [], returned: 0 });
    expect(score).toMatchObject({ pass: true, recall: 1, precision: 1, citation_accuracy: 1 });
    expect(score.counters).toEqual({
      mustFindTotal: 0,
      mustFindCredited: 0,
      keptTotal: 0,
      dedupedTotal: 0,
      dedupedCredited: 0,
      returnedTotal: 0,
    });
  });

  it('AC-49 — a case passes only with every must_find credited AND no noise', () => {
    const both = scoreCase({
      expectations: [expectation()],
      kept: [finding(), finding({ id: 'noise', start_line: 80, end_line: 80 })],
      returned: 2,
    });
    expect(both.recall).toBe(1);
    expect(both.pass).toBe(false);
  });

  it('AC-51 — all three stay inside [0, 1]', () => {
    const score = scoreCase({
      expectations: [expectation(), expectation({ start_line: 50, end_line: 51 })],
      kept: [finding(), finding({ id: 'x', start_line: 70, end_line: 71 })],
      returned: 9,
    });
    for (const v of [score.recall, score.precision, score.citation_accuracy]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

describe('poolBatch — AC-50 (micro-average, never the mean of per-case values)', () => {
  const c = (over: Partial<ScoreCounters>): ScoreCounters => ({
    mustFindTotal: 0,
    mustFindCredited: 0,
    keptTotal: 0,
    dedupedTotal: 0,
    dedupedCredited: 0,
    returnedTotal: 0,
    ...over,
  });

  it('one case of ten expectations does not weigh the same as ten cases of one', () => {
    // Case A: 10 must_find, 0 credited. Case B: 1 must_find, 1 credited.
    const pooled = poolBatch([
      c({ mustFindTotal: 10, mustFindCredited: 0 }),
      c({ mustFindTotal: 1, mustFindCredited: 1 }),
    ]);
    // Micro-average = 1/11. The mean of per-case recalls would be 0.5.
    expect(pooled.recall).toBeCloseTo(1 / 11);
    expect(pooled.recall).not.toBeCloseTo(0.5);
  });

  it('pools precision and citation_accuracy over the summed denominators', () => {
    const pooled = poolBatch([
      c({ dedupedTotal: 4, dedupedCredited: 2, keptTotal: 4, returnedTotal: 8 }),
      c({ dedupedTotal: 6, dedupedCredited: 6, keptTotal: 6, returnedTotal: 6 }),
    ]);
    expect(pooled.precision).toBeCloseTo(8 / 10);
    expect(pooled.citation_accuracy).toBeCloseTo(10 / 14);
  });

  it('an empty counter list pools to 1 — the same rule AC-47/AC-48 give per case', () => {
    expect(poolBatch([])).toEqual({ recall: 1, precision: 1, citation_accuracy: 1 });
  });

  it('AC-33 — a case that contributes no counters is outside every denominator', () => {
    const withErrored = poolBatch([c({ mustFindTotal: 2, mustFindCredited: 1 })]);
    const withoutErrored = poolBatch([
      c({ mustFindTotal: 2, mustFindCredited: 1 }),
      // an errored case is simply never passed in
    ]);
    expect(withErrored).toEqual(withoutErrored);
    expect(withErrored.recall).toBe(0.5);
  });
});
