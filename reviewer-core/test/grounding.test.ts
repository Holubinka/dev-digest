/**
 * groundFindings — the cost of a finding's line range must follow the diff, not
 * the number the model wrote down.
 *
 * `start_line`/`end_line` are model output with no upper bound in the contract
 * (`Finding` declares them `z.number().int()`), and the model's input is the
 * attacker-supplied diff body. Walking every integer of the declared range
 * blocked the single-threaded event loop for 13.4 s on `end_line: 2e9`
 * (measured 2026-08-09). Walking the hunk line set instead is the same
 * predicate — "is any covered line inside [lo, hi]" — at the cost of the lines
 * the diff actually covers.
 *
 * These tests pin BOTH halves: the equivalence (a large range is judged on
 * overlap, never refused for being large) and the cost.
 */
import { describe, it, expect } from 'vitest';
import type { Finding, UnifiedDiff } from '@devdigest/shared';
import { groundFindings } from '../src/grounding.js';

/** One file, one hunk, one covered new-side line: 10. */
const DIFF: UnifiedDiff = {
  raw: '',
  files: [
    {
      path: 'src/a.ts',
      additions: 1,
      deletions: 0,
      hunks: [
        {
          file: 'src/a.ts',
          oldStart: 10,
          oldLines: 0,
          newStart: 10,
          newLines: 1,
          newLineNumbers: [10],
        },
      ],
    },
  ],
};

function f(partial: Partial<Finding>): Finding {
  return {
    id: 'x',
    severity: 'WARNING',
    category: 'bug',
    title: 't',
    file: 'src/a.ts',
    start_line: 10,
    end_line: 10,
    rationale: 'r',
    confidence: 0.8,
    ...partial,
  };
}

function elapsedMs(fn: () => void): number {
  const t0 = performance.now();
  fn();
  return performance.now() - t0;
}

describe('groundFindings — range intersection', () => {
  it('keeps a finding whose range overlaps a covered line', () => {
    const res = groundFindings([f({ start_line: 8, end_line: 12 })], DIFF);
    expect(res.kept).toHaveLength(1);
    expect(res.dropped).toHaveLength(0);
  });

  it('drops a finding whose range misses every covered line', () => {
    const res = groundFindings([f({ start_line: 11, end_line: 40 })], DIFF);
    expect(res.kept).toHaveLength(0);
    expect(res.dropped[0]!.reason).toMatch(/do not intersect/);
  });

  it('reads a reversed range the same way round', () => {
    const res = groundFindings([f({ start_line: 12, end_line: 8 })], DIFF);
    expect(res.kept).toHaveLength(1);
  });

  it('keeps an absurdly large range that still overlaps — size is not a reason to drop', () => {
    const res = groundFindings([f({ start_line: 1, end_line: 2_000_000_000 })], DIFF);
    expect(res.kept).toHaveLength(1);
  });
});

describe('groundFindings — cost follows the diff, not the declared range', () => {
  // Before the fix this walked 2e9 integers and blocked for ~13.4 s, so the
  // budget below is the regression: it is the ONE case an attacker controls for
  // free, since a range that misses every hunk line has no early exit.
  it('answers a 2e9-line miss in under 250 ms', () => {
    let res!: ReturnType<typeof groundFindings>;
    const ms = elapsedMs(() => {
      res = groundFindings([f({ start_line: 1_000_000_000, end_line: 2_000_000_000 })], DIFF);
    });
    expect(res.kept).toHaveLength(0);
    expect(ms).toBeLessThan(250);
  });

  it('answers one finding per enabled agent within the same budget', () => {
    const findings = Array.from({ length: 8 }, (_, i) =>
      f({ id: `f${i}`, start_line: 1_000_000_000, end_line: 2_000_000_000 }),
    );
    const ms = elapsedMs(() => groundFindings(findings, DIFF));
    expect(ms).toBeLessThan(250);
  });
});
