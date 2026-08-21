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
