import type { ReviewRecord } from "@devdigest/shared";
import type { SeverityLevel } from "../SeverityFilterBar";

/**
 * The runs worth rendering under an active severity filter — a run with no
 * finding at that level would show an empty accordion and nothing else.
 */
export function runsWithSeverity(
  runs: ReviewRecord[],
  severity: SeverityLevel | null,
): ReviewRecord[] {
  if (!severity) return runs;
  return runs.filter((r) => r.findings.some((f) => f.severity === severity));
}
