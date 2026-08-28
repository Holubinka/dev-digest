import type { UnifiedDiff } from '@devdigest/shared';
import { sliceDiff } from '@devdigest/reviewer-core';
import { parseUnifiedDiff } from '../../adapters/git/diff-parser.js';
import { assertReviewableDiff } from '../_shared/diff-guards.js';
import { AppError } from '../../platform/errors.js';

/**
 * Cutting and checking a case's `input_diff`.
 *
 * A PLAIN MODULE, deliberately named neither `service.ts` nor `*-executor.ts`:
 * those two filenames may not import `src/adapters/**` (`no-service-to-adapter-impl`),
 * and `parseUnifiedDiff` lives there. `modules/reviews/diff-loader.ts` reaches it
 * the same way. The batch executor therefore receives an ALREADY PARSED diff
 * from here rather than parsing one itself.
 */

/**
 * The diff fragment for exactly one file, with all of that file's hunks (AC-4).
 *
 * The path check is not defensive tidiness. `sliceDiff` falls back to returning
 * the WHOLE `diff.raw` when the path is absent (`reviewer-core/src/review/reduce.ts:70`),
 * which would store the entire PR diff as the case input and quietly break both
 * AC-4 and D7 — "everything outside the case's expectations is noise" is only an
 * honest rule on a one-file fragment.
 */
export function fragmentFor(diff: UnifiedDiff, path: string): string {
  if (!diff.files.some((f) => f.path === path)) {
    throw new AppError(
      'diff_unavailable',
      `The finding cites "${path}", which is not among the ${diff.files.length} file(s) of ` +
        'the diff available for this pull request, so there is no fragment to store as the ' +
        "case's input. Re-import the pull request, or create the case by hand.",
      409,
    );
  }
  return sliceDiff(diff, path);
}

/** The paths a stored fragment carries — `input_files` (AC-12), derived, never edited (D13). */
export function filesIn(fragmentText: string): string[] {
  return parseUnifiedDiff(fragmentText).files.map((f) => f.path);
}

/**
 * Parse a case's `input_diff` and run the four shared guards over it (AC-23).
 *
 * Applied on save AND on run: `input_diff` is free text in the case editor, so
 * the value that reaches a model call is not necessarily the value that was
 * checked when the case was created.
 */
export function assertRunnableFragment(text: string): UnifiedDiff {
  const diff = parseUnifiedDiff(text);
  assertReviewableDiff(diff);
  return diff;
}

/**
 * Does `[start, end]` touch any new-side line the fragment actually covers?
 *
 * The pre-check for AC-6: an expectation the citation gate could never anchor
 * would be permanently uncreditable, so the case is refused at creation instead
 * of silently scoring 0 for ever.
 *
 * It walks the COVERED lines, never the declared range — the same formulation
 * `reviewer-core/src/grounding.ts:48-53` uses, and for the same reason: an
 * `end_line` is unbounded input, and iterating a declared range lets one value
 * block the event loop for about 13 seconds.
 */
export function intersectsAHunk(
  diff: UnifiedDiff,
  file: string,
  start: number,
  end: number,
): boolean {
  const f = diff.files.find((x) => x.path === file);
  if (!f) return false;
  const lo = Math.min(start, end);
  const hi = Math.max(start, end);
  for (const hunk of f.hunks) {
    for (const n of hunk.newLineNumbers) {
      if (n >= lo && n <= hi) return true;
    }
  }
  return false;
}
