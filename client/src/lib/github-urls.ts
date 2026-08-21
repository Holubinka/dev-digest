/* github-urls.ts — build github.com deep-links from data we already hold.
   PR detail has repo full_name (owner/repo), PR number, head sha, and finding
   file/line — enough to open the PR or a file blob at a line range in a new tab.

   `file` reaches here from `findings.file`, a plain-text column an agent writes,
   so these builders treat every component as hostile. The host is a literal
   prefix and each segment is percent-encoded, which is what keeps a value like
   `https://evil.com` a path segment rather than a new origin. Dot segments are
   the one thing encoding does not neutralise — see `hasDotSegment`. */

const HOST = "https://github.com";

/**
 * True when a path contains a `.` or `..` segment.
 *
 * `encodeURIComponent` leaves both untouched, and the browser resolves them
 * before it sends the request: a `file` of `../../../../attacker/repo/blob/
 * main/README.md` turns `https://github.com/acme/repo/blob/<sha>/…` into
 * `https://github.com/attacker/repo/…`. That cannot leave github.com — the
 * origin is a literal here — but it does let a citation read as one repo and
 * open another, so a path carrying one gets no link at all.
 *
 * No legitimate value hits this: these paths come from a diff and are already
 * repo-relative and normalised.
 *
 * Exported because it is a security predicate, and a second caller wanting the
 * same rule has to get THIS one. `isLinkablePath` below asks the same question
 * of a model-written reference before turning it into a control; a copy of the
 * pattern over there would be one definition too many of a rule whose whole job
 * is to be identical everywhere.
 */
export function hasDotSegment(path: string): boolean {
  return /(?:^|\/)\.\.?(?:\/|$)/.test(path);
}

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
 *
 * It lives beside `hasDotSegment` rather than beside its callers because it HAS
 * two callers now — a risk reference and a review-focus reference, in two
 * different folders — and a security predicate gets one home whatever the
 * distance (`client/INSIGHTS.md:484-496`).
 */
export function isLinkablePath(path: string): boolean {
  if (!path) return false;
  if (CONTROL.test(path)) return false;
  if (SCHEME.test(path)) return false;
  if (hasDotSegment(path)) return false;
  return true;
}

/** Encode a repo-relative path for a URL while keeping "/" separators. */
function encPath(file: string): string {
  return file
    .split("/")
    .map(encodeURIComponent)
    .join("/");
}

/**
 * https://github.com/{owner}/{repo}/pull/{number}
 *
 * Returns `undefined` on a dot segment, exactly as `githubBlobUrl` does — the
 * header above claims every component is treated as hostile, and one builder
 * exempting itself is how that claim stops being true. No value reaching here
 * today can trip it (`repoFullName` is the server's `${owner}/${name}`), so
 * this is consistency, not a live traversal.
 */
export function githubPrUrl(repoFullName: string, number: number): string | undefined {
  if (hasDotSegment(repoFullName)) return undefined;
  return `${HOST}/${encPath(repoFullName)}/pull/${number}`;
}

/**
 * https://github.com/{owner}/{repo}/blob/{sha}/{file}#L{start}[-L{end}]
 * `sha` pins the link to the PR's head so line numbers stay accurate.
 *
 * Returns `undefined` when any component would escape the blob path. Callers
 * already render an unlinked citation when they have no repo or sha, so an
 * unbuildable link degrades to plain text rather than to a misleading one.
 */
export function githubBlobUrl(
  repoFullName: string,
  sha: string,
  file: string,
  startLine?: number,
  endLine?: number,
): string | undefined {
  if (hasDotSegment(repoFullName) || hasDotSegment(sha) || hasDotSegment(file)) {
    return undefined;
  }
  let url = `${HOST}/${encPath(repoFullName)}/blob/${encodeURIComponent(sha)}/${encPath(file)}`;
  if (startLine != null) {
    url += `#L${startLine}`;
    if (endLine != null && endLine !== startLine) url += `-L${endLine}`;
  }
  return url;
}
