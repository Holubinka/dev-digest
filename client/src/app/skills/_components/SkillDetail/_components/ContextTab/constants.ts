/**
 * The prompt format this tab previews — stated once, beside the only thing that
 * renders it.
 *
 * Both values are OWNED BY THE SERVER and copied here:
 *
 * - `## Project context` is written by `reviewer-core/src/prompt.ts:239`.
 * - `### <path>` is `renderDoc` in `server/src/modules/context/helpers.ts:232`.
 *
 * A copy is unavoidable — the client cannot import either producer — so the
 * point of this file is that there is exactly one copy and it says where the
 * original lives. The panel exists to promise a maintainer what a run will
 * actually assemble, and nothing type-checks that promise: rename a heading on
 * either producing side and this keeps printing the old one, confidently, with
 * no test red. When you change one of them, this file is the counterpart to
 * update, and `renderDoc`'s own comment makes the same argument against a
 * second rendering of the same shape.
 */

/** The heading `reviewer-core` puts above the assembled block. */
export const PROMPT_SECTION_HEADING = "## Project context";

/** The heading `renderDoc` puts above one document's text. */
export function promptDocHeading(path: string): string {
  return `### ${path}`;
}
