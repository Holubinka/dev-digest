/**
 * context — the pure layer. No database, no clone, no tokenizer: `count` is a
 * parameter, which is the whole reason the budget walk can be pinned here.
 */
import { describe, it, expect } from 'vitest';
import {
  contentHash,
  dedupePaths,
  effectiveSet,
  kindForRoot,
  normalizeRoot,
  renderDoc,
  rootFor,
  sanitizeDocPath,
  sanitizeFolderPath,
  selectWithinBudget,
  truncateToBudget,
  writeZone,
  type BudgetCandidate,
} from '../src/modules/context/helpers.js';
import { resolveContextSettings } from '../src/modules/context/settings.js';

/** A counter that is not the identity: tokens are coarser than characters. */
const byChars = (s: string) => s.length;

describe('normalizeRoot', () => {
  it('collapses every spelling of one root to the single form the walk produces', () => {
    for (const raw of ['docs', 'docs/', './docs', './docs/', 'docs//', '.\\docs', '/docs']) {
      expect(normalizeRoot(raw)).toBe('docs');
    }
    expect(normalizeRoot('docs/adr/')).toBe('docs/adr');
  });

  it('drops a root that names nothing', () => {
    // Both would resolve to the clone directory itself and walk the whole
    // repository, and neither can label a document afterwards.
    expect(normalizeRoot('')).toBeNull();
    expect(normalizeRoot('.')).toBeNull();
    expect(normalizeRoot('./')).toBeNull();
  });

  it('refuses a root that climbs out of the clone', () => {
    expect(normalizeRoot('..')).toBeNull();
    expect(normalizeRoot('../etc')).toBeNull();
    expect(normalizeRoot('docs/../../etc')).toBeNull();
  });
});

describe('kindForRoot', () => {
  it('maps the three named roots to themselves', () => {
    expect(kindForRoot('specs')).toBe('specs');
    expect(kindForRoot('docs')).toBe('docs');
    expect(kindForRoot('insights')).toBe('insights');
    expect(kindForRoot('DOCS')).toBe('docs');
  });

  it('returns `other` for a configured root named none of the three', () => {
    // The fourth kind is a REQUIREMENT, not a fallback: a workspace that
    // configures `handbook` gets a badge saying so, not one saying `docs`.
    expect(kindForRoot('handbook')).toBe('other');
    expect(kindForRoot('')).toBe('other');
    expect(kindForRoot('other')).toBe('other');
  });

  it('decides on the FIRST segment, so a nested root keeps its family', () => {
    expect(kindForRoot('docs/adr')).toBe('docs');
    expect(kindForRoot('handbook/team')).toBe('other');
  });
});

/**
 * `.devdigest` is the one root that names no family. It exists because DevDigest
 * has to write somewhere untracked, not because anyone chose it as a category —
 * so the first segment would label EVERY authored document `other` while the
 * list row beside the badge read `specs/public-api.md`. The row and the badge
 * disagreeing about one document is the same contradiction this increment was
 * opened to remove, so the segment BELOW the root decides instead.
 */
