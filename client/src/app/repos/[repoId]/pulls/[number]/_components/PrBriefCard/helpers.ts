/* Pure rules the Risk Brief card applies to model-written references before it
   turns any of them into a control. Kept out of the component because they are
   calculation, not rendering, and because they are the part worth testing on
   their own. */

/**
 * A control character anywhere in the string. `\p{Cc}` is the whole C0/C1 range
 * plus DEL — none of them is legal in a path, and each is a way of spelling a
 * scheme that neither the eye nor the pattern below can see: a browser strips
 * TAB, LF and CR from a URL wherever they sit, so `java\tscript:` IS
 * `javascript:` by the time anything resolves it (`client/INSIGHTS.md:365`).
 */
const CONTROL = /\p{Cc}/u;

/** `scheme:` at the start. A repo-relative path never has one. */
const SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

/**
 * A `.` or `..` segment. `encodeURIComponent` leaves both untouched and the
 * browser resolves them before it sends the request, so a reference carrying one
 * can make a citation read as one repo and open another
 * (`client/INSIGHTS.md:135`, and `githubBlobUrl` refuses these on its own).
 */
const DOT_SEGMENT = /(?:^|\/)\.\.?(?:\/|$)/;

/**
 * Whether a model-written reference may become a link or a button.
 *
 * Membership in the grounding set is NOT this question. The server guarantees
 * every `file_ref` and every `review_focus[].ref` is a member of the allowed set
 * built from that call's own input — which says the string names something real,
 * and says nothing about whether it is safe to put in a URL. `pr_files.path` is
 * GitHub-supplied text and the allowed set also carries blast endpoint labels,
 * so both checks have to hold.
 *
 * The control-character refusal comes FIRST and is separate from the scheme
 * test on purpose: `SCHEME` matches no control character, so a scheme spelled
 * with one inside falls straight through it. Refusing the whole class ahead of
 * the pattern is what closes that, and keeps the order correct if this ever
 * becomes strip-then-test the way `isSafeUrl` is.
 */
export function isLinkablePath(path: string): boolean {
  if (!path) return false;
  if (CONTROL.test(path)) return false;
  if (SCHEME.test(path)) return false;
  if (DOT_SEGMENT.test(path)) return false;
  return true;
}

/**
 * The abbreviated form git itself prints, exactly as `BlastRadiusCard` does it.
 * `String.slice` is safe here and only here: a commit id is `[0-9a-f]{40}`, so
 * there is no surrogate pair to split.
 */
export const shortSha = (sha: string) => sha.slice(0, 7);
