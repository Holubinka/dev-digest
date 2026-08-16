/* Pure rules the brief's references go through before anything is rendered.
   Kept out of the components because they are calculation, not rendering, and
   because they are the part worth testing on their own. */

import type { RiskBriefRefLine } from "@/lib/types";

/**
 * The abbreviated form git itself prints, exactly as `BlastRadiusCard` does it.
 * `String.slice` is safe here and only here: a commit id is `[0-9a-f]{40}`, so
 * there is no surrogate pair to split.
 */
export const shortSha = (sha: string) => sha.slice(0, 7);

/**
 * The largest line number a reference may carry.
 *
 * The same bound `page.tsx`'s `?line=` parser applies, for the same reason: it
 * is more lines than any file in a diff this app can render, and a number past
 * it is a sign the value did not come from where it claims to. The two checks
 * are deliberately separate — that one parses a string off the address bar,
 * this one bounds a number off an unvalidated JSON response — but they must
 * agree, or a reference would show a line the jump then refuses to use.
 */
const MAX_LINE = 9_999_999;

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