describe('kindForRoot — under `.devdigest` the folder below the root decides', () => {
  it('takes the family from the folder under .devdigest/', () => {
    expect(kindForRoot('.devdigest', '.devdigest/specs/public-api.md')).toBe('specs');
    expect(kindForRoot('.devdigest', '.devdigest/docs/x.md')).toBe('docs');
    expect(kindForRoot('.devdigest', '.devdigest/insights/x.md')).toBe('insights');
  });

  it('is `other` for a folder that names no family', () => {
    expect(kindForRoot('.devdigest', '.devdigest/adr/0001.md')).toBe('other');
    expect(kindForRoot('.devdigest', '.devdigest/handbook/x.md')).toBe('other');
    expect(kindForRoot('.devdigest', '.devdigest/other/x.md')).toBe('other');
  });

  it('is `other` for a document sitting directly under .devdigest/', () => {
    // No folder at all, so nothing names a family.
    expect(kindForRoot('.devdigest', '.devdigest/x.md')).toBe('other');
    // …and a FILE called `specs.md` is a document named specs, not a specs
    // document: the first segment below the root counts only when something
    // follows it.
    expect(kindForRoot('.devdigest', '.devdigest/specs.md')).toBe('other');
  });

  it('matches the folder case-insensitively, as the root rule does', () => {
    expect(kindForRoot('.devdigest', '.devdigest/SPECS/x.md')).toBe('specs');
  });

  it('keeps the family for a document nested deeper under the folder', () => {
    expect(kindForRoot('.devdigest', '.devdigest/specs/api/v2.md')).toBe('specs');
  });

  it('still answers `other` for the root alone, with no document to look at', () => {
    // A caller labelling a ROOT rather than a document gets the honest answer:
    // `.devdigest` on its own names nothing.
    expect(kindForRoot('.devdigest')).toBe('other');
  });

  /**
   * The regression this special case could break. Only `.devdigest` looks below
   * its root; every ordinary root keeps deciding on its own first segment,
   * whatever the document beneath it happens to be called.
   */
  it('does NOT look below the root for an ordinary root', () => {
    expect(kindForRoot('docs', 'docs/specs/x.md')).toBe('docs');
    expect(kindForRoot('handbook', 'handbook/specs/x.md')).toBe('other');
    expect(kindForRoot('docs/adr', 'docs/adr/0001.md')).toBe('docs');
    // Not a prefix match: a root merely starting with the name is unaffected.
    expect(kindForRoot('.devdigestx', '.devdigestx/specs/x.md')).toBe('other');
  });
});

describe('renderDoc', () => {
  it('puts the repo-relative path INSIDE the rendered document', () => {
    // The path travels in the content, never in wrapUntrusted's label, which is
    // interpolated into source="…" without escaping.
    expect(renderDoc('docs/a.md', 'Body.')).toBe('### docs/a.md\n\nBody.');
  });
});

describe('sanitizeDocPath', () => {
  it('accepts a repo-relative .md path and normalises it', () => {
    expect(sanitizeDocPath('docs/a.md')).toBe('docs/a.md');
    expect(sanitizeDocPath('./docs//a.md')).toBe('docs/a.md');
    expect(sanitizeDocPath('docs\\a.md')).toBe('docs/a.md');
  });

  it('refuses traversal, absolutes, the git directory and non-markdown', () => {
    expect(sanitizeDocPath('../../etc/passwd')).toBeNull();
    expect(sanitizeDocPath('docs/../../secrets.md')).toBeNull();
    expect(sanitizeDocPath('/etc/passwd.md')).toBeNull();
    expect(sanitizeDocPath('C:\\secrets.md')).toBeNull();
    expect(sanitizeDocPath('.git/config')).toBeNull();
    expect(sanitizeDocPath('.git/x.md')).toBeNull();
    expect(sanitizeDocPath('docs/a.txt')).toBeNull();
    expect(sanitizeDocPath('')).toBeNull();
    expect(sanitizeDocPath(`docs/a\u0000.md`)).toBeNull();
    expect(sanitizeDocPath(`${'a'.repeat(600)}.md`)).toBeNull();
  });

  it('leaves .github alone — the refusal is the git DIRECTORY, exactly', () => {
    expect(sanitizeDocPath('.github/CONTRIBUTING.md')).toBe('.github/CONTRIBUTING.md');
  });

  /**
   * A clone can hold a second repository — a vendored dependency, a fixture, a
   * stray `git init` — and its `.git` is a real one carrying a real remote URL.
   * Until 2026-08-16 only the LEADING segment was tested, so every path here was
   * accepted while the comment above the rule said the git directory is refused.
   */
  it('refuses a nested repository’s git directory, at any depth', () => {
    expect(sanitizeDocPath('docs/vendor/.git/config.md')).toBeNull();
    expect(sanitizeDocPath('a/b/c/.git/hooks/pre-commit.md')).toBeNull();
    expect(sanitizeFolderPath('docs/vendor/.git/hooks')).toBeNull();
    // macOS resolves `.GIT` to the same directory, so an exact compare would
    // refuse what a caller typed and admit what it did not.
    expect(sanitizeDocPath('docs/.GIT/config.md')).toBeNull();
  });

  it('does not over-reach: a segment merely containing "git" is a normal folder', () => {
    expect(sanitizeDocPath('docs/.github/notes.md')).toBe('docs/.github/notes.md');
    expect(sanitizeDocPath('docs/gitignore-notes/a.md')).toBe('docs/gitignore-notes/a.md');
    expect(sanitizeDocPath('docs/git/a.md')).toBe('docs/git/a.md');
  });
});

