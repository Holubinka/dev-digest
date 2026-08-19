import {
  ONBOARDING_BUDGET_CEILING,
  ONBOARDING_BUDGET_FLOOR,
  ONBOARDING_BUDGET_RAMP_FILES,
  ONBOARDING_TIMEOUT_CEILING_MS,
  ONBOARDING_TIMEOUT_FLOOR_MS,
} from './constants.js';

/**
 * onboarding · how big one generation is allowed to be, and how long it may take.
 *
 * Two pure functions over `constants.ts` and nothing else — no I/O, no clock, no
 * framework, no port. Core by `onion-architecture` §1, which is also why the
 * number they are computed from arrives as a PARAMETER: `files_indexed` is read
 * by the slice that gates on the index (`service.ts`), and
 * `OnboardingGenerationContainer` is deliberately unable to read the index state
 * at all.
 *
 * THEY LIVE IN ONE FILE BECAUSE THE CLOCK IS A FUNCTION OF THE BUDGET. Written
 * apart they drift: a budget raised on its own times out precisely on the
 * repositories it was raised for, and a timeout is a generation the provider has
 * already been paid for and whose answer is thrown away (`SPEC-04 § D12`). One
 * file, one edit, both ends of the ramp visible at once.
 */

/**
 * The input budget for a repository of this size, in tokens — the ceiling the
 * assembled input (system + user) is measured against before the call.
 *
 * Linear from `ONBOARDING_BUDGET_FLOOR` at zero indexed files to
 * `ONBOARDING_BUDGET_CEILING` at `ONBOARDING_BUDGET_RAMP_FILES`, flat above it
 * (`SPEC-04 § D11` in the edition of § D22). 656 files — this repository —
 * gives 32 528.
 *
 * Clamped at BOTH ends. A negative count is not a smaller repository, and a
 * count past the ramp buys nothing: above the ceiling there is no input left to
 * fund, because every selection ceiling that decides WHAT is read is fixed
 * elsewhere and none of them moves with this number (AC-67).
 */
export function budgetForIndex(filesIndexed: number): number {
  const files = Math.min(Math.max(filesIndexed, 0), ONBOARDING_BUDGET_RAMP_FILES);
  const range = ONBOARDING_BUDGET_CEILING - ONBOARDING_BUDGET_FLOOR;
  return ONBOARDING_BUDGET_FLOOR + Math.round((range * files) / ONBOARDING_BUDGET_RAMP_FILES);
}

/**
 * The wall clock one generation gets for its model call, in milliseconds, for
 * the budget it is running under.
 *
 * The same ramp, expressed over the budget rather than over the file count, so
 * the floor pair (24 000 / 180 000) is the pair this feature has a green run
 * behind and the ceiling pair (50 000 / 300 000) is the one § D12 derives from
 * 4,47 ms per input token. This repository's 32 528 gives 219 360 ms.
 *
 * The budget is clamped to the ramp for the same reason the file count is: this
 * function must never answer above `ONBOARDING_TIMEOUT_CEILING_MS` (AC-64), and
 * that has to be a property of the function rather than of every caller passing
 * it something `budgetForIndex` produced.
 */
export function timeoutForBudget(budget: number): number {
  const clamped = Math.min(Math.max(budget, ONBOARDING_BUDGET_FLOOR), ONBOARDING_BUDGET_CEILING);
  const budgetRange = ONBOARDING_BUDGET_CEILING - ONBOARDING_BUDGET_FLOOR;
  const clockRange = ONBOARDING_TIMEOUT_CEILING_MS - ONBOARDING_TIMEOUT_FLOOR_MS;
  return (
    ONBOARDING_TIMEOUT_FLOOR_MS +
    Math.round((clockRange * (clamped - ONBOARDING_BUDGET_FLOOR)) / budgetRange)
  );
}
