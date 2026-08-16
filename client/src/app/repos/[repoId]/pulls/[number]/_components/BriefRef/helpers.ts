/* The rule that decides whether a reference may carry a line number. Pure, and
   kept out of the component because it is calculation rather than rendering —
   and because it is the part worth asserting on its own. */

import { MAX_LINE } from "@/lib/line-numbers";
import type { RiskBriefRefLine } from "@/lib/types";

/**
 * The line to show for one reference, or `null`.
 *
 * THREE gates, all of which must hold (R16, R17):
 *
 *  - `indexMatchesHead` — the numbers were measured against the code at
 *    `link_sha`. If the index is behind the head, every one of them describes a
 *    file the reader is not looking at.
 *  - `linkSha != null` — there is no commit at which these paths are true, so
 *    there is no state a line number could belong to.
 *  - `ref_lines` carries an entry whose `ref` equals this reference EXACTLY.
 *    The server strips a `:12` suffix before grounding and stores the stripped
 *    value, so the two sides match on the bare path.
 *
 * Plus one the contract cannot promise: `src/lib/api.ts` validates nothing at
 * runtime, so `line` here is whatever the response carried. A non-integer, a
 * zero, a negative or an absurd number is treated as no line at all rather than
 * printed beside a path as if it had been measured.
 *
 * `MAX_LINE` is the shared bound, not a second literal: `page.tsx` refuses the
 * same number off the address bar, and a reference showing a line the jump then
 * declines to use is the disagreement the shared constant exists to prevent.
 *
 * There is NO placeholder branch. A reference with no line renders without one.
 */
export function lineFor(
  refValue: string,
  refLines: RiskBriefRefLine[],
  linkSha: string | null,
  indexMatchesHead: boolean,
): number | null {
  if (!indexMatchesHead) return null;
  if (linkSha == null) return null;
  const hit = refLines.find((entry) => entry.ref === refValue);
  if (hit == null) return null;
  const { line } = hit;
  if (!Number.isInteger(line) || line < 1 || line > MAX_LINE) return null;
  return line;
}