describe('effectiveSet', () => {
  const skill = (skillId: string, order: number, paths: string[]) => ({
    skillId,
    skillName: `skill-${skillId}`,
    order,
    paths: paths.map((path, position) => ({ path, position })),
  });

  it('takes own documents in saved order, then skills in binding order', () => {
    const set = effectiveSet(
      [
        { path: 'own-b.md', position: 1 },
        { path: 'own-a.md', position: 0 },
      ],
      [skill('s2', 1, ['s2.md']), skill('s1', 0, ['s1.md'])],
    );
    expect(set.map((d) => d.path)).toEqual(['own-a.md', 'own-b.md', 's1.md', 's2.md']);
  });

  it('de-duplicates by path with the FIRST occurrence winning, so an own attachment beats an inherited one', () => {
    const set = effectiveSet(
      [{ path: 'shared.md', position: 0 }],
      [skill('s1', 0, ['shared.md', 's1.md']), skill('s2', 1, ['shared.md'])],
    );
    expect(set.map((d) => d.path)).toEqual(['shared.md', 's1.md']);
    expect(set[0]!.source).toEqual({ kind: 'own' });
    // Counted once, in the token total and everywhere else.
    expect(set.filter((d) => d.path === 'shared.md')).toHaveLength(1);
  });

  it('attributes an inherited document to the FIRST skill that carries it', () => {
    const set = effectiveSet([], [skill('s1', 0, ['x.md']), skill('s2', 1, ['x.md'])]);
    expect(set).toEqual([
      { path: 'x.md', source: { kind: 'skill', skillId: 's1', skillName: 'skill-s1' } },
    ]);
  });
});

describe('selectWithinBudget', () => {
  const doc = (path: string, size: number): BudgetCandidate => ({
    path,
    rendered: 'x'.repeat(size),
  });

  it('includes documents in order while they fit', () => {
    const { blocks, results } = selectWithinBudget([doc('a', 10), doc('b', 10)], 100, byChars);
    expect(blocks).toHaveLength(2);
    expect(results.map((r) => r.status)).toEqual(['included', 'included']);
    expect(results.map((r) => r.tokens)).toEqual([10, 10]);
  });

  it('includes a document that fits EXACTLY', () => {
    const { results } = selectWithinBudget([doc('a', 50)], 50, byChars);
    expect(results[0]!.status).toBe('included');
  });

  it('STOPS at the first document that does not fit — a later smaller one does not jump the queue', () => {
    // This is the assertion that pins the settled reading of the rule rather
    // than restating the code: `c` fits in what is left, and is still dropped.
    const { blocks, results } = selectWithinBudget(
      [doc('a', 40), doc('b', 40), doc('c', 5)],
      50,
      byChars,
    );
    expect(blocks).toHaveLength(1);
    expect(results.map((r) => [r.path, r.status])).toEqual([
      ['a', 'included'],
      ['b', 'dropped'],
      ['c', 'dropped'],
    ]);
  });

  it('truncates the FIRST document when it alone exceeds the budget, and the block is not empty', () => {
    const { blocks, results } = selectWithinBudget([doc('big', 500), doc('next', 1)], 20, byChars);
    expect(results[0]!.status).toBe('truncated');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.length).toBeGreaterThan(0);
    expect(blocks[0]!.length).toBeLessThanOrEqual(20);
    // Truncation exhausts the budget, so the walk stops there too.
    expect(results[1]!.status).toBe('dropped');
  });

  it('truncates only the first document — a later oversized one is dropped, not cut', () => {
    const { results } = selectWithinBudget([doc('a', 10), doc('b', 500)], 20, byChars);
    expect(results.map((r) => r.status)).toEqual(['included', 'dropped']);
  });

  it('reports a read failure where it sits, and keeps walking past it', () => {
    const { blocks, results } = selectWithinBudget(
      [
        { path: 'gone', failure: 'missing' },
        doc('a', 10),
        { path: 'evil', failure: 'refused' },
        { path: 'bin', failure: 'binary' },
        doc('b', 10),
      ],
      100,
      byChars,
    );
    expect(blocks).toHaveLength(2);
    expect(results.map((r) => [r.path, r.status])).toEqual([
      ['gone', 'missing'],
      ['a', 'included'],
      ['evil', 'refused'],
      ['bin', 'binary'],
      ['b', 'included'],
    ]);
  });

  it('records every document of the set, including the ones that never went', () => {
    const { results } = selectWithinBudget([doc('a', 200), doc('b', 1)], 0, byChars);
    expect(results).toHaveLength(2);
  });
});

