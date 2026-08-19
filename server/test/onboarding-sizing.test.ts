/**
 * P3 step 11 — **the budget, the clock, and the ramp between them**.
 *
 * Two pure functions, so the whole suite is arithmetic with no fake, no clone
 * and no clock. What it is for is the three properties a criterion states and
 * a type cannot: the budget stays inside 24 000…50 000 whatever it is handed
 * (AC-58), it grows monotonically with the size signal (AC-61), and the clock
 * never answers above 300 000 ms (AC-64).
 *
 * The two named points are pinned as NUMBERS rather than recomputed from the
 * constants: 32 528 and 219 360 are what `SPEC-04 § D11`/`§ D22`/`§ D12` derive
 * for this repository's 656 indexed files, and a test that recomputed the
 * formula would agree with any formula, including a wrong one.
 *
 * NEGATIVE CONTROLS, run on 2026-08-18 — each mutation applied to `sizing.ts`
 * alone, and each reverted before the next:
 *  - drop the `Math.min(…, RAMP)` upper clamp → "flattens above the ramp" and
 *    the range sweep fail (2 of 10). The clock's ceiling case stays green,
 *    because `timeoutForBudget` clamps the budget it is handed on its own —
 *    which is the reason it does;
 *  - divide by `MAX_INDEXED_FILES` (5 000) instead of by the ramp → "at 656
 *    indexed files" fails with 27 411, and two more with it (3 of 10);
 *  - ramp the clock from a zero budget rather than from the floor budget → both
 *    named pairs fail (2 of 10).
 */
import { describe, it, expect } from 'vitest';
import { budgetForIndex, timeoutForBudget } from '../src/modules/onboarding/sizing.js';
import {
  ONBOARDING_BUDGET_CEILING,
  ONBOARDING_BUDGET_FLOOR,
  ONBOARDING_BUDGET_RAMP_FILES,
  ONBOARDING_TIMEOUT_CEILING_MS,
  ONBOARDING_TIMEOUT_FLOOR_MS,
} from '../src/modules/onboarding/constants.js';

/** `files_indexed` of `Holubinka/dev-digest`, read from a live `IndexState`. */
const THIS_REPO_FILES = 656;

describe('the input budget', () => {
  it('starts at the floor the feature has a green run behind', () => {
    expect(budgetForIndex(0)).toBe(ONBOARDING_BUDGET_FLOOR);
    expect(ONBOARDING_BUDGET_FLOOR).toBe(24_000);
  });

  it('this repository, at 656 indexed files, is funded at 32 528', () => {
    expect(budgetForIndex(THIS_REPO_FILES)).toBe(32_528);
  });

  it('flattens above the ramp rather than growing without end', () => {
    expect(budgetForIndex(ONBOARDING_BUDGET_RAMP_FILES)).toBe(ONBOARDING_BUDGET_CEILING);
    expect(budgetForIndex(ONBOARDING_BUDGET_RAMP_FILES + 1)).toBe(ONBOARDING_BUDGET_CEILING);
    expect(budgetForIndex(500_000)).toBe(ONBOARDING_BUDGET_CEILING);
    expect(ONBOARDING_BUDGET_CEILING).toBe(50_000);
  });

  it('answers the floor for a count that is not a size at all', () => {
    // Nothing produces a negative `files_indexed`, and that is exactly why the
    // clamp has to be here: the one caller reads the number off a jsonb-backed
    // snapshot, so "it cannot happen" is a claim about a column.
    expect(budgetForIndex(-1)).toBe(ONBOARDING_BUDGET_FLOOR);
    expect(budgetForIndex(-100_000)).toBe(ONBOARDING_BUDGET_FLOOR);
  });

  it('never leaves 24 000…50 000, and never decreases as the index grows', () => {
    let previous = budgetForIndex(0);
    for (let files = 0; files <= 3_000; files += 7) {
      const budget = budgetForIndex(files);
      expect(budget).toBeGreaterThanOrEqual(ONBOARDING_BUDGET_FLOOR);
      expect(budget).toBeLessThanOrEqual(ONBOARDING_BUDGET_CEILING);
      expect(budget).toBeGreaterThanOrEqual(previous);
      expect(Number.isInteger(budget)).toBe(true);
      previous = budget;
    }
    // Monotone is not enough on its own — a constant function is monotone too.
    expect(budgetForIndex(1_000)).toBeGreaterThan(budgetForIndex(100));
  });
});

describe('the clock the budget buys', () => {
  it('is the proven pair at the floor and the derived one at the ceiling', () => {
    expect(timeoutForBudget(ONBOARDING_BUDGET_FLOOR)).toBe(ONBOARDING_TIMEOUT_FLOOR_MS);
    expect(timeoutForBudget(ONBOARDING_BUDGET_CEILING)).toBe(ONBOARDING_TIMEOUT_CEILING_MS);
    expect(ONBOARDING_TIMEOUT_FLOOR_MS).toBe(180_000);
    expect(ONBOARDING_TIMEOUT_CEILING_MS).toBe(300_000);
  });

  it('is a function OF THE BUDGET — this repository gets 219 360 ms', () => {
    expect(timeoutForBudget(budgetForIndex(THIS_REPO_FILES))).toBe(219_360);
  });

  it('never answers above the ceiling clock, whatever budget it is handed', () => {
    for (const budget of [0, 24_000, 32_528, 50_000, 50_001, 1_000_000]) {
      expect(timeoutForBudget(budget)).toBeLessThanOrEqual(ONBOARDING_TIMEOUT_CEILING_MS);
      expect(timeoutForBudget(budget)).toBeGreaterThanOrEqual(ONBOARDING_TIMEOUT_FLOOR_MS);
    }
  });

  it('grows with the budget it is given, one whole millisecond at a time', () => {
    let previous = timeoutForBudget(ONBOARDING_BUDGET_FLOOR);
    for (let budget = ONBOARDING_BUDGET_FLOOR; budget <= ONBOARDING_BUDGET_CEILING; budget += 250) {
      const clock = timeoutForBudget(budget);
      expect(clock).toBeGreaterThanOrEqual(previous);
      expect(Number.isInteger(clock)).toBe(true);
      previous = clock;
    }
    expect(timeoutForBudget(40_000)).toBeGreaterThan(timeoutForBudget(30_000));
  });

  /**
   * The pair that matters end to end: every budget the ramp can produce buys a
   * clock inside the two bounds, so no repository size exists for which the
   * generation is given a clock it was never measured against.
   */
  it('holds for every size the ramp can produce', () => {
    for (let files = 0; files <= ONBOARDING_BUDGET_RAMP_FILES; files += 13) {
      const clock = timeoutForBudget(budgetForIndex(files));
      expect(clock).toBeGreaterThanOrEqual(ONBOARDING_TIMEOUT_FLOOR_MS);
      expect(clock).toBeLessThanOrEqual(ONBOARDING_TIMEOUT_CEILING_MS);
    }
  });
});
