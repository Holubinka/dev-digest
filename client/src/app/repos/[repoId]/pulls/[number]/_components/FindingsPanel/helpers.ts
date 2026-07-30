import type { FindingRecord } from "@devdigest/shared";
import type { SeverityLevel } from "../SeverityFilterBar";
import { LOW_CONFIDENCE_THRESHOLD, SEVERITY_ORDER } from "./constants";

/**
 * Optionally drop low-confidence findings, narrow to one severity, and sort by
 * severity. The two filters compose: narrowing to CRITICAL keeps whatever
 * confidence cut the reviewer already chose.
 */
export function visibleFindings(
  findings: FindingRecord[],
  hideLow: boolean,
  severity: SeverityLevel | null = null,
): FindingRecord[] {
  let shown = findings;
  if (hideLow) shown = shown.filter((f) => f.confidence >= LOW_CONFIDENCE_THRESHOLD);
  if (severity) shown = shown.filter((f) => f.severity === severity);
  return [...shown].sort(
    (a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9),
  );
}
