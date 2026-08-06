import type { UnifiedDiff } from '@devdigest/shared';
import { parseUnifiedDiff } from '../../adapters/git/diff-parser.js';

/**
 * Which changed files belong in a review prompt.
 *
 * Measured on PR #11 of this repo: of the 15,105 changed lines the reviewers
 * were sent, 3,553 were `server/src/db/migrations/meta/0012_snapshot.json` — a
 * file drizzle-kit writes, that no reviewer can act on, and that rode into
 * every agent's prompt once per agent. `scripts/pr-self-review/scope.sh` has
 * skipped exactly this class since it was written; the app's review path never
 * learned to.
 *
 * The list is deliberately narrower than `scope.sh`'s. That script also routes
 * `docs/**`, `specs/**` and `*.md` away from its subagents, and copying that
 * here would be wrong: `docs/agent-prompts/*.md` IS prompt source, and a spec
 * is how a reviewer judges whether the code matches what was asked for. Only
 * files a reviewer could not act on if they read them are dropped —
 * machine-written, compiled, locked or binary.
 */
const UNREVIEWABLE: ReadonlyArray<readonly [RegExp, string]> = [
  // Drizzle snapshots. Both shapes are named so the skip survives a config
  // move — this repo's `out` is `src/db/migrations`, not `drizzle/`.
  [/(^|\/)(drizzle|migrations)\/meta\//, 'generated'],
  [/(^|\/)(dist|\.next|coverage|node_modules)\//, 'build output'],
  [/(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock)$/, 'lockfile'],
  [/\.snap$/, 'snapshot'],
  [/\.(png|jpe?g|svg|webp|ico|pdf|woff2?|ttf|eot|zip|gz)$/i, 'binary'],
];

/** Why this path should not reach a reviewer, or `undefined` when it should. */
export function unreviewableReason(path: string): string | undefined {
  return UNREVIEWABLE.find(([pattern]) => pattern.test(path))?.[1];
}

/**
 * The same diff with the unreviewable files removed, and `raw` rebuilt.
 *
 * Rebuilding `raw` is the whole job, not a tidy-up: `reviewPullRequest` sends
 * `diff.raw` verbatim in single-pass mode, so filtering `files` alone would
 * drop a file from the strategy decision and the trace while still paying for
 * it in the prompt. Splitting on `diff --git ` is safe because git emits that
 * header once per file and nowhere else at column zero.
 *
 * Returns the input unchanged when nothing matches, so an ordinary PR pays no
 * re-parse — and so a diff this cannot split cannot be silently emptied.
 */
export function reviewableDiff(diff: UnifiedDiff): {
  diff: UnifiedDiff;
  dropped: { path: string; reason: string }[];
} {
  const dropped = diff.files
    .map((f) => ({ path: f.path, reason: unreviewableReason(f.path) }))
    .filter((d): d is { path: string; reason: string } => d.reason !== undefined);

  if (dropped.length === 0) return { diff, dropped: [] };

  const drop = new Set(dropped.map((d) => d.path));
  const kept = splitByFile(diff.raw).filter((section) => {
    const path = pathOf(section);
    return path === undefined || !drop.has(path);
  });

  return { diff: parseUnifiedDiff(kept.join('')), dropped };
}

/** Raw diff → one string per `diff --git` section, each keeping its trailing newline. */
function splitByFile(raw: string): string[] {
  const sections: string[] = [];
  let current = '';
  for (const line of raw.split('\n')) {
    if (line.startsWith('diff --git ') && current.length > 0) {
      sections.push(current);
      current = '';
    }
    current += `${line}\n`;
  }
  if (current.length > 0) sections.push(current);
  return sections;
}

/**
 * The b-side path of a section header, which is the one the parser keys on.
 * `undefined` for a leading section that is not a file (git emits none today,
 * but an unparsable header must not silently drop the file it belongs to).
 */
function pathOf(section: string): string | undefined {
  const header = /^diff --git a\/(.+?) b\/(.+)$/m.exec(section.split('\n')[0] ?? '');
  return header?.[2];
}
