import type { ListFinding, Severity } from "@devdigest/shared";

/** Longest `file` string the hover card shows before eliding folders. */
export const PATH_BUDGET_CHARS = 46;

/**
 * The severities a finding can carry, worst first. `satisfies` ties the list to
 * the shared contract — widen `Severity` there and this stops compiling.
 *
 * It lives beside the card because the card is what renders them, and both
 * surfaces that drive the card rank against it.
 */
export const SEVERITY_LEVELS = [
  "CRITICAL",
  "WARNING",
  "SUGGESTION",
] as const satisfies readonly Severity[];

export type SeverityLevel = (typeof SEVERITY_LEVELS)[number];

const RANK: Record<string, number> = Object.fromEntries(
  SEVERITY_LEVELS.map((level, i) => [level, i]),
);

/**
 * Order findings the way the card shows them: worst severity first, then most
 * confident, then by id.
 *
 * The id is not a tidiness flourish. The PR list opens its card on the three
 * findings the list payload carries and swaps in the full set a moment later;
 * equal confidences are common (models emit 0.9 and 0.8 over and over), so
 * without a total order those first rows reshuffle under the cursor. This
 * mirrors `topFindings` in `server/src/modules/pulls/status.ts` — change the
 * ordering in one and it has to change in the other.
 *
 * Severities outside the contract are dropped rather than ranked last: the
 * `findings.severity` column is plain text and `SEV` in `@devdigest/ui` has no
 * fallback, so a stray value would take the route down (see `INSIGHTS.md`).
 */
export function rankFindings<T extends ListFinding>(findings: T[]): T[] {
  return findings
    .filter((f) => f.severity in RANK)
    .sort(
      (a, b) =>
        (RANK[a.severity] ?? 9) - (RANK[b.severity] ?? 9) ||
        b.confidence - a.confidence ||
        a.id.localeCompare(b.id),
    );
}

/**
 * Shorten a repo path from the LEFT, at a folder boundary: the filename is what
 * identifies a finding, so it is the part that must survive. A path that fits is
 * returned untouched.
 *
 * `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingsPanel/FindingsPanel.tsx`
 * → `…/FindingsPanel/FindingsPanel.tsx`
 *
 * The card also clips with `text-overflow: ellipsis`, but only this keeps the
 * informative end of the path — CSS would drop the filename instead.
 */
export function shortPath(file: string, budget: number = PATH_BUDGET_CHARS): string {
  if (file.length <= budget) return file;
  const parts = file.split("/");
  let out = parts[parts.length - 1] ?? file;
  for (let i = parts.length - 2; i >= 0; i--) {
    const next = `${parts[i]}/${out}`;
    if (next.length + 2 > budget) break;
    out = next;
  }
  return `…/${out}`;
}

/** `file:line` as the card shows it — a range only when the lines differ. */
export function lineRef(startLine: number, endLine: number): string {
  return startLine === endLine ? `${startLine}` : `${startLine}-${endLine}`;
}
