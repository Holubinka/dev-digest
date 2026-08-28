import { describe, it, expect } from 'vitest';
import { summaryDuration, taskLine } from '../src/modules/reviews/helpers.js';

/**
 * Unit coverage for the review task-line. The key invariant: our trusted
 * instruction always tells the model to review the whole diff and never
 * withhold a security/correctness finding — no matter what the PR text claims.
 */

describe('taskLine', () => {
  const pull = { number: 3, title: 'test: vulnerable fixture', author: 'burnjohn' } as never;

  it('names the PR being reviewed', () => {
    const line = taskLine(pull);
    expect(line).toContain('#3');
    expect(line).toContain('test: vulnerable fixture');
  });

  it('keeps the non-negotiable "never withhold security" rule', () => {
    const line = taskLine(pull);
    expect(line).toMatch(/never .*withhold .*(or downgrade )?.*security/i);
    expect(line).toMatch(/review the entire diff/i);
  });
});

/**
 * The three readings of "how long did this take", and why the last one is a
 * null rather than a number: `now - ranAt` on a multi-run nobody closed would
 * measure the downtime between the crash and the reaper, not the work.
 */
describe('summaryDuration', () => {
  const ranAt = new Date('2026-08-27T10:00:00.000Z');
  const now = new Date('2026-08-27T10:00:30.000Z').getTime();

  it('measures a recorded completion, and prefers it over the runs\' states', () => {
    const finishedAt = new Date('2026-08-27T10:00:12.000Z');
    expect(summaryDuration(ranAt, finishedAt, true, now)).toEqual({ ms: 12_000, kind: 'measured' });
  });

  it('reports time gone SO FAR while anything is still going', () => {
    expect(summaryDuration(ranAt, null, true, now)).toEqual({ ms: 30_000, kind: 'elapsed' });
  });

  it('gives no number when every run is terminal and nothing recorded a completion', () => {
    expect(summaryDuration(ranAt, null, false, now)).toEqual({ ms: null, kind: 'interrupted' });
  });
});
