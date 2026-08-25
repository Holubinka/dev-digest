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

describe('groundFindings — quote self-check corrects or drops a wrong line number', () => {
  // A real diff with real line text, unlike DIFF above (raw: '' is fine when
  // no test in this block needs the quote path). newLineNumbers still has to
  // agree with what parsing `raw` would produce — `newStart: 10` here matches.
  const QUOTE_DIFF: UnifiedDiff = {
    raw: [
      'diff --git a/src/config.ts b/src/config.ts',
      '--- a/src/config.ts',
      '+++ b/src/config.ts',
      '@@ -8,4 +8,9 @@',
      ' export const config = {',
      '   port: Number(process.env.PORT ?? 3000),',
      "+  stripeKey: 'sk_live_FAKE',",
      '   redisUrl: process.env.REDIS_URL,',
      '+  rateLimit: {',
      '+    anonymous: 60,',
      '+  },',
      ' };',
      '',
    ].join('\n'),
    files: [
      {
        path: 'src/config.ts',
        additions: 4,
        deletions: 0,
        hunks: [
          {
            file: 'src/config.ts',
            oldStart: 8,
            oldLines: 4,
            newStart: 8,
            newLines: 9,
            newLineNumbers: [8, 9, 10, 11, 12, 13, 14, 15, 16],
          },
        ],
      },
    ],
  };

  it('heals a unique quote match onto its real line when the declared number misses', () => {
    // Line 10 is the stripeKey line; the model named line 9 but quoted line 10's
    // text verbatim — the case this feature exists for.
    const res = groundFindings(
      [f({ file: 'src/config.ts', start_line: 9, end_line: 9, quote: "stripeKey: 'sk_live_FAKE'," })],
      QUOTE_DIFF,
    );
    expect(res.dropped).toHaveLength(0);
    expect(res.kept).toHaveLength(1);
    expect(res.kept[0]!.start_line).toBe(10);
    expect(res.kept[0]!.end_line).toBe(10);
  });

  it('leaves a correct declared line untouched — the quote only matters when the number is wrong', () => {
    const res = groundFindings(
      [f({ file: 'src/config.ts', start_line: 10, end_line: 10, quote: "stripeKey: 'sk_live_FAKE'," })],
      QUOTE_DIFF,
    );
    expect(res.kept).toHaveLength(1);
    expect(res.kept[0]!.start_line).toBe(10);
  });

  it('drops a finding whose quote is not in the diff at all — a stronger signal than a bare wrong number', () => {
    const res = groundFindings(
      [f({ file: 'src/config.ts', start_line: 9, end_line: 9, quote: 'this text does not exist anywhere' })],
      QUOTE_DIFF,
    );
    expect(res.kept).toHaveLength(0);
    expect(res.dropped[0]!.reason).toMatch(/quote was not found/);
  });

  it('falls back to the plain number check when the quote matches more than one line — ambiguous, does not guess', () => {
    // 'process.env' appears on two lines (PORT and REDIS_URL) — genuinely
    // ambiguous, and the declared line (20) is outside the diff either way.
    const res = groundFindings(
      [f({ file: 'src/config.ts', start_line: 20, end_line: 20, quote: 'process.env' })],
      QUOTE_DIFF,
    );
    expect(res.kept).toHaveLength(0);
    expect(res.dropped[0]!.reason).toMatch(/too ambiguous/);
  });

  it('a quote longer than the short-excerpt cap is ignored — falls back to the plain number check', () => {
    const longQuote = 'x'.repeat(600);
    const res = groundFindings(
      [f({ file: 'src/config.ts', start_line: 9, end_line: 9, quote: longQuote })],
      QUOTE_DIFF,
    );
    // Declared line 9 does not intersect a covered line here? It does (9 is
    // covered) — so this proves the long quote was never even looked at: kept
    // on the number alone, not corrected or dropped for the fake text.
    expect(res.kept).toHaveLength(1);
    expect(res.kept[0]!.start_line).toBe(9);
  });

  it('no quote at all — completely unchanged from the pre-quote behaviour', () => {
    const res = groundFindings([f({ file: 'src/config.ts', start_line: 9, end_line: 9 })], QUOTE_DIFF);
    expect(res.kept).toHaveLength(1);
    expect(res.kept[0]!.start_line).toBe(9); // no correction possible without a quote
  });

  it('heals a MULTI-LINE quote onto the real range it spans', () => {
    // Lines 12-14: '  rateLimit: {' / '    anonymous: 60,' / '  },' — copying
    // text across several lines is exactly what the prompt now asks a model to
    // do when one line alone is not enough context for the finding.
    const quote = '  rateLimit: {\n    anonymous: 60,\n  },';
    const res = groundFindings(
      [f({ file: 'src/config.ts', start_line: 1, end_line: 1, quote })],
      QUOTE_DIFF,
    );
    expect(res.dropped).toHaveLength(0);
    expect(res.kept).toHaveLength(1);
    expect(res.kept[0]!.start_line).toBe(12);
    expect(res.kept[0]!.end_line).toBe(14);
  });

  it('a multi-line quote spanning a GAP between two hunks never matches — lines that are not actually adjacent must not be joined', () => {
    const gapped: UnifiedDiff = {
      raw: [
        'diff --git a/src/two.ts b/src/two.ts',
        '--- a/src/two.ts',
        '+++ b/src/two.ts',
        '@@ -1,1 +1,1 @@',
        '+first();',
        '@@ -50,1 +50,1 @@',
        '+second();',
        '',
      ].join('\n'),
      files: [
        {
          path: 'src/two.ts',
          additions: 2,
          deletions: 0,
          hunks: [
            { file: 'src/two.ts', oldStart: 1, oldLines: 0, newStart: 1, newLines: 1, newLineNumbers: [1] },
            { file: 'src/two.ts', oldStart: 50, oldLines: 0, newStart: 50, newLines: 1, newLineNumbers: [50] },
          ],
        },
      ],
    };
    // Real diff text has 48 unrelated lines between these two — the quote below
    // claims they sit next to each other, which is false, so it must not heal.
    const res = groundFindings(
      [f({ file: 'src/two.ts', start_line: 1, end_line: 1, quote: 'first();\nsecond();' })],
      gapped,
    );
    expect(res.kept).toHaveLength(0);
    expect(res.dropped[0]!.reason).toMatch(/quote was not found/);
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
