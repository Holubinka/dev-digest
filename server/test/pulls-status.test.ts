/**
 * PR-list rollup helpers (`modules/pulls/status.ts`) — the pure derivation that
 * decides each PR's review STATUS and tallies its FINDINGS for the list. The DB
 * `status` column holds GitHub's merge state; the review status
 * (needs_review / reviewed / stale) is derived here from head vs lastReviewedSha
 * + age, so it gets unit coverage independent of the route's queries.
 */
import { describe, it, expect } from 'vitest';
import {
  deriveReviewStatus,
  rollupSeverities,
  topFindings,
  STALE_DAYS,
} from '../src/modules/pulls/status.js';

const DAY = 86_400_000;
const now = Date.UTC(2026, 5, 11);

describe('deriveReviewStatus', () => {
  it('needs_review when never reviewed, or when head moved since the last review', () => {
    expect(
      deriveReviewStatus({ ghStatus: 'open', lastReviewedSha: null, headSha: 'abc', updatedAt: new Date(now), now }),
    ).toBe('needs_review');
    expect(
      deriveReviewStatus({ ghStatus: 'open', lastReviewedSha: 'old', headSha: 'abc', updatedAt: new Date(now), now }),
    ).toBe('needs_review');
  });

  it('reviewed when the current head was reviewed and the PR is recent', () => {
    expect(
      deriveReviewStatus({ ghStatus: 'open', lastReviewedSha: 'abc', headSha: 'abc', updatedAt: new Date(now - DAY), now }),
    ).toBe('reviewed');
  });

  it('stale when the current head was reviewed but the PR is older than STALE_DAYS', () => {
    expect(
      deriveReviewStatus({
        ghStatus: 'open',
        lastReviewedSha: 'abc',
        headSha: 'abc',
        updatedAt: new Date(now - (STALE_DAYS + 1) * DAY),
        now,
      }),
    ).toBe('stale');
  });

  it('keeps merged/closed regardless of review state', () => {
    expect(
      deriveReviewStatus({ ghStatus: 'merged', lastReviewedSha: null, headSha: 'abc', updatedAt: null, now }),
    ).toBe('merged');
    expect(
      deriveReviewStatus({ ghStatus: 'closed', lastReviewedSha: 'abc', headSha: 'abc', updatedAt: new Date(now), now }),
    ).toBe('closed');
  });
});

describe('rollupSeverities', () => {
  it('tallies findings into critical / warning / suggestion buckets (ignores unknown)', () => {
    expect(
      rollupSeverities([
        { severity: 'CRITICAL' },
        { severity: 'CRITICAL' },
        { severity: 'WARNING' },
        { severity: 'SUGGESTION' },
        { severity: 'WEIRD' },
      ]),
    ).toEqual({ critical: 2, warning: 1, suggestion: 1 });
  });

  it('is all-zero for no findings', () => {
    expect(rollupSeverities([])).toEqual({ critical: 0, warning: 0, suggestion: 0 });
  });
});

describe('topFindings', () => {
  /** A finding carrying only what the list's hover card ranks on. */
  const f = (id: string, severity: string, confidence: number) => ({
    id,
    severity,
    category: 'bug',
    title: `finding ${id}`,
    file: 'src/index.ts',
    startLine: 1,
    endLine: 1,
    confidence,
    rationale: 'because',
  });

  it('ranks worst severity first, then highest confidence', () => {
    const picked = topFindings(
      [f('a', 'SUGGESTION', 0.9), f('b', 'CRITICAL', 0.5), f('c', 'WARNING', 0.7), f('d', 'CRITICAL', 0.8)],
      4,
    );
    expect(picked.map((p) => p.id)).toEqual(['d', 'b', 'c', 'a']);
  });

  it('keeps at most `limit` findings', () => {
    const picked = topFindings(
      [f('a', 'CRITICAL', 0.9), f('b', 'CRITICAL', 0.8), f('c', 'WARNING', 0.7), f('d', 'SUGGESTION', 0.6)],
      3,
    );
    expect(picked.map((p) => p.id)).toEqual(['a', 'b', 'c']);
  });

  it('drops a severity the contract does not define', () => {
    expect(topFindings([f('a', 'WEIRD', 0.9), f('b', 'WARNING', 0.1)], 3).map((p) => p.id)).toEqual(['b']);
  });

  it('truncates a long rationale so the list payload stays bounded', () => {
    const [only] = topFindings([{ ...f('a', 'WARNING', 0.9), rationale: 'x'.repeat(500) }], 3);
    expect(only!.rationale.length).toBeLessThanOrEqual(201);
    expect(only!.rationale.endsWith('…')).toBe(true);
  });

  it('is empty for no findings', () => {
    expect(topFindings([], 3)).toEqual([]);
  });
});
