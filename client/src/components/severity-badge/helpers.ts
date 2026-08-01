import { SEV, type Severity } from "@devdigest/ui";

/**
 * Keyed off `SEV`, not the `Severity` contract enum — they are different sets.
 * `@devdigest/shared` has three levels, the vendored `SEV` table has four (it
 * adds INFO), so testing against the contract would reject a renderable INFO.
 */
export function isKnownSeverity(value: unknown): value is Severity {
  return typeof value === "string" && value in SEV;
}

export function severityColor(severity: string): string {
  return isKnownSeverity(severity) ? SEV[severity].c : "var(--text-muted)";
}
