/* The rule that decides whether a reference may carry a line number. Pure, and
   kept out of the component because it is calculation rather than rendering —
   and because it is the part worth asserting on its own. */

import { MAX_LINE } from "@/lib/line-numbers";
import type { RiskBriefRefLine } from "@/lib/types";

/**
 * The line to show for one reference, or `null`.
 *
 * THREE gates (R16, R17) — the first two only for numbers the INDEX measured:
 *
 *  - `indexMatchesHead` — a `blast_*` number was measured against the code at
 *    `link_sha`. If the index is behind the head, it describes a file the reader
 *    is not looking at. A `diff_hunk` number is exempt: it comes out of the PR's
 *    own patch and is true at `head_sha`, which is where the link goes.
 *  - `linkSha != null` — same scope, same reason: there is no indexed commit a
 *    `blast_*` number could belong to. A `diff_hunk` number needs no index.
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
  const hit = refLines.find((entry) => entry.ref === refValue);
  if (hit == null) return null;
  // The two gates below are about numbers measured in the INDEX, at `link_sha`.
  // A `diff_hunk` number was measured in the PR's own patch, so it is true at
  // `head_sha` — the commit the link goes to — however far behind the index is.
  // Applying the index gates to it would suppress the only number that survives
  // a stale index, which is the state every PR here is actually in.
  if (hit.source !== "diff_hunk") {
    if (!indexMatchesHead) return null;
    if (linkSha == null) return null;
  }
  const { line } = hit;
  if (!Number.isInteger(line) || line < 1 || line > MAX_LINE) return null;
  return line;
}
