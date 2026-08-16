/**
 * P2 step 4 — `intentFreshness` (R25).
 *
 * THREE-VALUED on purpose. The one thing this function must never do is answer
 * `fresh` for a comparison it could not make: `intent_freshness` exists to
 * disclose staleness, and a default of "not stale" is the failure it was created
 * to stop. There is no fourth branch here and no `else return 'fresh'` reachable
 * from a null.
 */
import { describe, it, expect } from 'vitest';
import { intentFreshness } from '../src/modules/brief/helpers.js';

const INTENT_AT = new Date('2026-08-16T09:00:00.000Z');
const BEFORE = new Date('2026-08-16T08:00:00.000Z');
const AFTER = new Date('2026-08-16T10:00:00.000Z');

describe('intentFreshness', () => {
  it('is unknown — not fresh — when the head commit has no date', () => {
    expect(intentFreshness(INTENT_AT, null)).toBe('unknown');
  });

  it('is unknown when there is no intent', () => {
    expect(intentFreshness(null, AFTER)).toBe('unknown');
  });

  it('is unknown when neither is known', () => {
    expect(intentFreshness(null, null)).toBe('unknown');
  });

  it('is stale only when the intent genuinely predates the head commit', () => {
    expect(intentFreshness(INTENT_AT, AFTER)).toBe('stale');
  });

  it('is fresh when the intent was computed after the head commit', () => {
    expect(intentFreshness(INTENT_AT, BEFORE)).toBe('fresh');
  });

  it('is fresh when the two land on the same instant', () => {
    expect(intentFreshness(INTENT_AT, new Date(INTENT_AT.getTime()))).toBe('fresh');
  });

  it('is stale by one millisecond, not rounded to fresh', () => {
    expect(intentFreshness(INTENT_AT, new Date(INTENT_AT.getTime() + 1))).toBe('stale');
  });
});