describe('truncateToBudget', () => {
  it('returns the whole text when it already fits', () => {
    expect(truncateToBudget('abc', 10, byChars)).toBe('abc');
  });

  it('lands at or under budget', () => {
    const out = truncateToBudget('x'.repeat(10_000), 137, byChars);
    expect(out.length).toBeLessThanOrEqual(137);
    expect(out.length).toBeGreaterThan(0);
  });

  it('cuts by CODE POINT and never leaves a lone surrogate', () => {
    // 𝒳 is two UTF-16 units. The leading 'A' is what makes this discriminate: a
    // pure-astral string happens to land on a pair boundary, while one ASCII
    // character ahead of it puts a String.slice-based cut in the MIDDLE of a
    // pair, emitting a lone high surrogate — the "" of server/INSIGHTS.md. 100
    // is chosen for the same reason: 1 + 99 units is an odd number of astral
    // units, so the naive cut is provably wrong here.
    const astral = `A${'𝒳'.repeat(2000)}`;
    const out = truncateToBudget(astral, 100, (s) => [...s].length);
    expect([...out].length).toBeLessThanOrEqual(100);
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(out)).toBe(false);
    expect(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(out)).toBe(false);
  });

  it('never returns empty, even for a budget nothing fits', () => {
    // A zero-length block reported as `truncated` is a document that contributed
    // nothing, which is `dropped` wearing the wrong name.
    expect(truncateToBudget('hello', 0, byChars).length).toBeGreaterThan(0);
  });

  it('stays within 12 probes of the counter', () => {
    let calls = 0;
    const counting = (s: string) => {
      calls += 1;
      return s.length;
    };
    truncateToBudget('x'.repeat(40_000), 1234, counting);
    // One check for "does the whole thing fit", then at most 12 probes.
    expect(calls).toBeLessThanOrEqual(13);
  });
});

describe('dedupePaths', () => {
  it('saves a repeated path once, at its FIRST position', () => {
    expect(dedupePaths(['b.md', 'a.md', 'b.md'])).toEqual(['b.md', 'a.md']);
  });
});

// ===========================================================================
// 09 — the write path's pure half
// ===========================================================================

describe('sanitizeFolderPath', () => {
  it('accepts a folder and refuses one named like a document', () => {
    expect(sanitizeFolderPath('.devdigest/specs')).toBe('.devdigest/specs');
    expect(sanitizeFolderPath('./.devdigest/specs/')).toBe('.devdigest/specs');
    // A directory called `notes.md` is walked by nothing and readable as no
    // document, and no list that shows a path could tell it from one.
    expect(sanitizeFolderPath('.devdigest/notes.md')).toBeNull();
    expect(sanitizeFolderPath('.devdigest/NOTES.MD')).toBeNull();
  });

  it('refuses everything the document gate refuses', () => {
    for (const raw of ['', '..', '../escape', '/abs', 'C:\\win', '.git', '.git/hooks']) {
      expect(sanitizeFolderPath(raw)).toBeNull();
    }
  });
});

describe('sanitizeDocPath — the git directory', () => {
  it('refuses the git directory as a whole, not just its config', () => {
    // A write path makes this stricter than a read one: `.git/hooks/pre-commit`
    // is code git executes, which is worse than the token `.git/config` leaks.
    expect(sanitizeDocPath('.git/config.md')).toBeNull();
    expect(sanitizeDocPath('.git/hooks/x.md')).toBeNull();
    // `.github` is a different directory, and the comparison is exact.
    expect(sanitizeDocPath('.github/notes.md')).toBe('.github/notes.md');
  });
});

