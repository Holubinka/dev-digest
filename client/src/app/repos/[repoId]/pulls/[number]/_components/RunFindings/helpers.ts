import type { FindingRecord, ListFinding } from "@devdigest/shared";
import { SEVERITY_LEVELS } from "../SeverityFilterBar";

/**
 * How many findings the run row's card previews. Same number the server uses to
 * build `findings_top` for the PR list (`LIST_FINDINGS_PREVIEW`), so the two
 * cards show the same depth.
 */
export const RUN_FINDINGS_PREVIEW = 3;

/** Worst severity first — the index in the contract's own worst-first order. */
const RANK: Record<string, number> = Object.fromEntries(
  SEVERITY_LEVELS.map((level, i) => [level, i]),
);

/**
 * The findings worth previewing for one run: worst severity first, then most
 * confident — mirroring the server's `topFindings` so the list card and the run
 * card rank identically.
 *
 * Severities outside the contract are dropped rather than ranked last, for the
 * same reason the counting helper ignores them: `SEV` has no fallback and a
 * stray value would take the route down.
 */
export function topFindings(findings: FindingRecord[], limit: number): ListFinding[] {
  return findings
    .filter((f) => f.severity in RANK)
    .sort(
      (a, b) => (RANK[a.severity] ?? 9) - (RANK[b.severity] ?? 9) || b.confidence - a.confidence,
    )
    .slice(0, limit);
}
