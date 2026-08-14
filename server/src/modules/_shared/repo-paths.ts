/**
 * The string rules every repo-relative path must pass before it reaches a
 * `GitClient` call, and the code-point truncation that goes with them.
 *
 * `_shared/` because two slices need the same gate and `no-cross-module` forbids
 * either importing the other — the rule's own message names this folder as the
 * remedy (`.dependency-cruiser.cjs:149`). Before 2026-08-15 each slice carried
 * its own copy, and they had already drifted: `intent` refused only `.git/`,
 * `context` refused a bare `.git` segment too. That is what a duplicated
 * security gate does, and it is why this file exists.
 *
 * Nothing here touches the filesystem, so both callers stay unit-testable with
 * no clone. The other half of the traversal defence — a symlink whose NAME ends
 * in `.md` and whose TARGET is elsewhere — is not decidable from a string at all
 * and lives in the git adapter, where the resolution happens.
 */

/**
 * Truncate by CODE POINT.
 *
 * `String.slice` counts UTF-16 units and splits a surrogate pair, leaving a lone
 * high surrogate at the cut (`server/INSIGHTS.md`). Text out of a public repo may
 * contain anything, so this is ordinary input rather than a corner case.
 */
export function truncateCodePoints(text: string, max: number): string {
  const points = [...text];
  return points.length <= max ? text : points.slice(0, max).join('');
}

/**
 * Everything a repo-relative path must satisfy, before any extension rule.
 *
 * Returns the normalised path, or `null` when the input is not one. `path.resolve`
 * is deliberately NOT used: it would tie the answer to the process CWD and stop
 * this function being pure. The invariant every caller relies on — "no `..`
 * segment survives" — is decidable on the string alone.
 *
 * `maxLength` is a parameter rather than a constant because the two callers
 * genuinely differ: `intent` caps at 200 for a path parsed out of an attacker's
 * PR body, `context` at 512 for one a maintainer typed into the editor. Folding
 * them into one number here would have silently moved one of them.
 */
export function sanitizeRelativePath(raw: string, maxLength: number): string | null {
  if (raw.length === 0 || raw.length > maxLength) return null;
  // A NUL truncates the path at the syscall boundary; no other control character
  // belongs in a repo-relative path either.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001F\u007F]/.test(raw)) return null;
  // Absolute POSIX, absolute UNC, and Windows drive-letter forms.
  if (raw.startsWith('/') || raw.startsWith('\\')) return null;
  if (/^[A-Za-z]:/.test(raw)) return null;

  const segments = raw
    .replaceAll('\\', '/')
    .split('/')
    .filter((segment) => segment !== '' && segment !== '.');
  if (segments.length === 0) return null;
  if (segments.includes('..')) return null;

  const normalised = segments.join('/');
  // `.git/config` carries the clone URL with the stored PAT in it. The whole
  // directory is refused rather than that one file: `.git/hooks/pre-commit` is
  // code git executes, which a write path makes a worse outcome than a leak.
  // The bare segment is refused with it — the stricter of the two rules this
  // file replaced, and a no-op for a caller that also requires an extension.
  const lower = normalised.toLowerCase();
  if (lower === '.git' || lower.startsWith('.git/')) return null;
  return normalised;
}
