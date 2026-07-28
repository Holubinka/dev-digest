import type { FindingRecord } from "@devdigest/shared";
import { SEVERITY_LEVELS, type SeverityLevel } from "./constants";

/** Narrow an arbitrary string (a URL param, a DB value) to a known severity. */
export function isSeverityLevel(value: unknown): value is SeverityLevel {
  return (SEVERITY_LEVELS as readonly unknown[]).includes(value);
}

/**
 * Tally findings per severity. Anything outside the contract is ignored: the
 * `findings.severity` column is plain text, and `SEV` in `@devdigest/ui` has no
 * fallback — rendering a chip for a stray value would take the route down
 * (see `client/INSIGHTS.md`).
 */
export function countBySeverity(
  findings: FindingRecord[],
): Record<SeverityLevel, number> {
  const counts = Object.fromEntries(
    SEVERITY_LEVELS.map((level) => [level, 0]),
  ) as Record<SeverityLevel, number>;
  for (const f of findings) {
    if (isSeverityLevel(f.severity)) counts[f.severity] += 1;
  }
  return counts;
}
