import type { Severity } from "@devdigest/shared";

/**
 * The severities a finding can carry, worst first. `satisfies` ties the list to
 * the shared contract — widen `Severity` there and this stops compiling.
 */
export const SEVERITY_LEVELS = [
  "CRITICAL",
  "WARNING",
  "SUGGESTION",
] as const satisfies readonly Severity[];

export type SeverityLevel = (typeof SEVERITY_LEVELS)[number];
