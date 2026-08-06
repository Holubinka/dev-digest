/**
 * What reaches a reviewer's prompt, and what does not.
 *
 * The load-bearing assertion is that `raw` is rebuilt. `reviewPullRequest`
 * sends `diff.raw` verbatim in single-pass mode, so a filter that only pruned
 * `files` would remove a file from the strategy decision and the trace while
 * still paying for every one of its lines in the prompt — the exact cost this
 * exists to remove, left in place and now invisible.
 */
import { describe, it, expect } from 'vitest';
import { parseUnifiedDiff } from '../src/adapters/git/diff-parser.js';
import { reviewableDiff, unreviewableReason } from '../src/modules/reviews/reviewable.js';

const file = (path: string, body = '+one line') =>
  `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1 +1,2 @@\n context\n${body}\n`;

const diffOf = (...paths: string[]) => parseUnifiedDiff(paths.map((p) => file(p)).join(''));

describe('unreviewableReason', () => {
  it.each([
    ['server/src/db/migrations/meta/0012_snapshot.json', 'generated'],
    ['server/drizzle/meta/_journal.json', 'generated'],
    ['client/.next/build-manifest.json', 'build output'],
    ['pnpm-lock.yaml', 'lockfile'],
    ['server/pnpm-lock.yaml', 'lockfile'],
    ['client/src/__snapshots__/x.snap', 'snapshot'],
    ['docs/diagram.png', 'binary'],
    ['client/public/icon.SVG', 'binary'],
  ])('drops %s as %s', (path, reason) => {
    expect(unreviewableReason(path)).toBe(reason);
  });

  /**
   * Deliberately narrower than scope.sh. Markdown under docs/ and specs/ is
   * how a reviewer judges whether the code matches what was asked for, and
   * `docs/agent-prompts/*.md` is prompt source — dropping either would hide a
   * real change, not noise.
   */
  it.each([
    'server/src/modules/reviews/run-executor.ts',
    'specs/05-intent-layer.md',
    'docs/agent-prompts/general-reviewer.md',
    'server/src/db/migrations/0012_add_intent.sql',
    'server/src/db/schema/agents.ts',
    'README.md',
  ])('keeps %s', (path) => {
    expect(unreviewableReason(path)).toBeUndefined();
  });
});

describe('reviewableDiff', () => {
  it('returns the input untouched when nothing matches', () => {
    const diff = diffOf('server/src/a.ts', 'client/src/b.tsx');
    const result = reviewableDiff(diff);

    expect(result.dropped).toEqual([]);
    // Same object, so an ordinary PR pays no re-parse.
    expect(result.diff).toBe(diff);
  });

  it('removes the file from BOTH files and raw', () => {
    const snapshot = 'server/src/db/migrations/meta/0012_snapshot.json';
    const { diff, dropped } = reviewableDiff(diffOf('server/src/a.ts', snapshot, 'client/src/b.tsx'));

    expect(dropped).toEqual([{ path: snapshot, reason: 'generated' }]);
    expect(diff.files.map((f) => f.path)).toEqual(['server/src/a.ts', 'client/src/b.tsx']);
    // The half that actually costs money.
    expect(diff.raw).not.toContain(snapshot);
    expect(diff.raw).toContain('server/src/a.ts');
    expect(diff.raw).toContain('client/src/b.tsx');
  });

  /** The kept sections must survive whole — a split that eats a hunk is worse than no filter. */
  it('leaves every kept file byte-identical', () => {
    const kept = diffOf('server/src/a.ts', 'client/src/b.tsx');
    const { diff } = reviewableDiff(parseUnifiedDiff(file('server/src/a.ts') + file('pnpm-lock.yaml') + file('client/src/b.tsx')));

    expect(diff.raw.trim()).toBe(kept.raw.trim());
  });

  it('drops several files and reports each with its reason', () => {
    const { dropped } = reviewableDiff(
      diffOf('pnpm-lock.yaml', 'server/src/a.ts', 'docs/x.png', 'server/src/db/migrations/meta/m.json'),
    );

    expect(dropped.map((d) => d.reason).sort()).toEqual(['binary', 'generated', 'lockfile']);
  });

  it('never empties a diff whose sections it cannot key', () => {
    // A raw blob with no `diff --git` header parses to zero files, so nothing
    // is droppable and the input must come back as it went in.
    const odd = { raw: 'not a diff at all\n', files: [] };
    expect(reviewableDiff(odd).diff).toBe(odd);
  });
});