describe('rootFor', () => {
  it('takes the LONGEST match, so nested roots put a document in ONE group', () => {
    const roots = ['docs', 'docs/adr'];
    expect(rootFor('docs/a.md', roots)).toBe('docs');
    expect(rootFor('docs/adr/0001.md', roots)).toBe('docs/adr');
    // Order of the configured list must not decide it.
    expect(rootFor('docs/adr/0001.md', ['docs/adr', 'docs'])).toBe('docs/adr');
  });

  it('matches on a segment boundary, not a string prefix', () => {
    expect(rootFor('docsy/a.md', ['docs'])).toBeUndefined();
    expect(rootFor('docs', ['docs'])).toBe('docs');
  });

  it('returns undefined for a path under no configured root', () => {
    expect(rootFor('handbook/a.md', ['docs', 'specs'])).toBeUndefined();
  });
});

describe('writeZone', () => {
  const roots = ['docs', '.devdigest'];

  it('confines a create and a folder to .devdigest/', () => {
    expect(writeZone('.devdigest/a.md', roots, 'create')).toBeNull();
    expect(writeZone('.devdigest/specs/a.md', roots, 'create')).toBeNull();
    expect(writeZone('.devdigest/specs', roots, 'folder')).toBeNull();
    // Under a configured root is NOT enough: a new file outside `.devdigest/`
    // is tracked-adjacent and the next resync deletes it with no warning
    // possible, because there is no previous version to warn about.
    expect(writeZone('docs/a.md', roots, 'create')).toBe('outside_devdigest');
    expect(writeZone('docs/new', roots, 'folder')).toBe('outside_devdigest');
    // The root itself is neither a document nor a folder to create.
    expect(writeZone('.devdigest', roots, 'create')).toBe('outside_devdigest');
    expect(writeZone('.devdigest', roots, 'folder')).toBe('outside_devdigest');
    // A directory whose NAME merely starts with the root's.
    expect(writeZone('.devdigestx/a.md', roots, 'create')).toBe('outside_devdigest');
  });

  it('lets a save touch any scanned root, and nothing else', () => {
    expect(writeZone('docs/a.md', roots, 'save')).toBeNull();
    expect(writeZone('.devdigest/a.md', roots, 'save')).toBeNull();
    expect(writeZone('handbook/a.md', roots, 'save')).toBe('outside_roots');
  });
});

describe('contentHash', () => {
  it('is a stable sha256 hex digest of the text', () => {
    expect(contentHash('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    expect(contentHash('a')).toBe(contentHash('a'));
    expect(contentHash('a')).not.toBe(contentHash('b'));
  });

  it('separates strings that differ only past the BMP', () => {
    // The comparison decides whether an edit survived a resync, so it has to be
    // over the bytes and not over a UTF-16 approximation of them.
    expect(contentHash('🙂')).not.toBe(contentHash('🙃'));
  });
});

describe('resolveContextSettings — .devdigest is a root of every repository', () => {
  const reader = (stored: Record<string, unknown>) =>
    ({
      settingsRepo: { value: async (_ws: string, key: string) => stored[key] },
    }) as unknown as Parameters<typeof resolveContextSettings>[0];

  it('appends it to a configured list', async () => {
    const { roots } = await resolveContextSettings(reader({ context_scan_roots: ['docs'] }), 'ws');
    expect(roots).toEqual(['docs', '.devdigest']);
  });

  it('appends it AFTER the defaults fire, so the three defaults survive', async () => {
    // The whole risk of this step. Appending before the `roots.length > 0`
    // branch makes the list non-empty for every workspace and silently deletes
    // `specs`, `docs` and `insights` — a page that quietly stops showing them.
    const { roots } = await resolveContextSettings(reader({}), 'ws');
    expect(roots).toEqual(['specs', 'docs', 'insights', '.devdigest']);
  });

  it('gives ONE root to a workspace that typed `.devdigest/` by hand', async () => {
    const { roots } = await resolveContextSettings(
      reader({ context_scan_roots: ['docs', '.devdigest/'] }),
      'ws',
    );
    expect(roots).toEqual(['docs', '.devdigest']);
    expect(roots.filter((r) => r === '.devdigest')).toHaveLength(1);
  });

  it('gives one root for `./.devdigest` too — de-duplication happens after normalising', async () => {
    const { roots } = await resolveContextSettings(
      reader({ context_scan_roots: ['./.devdigest', '.devdigest'] }),
      'ws',
    );
    expect(roots).toEqual(['.devdigest']);
  });
});
