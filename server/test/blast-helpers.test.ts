/**
 * The two properties of the blast view that only hold because of how a lookup and
 * a cap are written, and that nothing else in the suite would notice losing.
 *
 * 1. Every keyed read is prototype-safe. The keys are repository-derived —
 *    symbol names from ast-grep, file paths from the walker, a `reason` the
 *    indexer stamped — so `toString`, `valueOf` and their six siblings really do
 *    arrive here, and a bare index resolves them to `Object.prototype`.
 * 2. `endpoints` is bounded, and the answer says when it was cut. Its length is
 *    fixed by repository content, so an uncapped list is an unbounded prompt and
 *    an unbounded response.
 *
 * Pure functions, no service, no fakes: everything below is `toView` and
 * `renderSummaryFacts` with hand-built facts, which is the whole point of the
 * blast slice keeping them in `helpers.ts`.
 */
import { describe, it, expect } from 'vitest';
import { deriveStatus, renderSummaryFacts, toView } from '../src/modules/blast/helpers.js';
import type { BlastFacts } from '../src/modules/blast/types.js';

/**
 * Named one by one rather than as "some inherited key": the point of the test is
 * that these exact strings exist on `Object.prototype`, and a reader who cannot
 * see the list cannot tell what is being pinned (`client/INSIGHTS.md:706`).
 */
const INHERITED = [
  'toString',
  'valueOf',
  'hasOwnProperty',
  'isPrototypeOf',
  'propertyIsEnumerable',
  'toLocaleString',
  'constructor',
];

const BASE = {
  status: 'full' as const,
  reason: null,
  repoFullName: 'acme/payments-api',
  headSha: 'de50d5c364fb',
  linkSha: 'de50d5c364fb',
  changedFiles: ['src/x.ts'],
  downstream: [],
};

describe('toView — repository names that collide with Object.prototype', () => {
  it.each(INHERITED)('reads caller_count as a number for a symbol named %s', (name) => {
    const facts: BlastFacts = {
      changedSymbols: [{ file: 'src/x.ts', name, kind: 'method', line: 10 }],
      callers: [{ file: 'src/y.ts', symbol: 'callsIt', viaSymbol: name, line: 3, rank: 0.5 }],
      // Counts for OTHER symbols only: the lookup for `name` must miss, and
      // missing must mean "fall back to the array length", not "inherit".
      callerCounts: { somethingElse: 4 },
      factsByFile: {},
    };

    const view = toView({ ...BASE, facts });
    const symbol = view.symbols[0]!;

    expect(typeof symbol.caller_count).toBe('number');
    expect(symbol.caller_count).toBe(1);
    expect(symbol.truncated).toBe(false);
    // A function-valued `caller_count` is dropped by `JSON.stringify`, so the
    // field disappears from the HTTP response while every type still checks.
    expect(JSON.parse(JSON.stringify(symbol))).toHaveProperty('caller_count', 1);
    // And it poisons everything derived from it: this sum went
    // "0function toString() { [native code] }".
    expect(view.totals.callers).toBe(1);
  });

  it('still prefers the real pre-cap count when the symbol name IS an own key', () => {
    const facts: BlastFacts = {
      changedSymbols: [{ file: 'src/x.ts', name: 'toString', kind: 'method', line: 10 }],
      callers: [{ file: 'src/y.ts', symbol: 'callsIt', viaSymbol: 'toString', line: 3, rank: 0.5 }],
      callerCounts: { toString: 37 },
      factsByFile: {},
    };

    const symbol = toView({ ...BASE, facts }).symbols[0]!;

    expect(symbol.caller_count).toBe(37);
    expect(symbol.truncated).toBe(true);
  });

  it.each(INHERITED)('serves a caller file named %s instead of throwing', (file) => {
    const facts: BlastFacts = {
      changedSymbols: [{ file: 'src/x.ts', name: 'handler', kind: 'function', line: 10 }],
      callers: [{ file, symbol: 'callsIt', viaSymbol: 'handler', line: 3, rank: 0.5 }],
      callerCounts: { handler: 1 },
      // The file is a caller but has no facts of its own, so the lookup misses —
      // bare-indexed it returned a function and the loop threw
      // "labels is not iterable", a 500 on GET /pulls/:id/blast.
      factsByFile: { 'src/other.ts': { endpoints: [], crons: [] } },
    };

    const symbol = toView({ ...BASE, facts }).symbols[0]!;

    expect(symbol.endpoints).toEqual([]);
    expect(symbol.endpoint_count).toBe(0);
  });

  it.each(INHERITED)('has no prose for a degraded reason named %s', (reason) => {
    const out = deriveStatus({ status: 'degraded', degraded: true, degradedReason: reason }, null);

    expect(out.status).toBe('degraded');
    expect(out.reason).not.toMatch(/native code/);
    expect(out.reason).toMatch(/not usable/);
  });
});

describe('toView / renderSummaryFacts — the endpoint list is bounded and says so', () => {
  const many = (n: number): BlastFacts => ({
    changedSymbols: [{ file: 'src/x.ts', name: 'handler', kind: 'function', line: 10 }],
    callers: [
      { file: 'src/routes.ts', symbol: 'register', viaSymbol: 'handler', line: 3, rank: 0.9 },
    ],
    callerCounts: { handler: 1 },
    factsByFile: {
      'src/routes.ts': {
        endpoints: Array.from({ length: n }, (_, i) => `GET /route-${i}`),
        crons: [],
      },
    },
  });

  it('caps the wire list, keeps the true size, and keeps the totals honest', () => {
    const view = toView({ ...BASE, facts: many(500) });
    const symbol = view.symbols[0]!;

    expect(symbol.endpoints).toHaveLength(20);
    expect(symbol.endpoint_count).toBe(500);
    expect(symbol.endpoints_truncated).toBe(true);
    // The stat row counts distinct (file, label) pairs BEFORE the cap: it is what
    // a reviewer reads as "how much this change reaches", and deriving it from
    // the capped array would quietly report 20.
    expect(view.totals.endpoints).toBe(500);
  });

  it('claims no truncation when everything fits', () => {
    const symbol = toView({ ...BASE, facts: many(3) }).symbols[0]!;

    expect(symbol.endpoints).toHaveLength(3);
    expect(symbol.endpoint_count).toBe(3);
    expect(symbol.endpoints_truncated).toBe(false);
  });

  it('bounds the paid summary prompt and names what it left out', () => {
    const prompt = renderSummaryFacts(toView({ ...BASE, facts: many(500) }));
    const reaches = prompt.split('\n').filter((line) => line.includes('reaches '));

    expect(reaches).toHaveLength(8);
    // 500 - 8, counted off `endpoint_count`, so the sentence covers both the
    // prompt cap and the wire cap that ran before it.
    expect(prompt).toContain('(492 further endpoint(s) or cron(s) not listed.)');
    expect(prompt.length).toBeLessThan(2_000);
  });
});
