import type { UnifiedDiff } from '@devdigest/shared';
import { AppError } from '../../platform/errors.js';

/**
 * Guards over a parsed unified diff, shared by every entry point that accepts
 * one as untrusted text.
 *
 * Moved out of `modules/reviews/diff-review.ts` unchanged — messages included —
 * when the eval pipeline gained a second such entry point: a hand-edited
 * `input_diff` on an eval case is the same attacker-controlled text as a body
 * posted to `POST /reviews/diff`. A second copy of the over-claiming-hunk check
 * below would be a copy that eventually stops matching the first, and the
 * measurement in its comment is what the drift would cost.
 */

/**
 * Reject a body that parsed into nothing the grounding gate can anchor to.
 *
 * `groundFindings` builds its line index from `diff.files[].hunks`
 * (`reviewer-core/src/grounding.ts:24-39`), so a diff with no hunks makes EVERY
 * line-anchored finding fail the gate and be dropped. The model call still
 * happens and still costs money, and the caller gets an empty, confident-looking
 * "no findings" answer. Failing before the call is the only honest outcome.
 *
 * Counting hunks is not enough, because a hunk is a HEADER: `@@` declares a
 * new-side range and the lines under it are what actually cover one. When a hunk
 * covers nothing, `buildLineIndex` falls back to the declared range
 * (`reviewer-core/src/grounding.ts:31-34`) and materialises one `Set` entry per
 * declared line — from a body that never carried them. Measured on this repo:
 * the 49-byte body `diff --git a/x b/x\n+++ b/x\n@@ -1,1 +1,16000000 @@` parses to
 * 1 file / 1 hunk / `newLineNumbers: []`, and building its index blocks the
 * single-process event loop for 1345 ms while allocating 478 MB; a 20-digit count
 * reaches `RangeError: Set maximum size exceeded`. That work runs once PER AGENT,
 * after each agent's paid call has already been made, at 6 requests/minute.
 */
export function assertReviewableDiff(diff: UnifiedDiff): void {
  if (diff.files.length === 0) {
    throw new AppError(
      'invalid_diff',
      'The body is not a unified diff — no "diff --git"/"+++" file header was found. ' +
        'Send the output of `git diff`, unmodified.',
      422,
    );
  }

  const hunks = diff.files.flatMap((file) => file.hunks);
  if (hunks.length === 0) {
    throw new AppError(
      'invalid_diff',
      'The diff names files but carries no @@ hunks, so no finding could be anchored to a ' +
        'line and every one would be dropped by the citation gate. Send a diff with context, ' +
        'not a `--stat` or `--name-only` summary.',
      422,
    );
  }

  // Checked PER HUNK, not as a total across the diff. One honest file in front of
  // the crafted one keeps a whole-diff total above zero while the crafted hunk
  // still takes the fallback — verified: a 95-byte two-file body totals 1 covered
  // line and still built a 16,000,000-entry Set in 1333 ms.
  const overclaiming = hunks.find((h) => h.newLineNumbers.length === 0 && h.newLines > 0);
  if (overclaiming) {
    throw new AppError(
      'invalid_diff',
      `A hunk header declares ${overclaiming.newLines} new-side line(s) from line ` +
        `${overclaiming.newStart} but no line follows it, so the body describes content it ` +
        'does not carry. Send the output of `git diff`, unmodified and untruncated.',
      422,
    );
  }

  if (hunks.every((h) => h.newLineNumbers.length === 0)) {
    throw new AppError(
      'invalid_diff',
      'Every hunk in this diff removes lines and adds none, so there is no new-side line for a ' +
        'finding to cite and the citation gate would drop all of them. Review the diff that ' +
        'introduced the code, or include the files that changed alongside the deletion.',
      422,
    );
  }
}
