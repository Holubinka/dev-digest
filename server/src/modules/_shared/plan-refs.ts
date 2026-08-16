import { sanitizeRelativePath } from './repo-paths.js';

/**
 * Which links in a PR body become clone reads.
 *
 * It lived in `modules/intent/helpers.ts` until 2026-08-16, when `modules/brief`
 * needed the same answer for the spec files it puts in front of the model.
 * `no-cross-module` forbids one slice importing another, and the alternatives
 * were both worse than moving it: copying sixty lines of a security gate is the
 * failure `_shared/repo-paths.ts` already exists to stop, and sourcing the paths
 * from `IntentRecord.plan_refs` instead would make the brief's `specs` input
 * unreachable whenever its `intent` input is missing — two statuses the contract
 * reports independently.
 *
 * `modules/intent/helpers.ts` re-exports both names bound to its own caps, so
 * `test/intent-helpers.test.ts` passes unchanged; that is the proof the move was
 * behaviour-preserving.
 */

/**
 * The path gate between an attacker-supplied PR body and `GitClient.readFile`.
 *
 * `SimpleGitClient.readFile` is `readFile(join(clonePathFor(repo), path))`
 * (`adapters/git/simple-git.ts:129-131`), and `join('/clones/o/r', '../../etc/passwd')`
 * resolves outside the clone. On a public repo the body is attacker-supplied,
 * so this is a real traversal sink, not a theoretical one.
 *
 * The string rules live in `repo-paths.ts`, shared with the saved-attachment
 * gate. What is local here is the `.md` rule and the caller's own `maxLength`,
 * which is deliberately lower than the attachment gate's: this path comes out of
 * an attacker's PR body rather than a maintainer's editor.
 */
export function sanitizeMarkdownRepoPath(raw: string, maxLength: number): string | null {
  const path = sanitizeRelativePath(raw, maxLength);
  if (path === null) return null;
  // One extension, one parser, one attack surface.
  if (!path.toLowerCase().endsWith('.md')) return null;
  return path;
}

/** Same-repo GitHub blob URLs. `[^\s)"'<>]` stops the match at a markdown-link or HTML boundary. */
const BLOB_URL = /https?:\/\/(?:www\.)?github\.com\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)\/blob\/([^\s)"'<>]+)/gi;

/**
 * Path-like tokens ending in `.md`. Backticks, parentheses and `:` are outside
 * the class, so a backticked path and a markdown link's target both fall out of
 * the same scan, while any absolute URL leaves a leading `//` that
 * `sanitizeMarkdownRepoPath` rejects. Bounded repetition keeps it linear on a
 * long body.
 */
const MD_PATH = /[A-Za-z0-9._\-/]{0,200}\.md\b/gi;

export interface PlanRefLimits {
  /** How many paths at most. */
  maxFiles: number;
  /** Longest repo-relative path accepted. */
  maxPathLength: number;
}

/**
 * Repo-relative plan/spec paths referenced by a PR body, at most
 * `limits.maxFiles` of them, de-duplicated and normalised.
 *
 * SUPPORTED
 *   - a bare repo-relative `.md` path, plain or in backticks;
 *   - a markdown link whose target is such a path;
 *   - a GitHub blob URL for THIS repo — owner/name compared case-insensitively,
 *     the `<ref>` segment discarded (the clone's current checkout is read), and
 *     a `#L12-L40` anchor or `?plain=1` query stripped.
 *
 * NOT SUPPORTED, deliberately
 *   - a blob URL for any other repo, and any gist: there is no clone to read
 *     them from and this function makes no network calls;
 *   - anything that is not `.md` — `.txt`, `.adoc`, `.rst`, source files;
 *   - Notion, Linear, Jira, Confluence and Google Docs URLs: no adapter, no
 *     credential, and no plan to add one;
 *   - issue and PR links beyond the single `#\d+` `resolveLinkedIssue` handles;
 *   - `../` traversal, absolute paths, and anything outside the clone. Those
 *     are not merely unsupported — `sanitizeMarkdownRepoPath` rejects them.
 *
 * A branch name containing `/` in a blob URL is read as ref + path at the first
 * slash, so `blob/feat/x/specs/p.md` yields `x/specs/p.md` and simply fails to
 * read. GitHub's own URLs give no way to tell the two apart.
 */
export function parsePlanRefs(
  body: string,
  repo: { owner: string; name: string },
  limits: PlanRefLimits,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (candidate: string): boolean => {
    const path = sanitizeMarkdownRepoPath(candidate, limits.maxPathLength);
    if (path && !seen.has(path)) {
      seen.add(path);
      out.push(path);
    }
    return out.length >= limits.maxFiles;
  };

  for (const [, owner, name, rest] of body.matchAll(BLOB_URL)) {
    if (owner?.toLowerCase() !== repo.owner.toLowerCase()) continue;
    if (name?.toLowerCase() !== repo.name.toLowerCase()) continue;
    const withoutAnchor = (rest ?? '').split('#')[0]?.split('?')[0] ?? '';
    if (push(withoutAnchor.split('/').slice(1).join('/'))) return out;
  }

  for (const [match] of body.matchAll(MD_PATH)) {
    if (push(match)) return out;
  }
  return out;
}
