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
 */
function hasDotSegment(path: string): boolean {
  return /(?:^|\/)\.\.?(?:\/|$)/.test(path);
}

/** Encode a repo-relative path for a URL while keeping "/" separators. */
function encPath(file: string): string {
  return file
    .split("/")
    .map(encodeURIComponent)
    .join("/");
}

/** https://github.com/{owner}/{repo}/pull/{number} */
export function githubPrUrl(repoFullName: string, number: number): string {
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
