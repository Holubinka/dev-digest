/**
 * P2 step 4 — grounding. Everything the model returns is untrusted output, and
 * this is the filter that decides what a reviewer is allowed to see (R9, R10,
 * R12, R14).
 *
 * NEGATIVE CONTROL: deleting the membership filter in `groundBrief` must fail
 * this file. Verified by hand on 2026-08-16 — removing the `allowed.has(ref)`
 * test broke five of these cases.
 */
import { describe, it, expect } from 'vitest';
import type { Risk, RiskBrief } from '@devdigest/shared';
import { groundBrief } from '../src/modules/brief/helpers.js';

const ALLOWED = new Set([
  'server/src/modules/brief/service.ts',
  'server/src/modules/brief/routes.ts',
  'POST /pulls/:id/brief',
]);

function risk(over: Partial<Risk> = {}): Risk {
  return {
    kind: 'public API',
    title: 'A new paid route',
    explanation: 'The POST route spends money and is reachable by anyone in the workspace.',
    severity: 'medium',
    file_refs: ['server/src/modules/brief/routes.ts'],
    ...over,
  };
}

function brief(over: Partial<RiskBrief> = {}): RiskBrief {
  return {
    what: 'Adds a per-state risk brief.',
    why: 'Reviewers open a PR without knowing what changed.',
    risk_level: 'medium',
    risks: [risk()],
    review_focus: [
      { ref: 'server/src/modules/brief/routes.ts', kind: 'file', reason: 'the new paid route' },
    ],
    ...over,
  };
}

describe('groundBrief — only what the input can vouch for', () => {
  it('removes a file_ref outside the set and lists it in dropped_refs (R14)', () => {
    const out = groundBrief(
      brief({
        risks: [
          risk({
            file_refs: ['server/src/modules/brief/service.ts', 'server/src/does/not/exist.ts'],
          }),
        ],
      }),
      ALLOWED,
    );
    expect(out.risks[0]!.file_refs).toEqual(['server/src/modules/brief/service.ts']);
    expect(out.dropped_refs).toEqual(['server/src/does/not/exist.ts']);
    expect(out.dropped_risks).toBe(0);
  });

  it('drops a risk left with no reference, and counts it (R10)', () => {
    const out = groundBrief(
      brief({ risks: [risk({ file_refs: ['invented/a.ts', 'invented/b.ts'] })] }),
      ALLOWED,
    );
    expect(out.risks).toEqual([]);
    expect(out.dropped_risks).toBe(1);
    expect(out.dropped_refs.sort()).toEqual(['invented/a.ts', 'invented/b.ts']);
  });

  /**
   * A risk that ARRIVED with no reference is the same observable end state as one
   * grounding emptied — a claim with nothing behind it — so it gets the same
   * answer (R9). The spec does not name this case; the plan resolves it here.
   */
  it('drops a risk that arrived with no reference at all, and counts it (R9)', () => {
    const out = groundBrief(brief({ risks: [risk({ file_refs: [] })] }), ALLOWED);
    expect(out.risks).toEqual([]);
    expect(out.dropped_risks).toBe(1);
    expect(out.dropped_refs).toEqual([]);
  });

  it('filters review_focus by the same set, files and endpoint labels alike', () => {
    const out = groundBrief(
      brief({
        review_focus: [
          { ref: 'POST /pulls/:id/brief', kind: 'endpoint', reason: 'the spend' },
          { ref: 'GET /invented', kind: 'endpoint', reason: 'not in the input' },
          { ref: 'server/src/modules/brief/service.ts', kind: 'file', reason: 'the budget walk' },
          { ref: 'src/never/printed.ts', kind: 'file', reason: 'not in the input' },
        ],
      }),
      ALLOWED,
    );
    expect(out.review_focus.map((item) => item.ref)).toEqual([
      'POST /pulls/:id/brief',
      'server/src/modules/brief/service.ts',
    ]);
    expect(out.dropped_refs).toContain('GET /invented');
    expect(out.dropped_refs).toContain('src/never/printed.ts');
  });

  /**
   * Levels descend; inside a level the model's own order survives. The sort is
   * over a fixed rank map on a stable `Array.prototype.sort`, so "the model put
   * the DB risk before the API risk" is information the card keeps.
   */
  it('orders high → medium → low and preserves the model order inside a level (R12)', () => {
    const out = groundBrief(
      brief({
        risks: [
          risk({ title: 'low-1', severity: 'low' }),
          risk({ title: 'medium-1', severity: 'medium' }),
          risk({ title: 'high-1', severity: 'high' }),
          risk({ title: 'medium-2', severity: 'medium' }),
          risk({ title: 'high-2', severity: 'high' }),
          risk({ title: 'low-2', severity: 'low' }),
        ],
      }),
      ALLOWED,
    );
    expect(out.risks.map((r) => r.title)).toEqual([
      'high-1',
      'high-2',
      'medium-1',
      'medium-2',
      'low-1',
      'low-2',
    ]);
  });

  it('de-duplicates dropped_refs across risks and focus items', () => {
    const out = groundBrief(
      brief({
        risks: [risk({ file_refs: ['ghost.ts'] }), risk({ file_refs: ['ghost.ts'] })],
        review_focus: [{ ref: 'ghost.ts', kind: 'file', reason: 'also invented' }],
      }),
      ALLOWED,
    );
    expect(out.dropped_refs).toEqual(['ghost.ts']);
    expect(out.dropped_risks).toBe(2);
  });

  it('an empty allowed set drops everything and keeps nothing', () => {
    const out = groundBrief(brief(), new Set());
    expect(out.risks).toEqual([]);
    expect(out.review_focus).toEqual([]);
    expect(out.dropped_risks).toBe(1);
  });
});
