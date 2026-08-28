import { describe, expect, it } from 'vitest';
import type { CiFailOn, Finding } from '@devdigest/shared';
import { EXIT_GATE_TRIPPED, EXIT_OK, exitCodeFor } from '../src/gate.js';
import { finding } from './helpers.js';

const SETS: Record<string, Finding[]> = {
  none: [],
  SUGGESTION: [finding({ severity: 'SUGGESTION' })],
  WARNING: [finding({ severity: 'WARNING' })],
  CRITICAL: [finding({ severity: 'CRITICAL' })],
};

/**
 * AC-65 in full: all four `CiFailOn` values, four severity sets each. `any` is
 * never offered by the CI tab (AC-101) and still arrives from a hand-edited
 * manifest, so it is pinned like the other three.
 */
const EXPECTED: Record<CiFailOn, Record<keyof typeof SETS, number>> = {
  never: { none: EXIT_OK, SUGGESTION: EXIT_OK, WARNING: EXIT_OK, CRITICAL: EXIT_OK },
  critical: { none: EXIT_OK, SUGGESTION: EXIT_OK, WARNING: EXIT_OK, CRITICAL: EXIT_GATE_TRIPPED },
  warning: {
    none: EXIT_OK,
    SUGGESTION: EXIT_OK,
    WARNING: EXIT_GATE_TRIPPED,
    CRITICAL: EXIT_GATE_TRIPPED,
  },
  any: {
    none: EXIT_OK,
    SUGGESTION: EXIT_GATE_TRIPPED,
    WARNING: EXIT_GATE_TRIPPED,
    CRITICAL: EXIT_GATE_TRIPPED,
  },
};

describe('exitCodeFor', () => {
  for (const failOn of Object.keys(EXPECTED) as CiFailOn[]) {
    for (const set of Object.keys(SETS)) {
      const expected = EXPECTED[failOn][set] as number;
      it(`ci_fail_on=${failOn} with ${set} → exit ${expected}`, () => {
        expect(exitCodeFor(SETS[set] as Finding[], failOn)).toBe(expected);
      });
    }
  }

  it('a mixed set is judged by its worst finding', () => {
    const mixed = [finding({ severity: 'SUGGESTION' }), finding({ severity: 'CRITICAL' })];
    expect(exitCodeFor(mixed, 'critical')).toBe(EXIT_GATE_TRIPPED);
    expect(exitCodeFor(mixed, 'never')).toBe(EXIT_OK);
  });
});
