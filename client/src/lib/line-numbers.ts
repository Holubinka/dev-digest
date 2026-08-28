/* line-numbers.ts — the one bound on a line number in this app.

   Two different questions ask it, and they stay two different functions: the PR
   detail page parses a string someone could have typed into the address bar, and
   `BriefRef` bounds a number arriving inside an unvalidated JSON response. What
   they may NOT have is two opinions about how large a line number can be — a
   reference that prints `:12000000` beside a path while the jump refuses to open
   it is one definition too many, and the comments in both files used to say so
   rather than fix it. */

/**
 * More lines than any file in a diff this app can render. Past it, the value did
 * not come from where it claims to.
 */
export const MAX_LINE = 9_999_999;

/**
 * A finding's line range as the reader sees it: `12` for a single line, `12-18`
 * for a range. AC-59 of SPEC-05 is exactly this — `file:12`, never `file:12-12`.
 *
 * It lives beside `MAX_LINE` rather than beside the card because two routes print
 * it now: the PR page's finding list and the multi-agent results page.
 */
export function lineLabel(f: { start_line: number; end_line: number }): string {
  return f.start_line === f.end_line ? `${f.start_line}` : `${f.start_line}-${f.end_line}`;
}
