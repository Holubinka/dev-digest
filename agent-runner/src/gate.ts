import type { CiFailOn, Finding } from '@devdigest/shared';
import { gateTriggered } from '@devdigest/reviewer-core';

export const EXIT_OK = 0;
/** The gate tripped: findings at or above the manifest's `ci_fail_on`. */
export const EXIT_GATE_TRIPPED = 1;
/** The run could not be completed — manifest, environment, GitHub or model. */
export const EXIT_FAILED = 2;

/**
 * The runner's exit code, for ALL FOUR `CiFailOn` values (AC-65).
 *
 * `gateTriggered` (`reviewer-core/src/output/to-review.ts`) already implements
 * the rule — `never` → never, `critical` → CRITICAL only, `warning` → WARNING
 * or worse, `any` → any finding — and is the same function that decides the
 * posted review's event, so the check and the review can never disagree.
 * The CI tab offers three of the four (AC-101); `any` still arrives here from a
 * hand-edited manifest and is executed by the same rule.
 */
export function exitCodeFor(findings: Finding[], failOn: CiFailOn): number {
  return gateTriggered(findings, failOn) ? EXIT_GATE_TRIPPED : EXIT_OK;
}
