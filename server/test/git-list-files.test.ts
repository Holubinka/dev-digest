/**
 * `SimpleGitClient.listFiles` — the two things the walk learned: `names` and `maxDepth`.
 *
 * No DB and no git binary: a clone-shaped temp tree on disk, walked by the real
 * adapter. The three questions asked here are the ones a package scan asks and
 * an extension filter cannot answer.
 *
 * 1. `package.json` is a NAME, not an extension. Asking for `.json` returns
 *    `tsconfig.json`, `package-lock.json` and every fixture the repository
 *    committed; the manifests are a handful among them.
 * 2. A manifest at any depth is a package, so the walk needs a floor — a repo
 *    decides how deep it nests, and `node_modules` is not the only directory
 *    that hides one.
 * 3. `maxFiles` counts MATCHES. Slice before the filter and twelve `.json` files
 *    that happen to sort first can contain no manifest at all, which is an empty
 *    "How to run" section on a repository with five packages. The last two cases
 *    in this file are that pair, asserted from both sides.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SimpleGitClient } from '../src/adapters/git/simple-git.js';
import { EXCLUDED_WALK_DIRS } from '../src/adapters/git/constants.js';
import { MockGitClient } from '../src/adapters/mocks.js';

const REPO = { owner: 'acme', name: 'payments-api' };
/** Roomy enough that no case here is bounded by size or count by accident. */
const OPTS = { maxFiles: 100, maxFileBytes: 1_000_000 };
const MANIFEST = { extensions: [] as string[], names: ['package.json'] };

let cloneDir: string;
let root: string;
let client: SimpleGitClient;

const paths = (r: { files: { path: string }[] }) => r.files.map((f) => f.path);

async function writeFileAt(relPath: string, content: string): Promise<void> {
  const full = join(root, relPath);
  await mkdir(join(full, '..'), { recursive: true });
  await writeFile(full, content);
}

beforeEach(async () => {
  // realpath because the macOS temp dir is itself a symlink (/var → /private/var).
  cloneDir = await realpath(await mkdtemp(join(tmpdir(), 'dd-clone-')));
  root = join(cloneDir, REPO.owner, REPO.name);
  await mkdir(root, { recursive: true });

  await writeFileAt('package.json', '{"name":"root"}');
  await writeFileAt('package-lock.json', '{"lockfileVersion":3}');
  await writeFileAt('tsconfig.json', '{"compilerOptions":{}}');
  await writeFileAt('README.md', 'the root readme');
  await writeFileAt('a/package.json', '{"name":"a"}');
  await writeFileAt('a/b/package.json', '{"name":"b"}');
  await writeFileAt('a/b/c/package.json', '{"name":"c"}');
  // Two manifests the exclusion list already owns. R36 is those lines continuing
  // to exist, so the assertion belongs here rather than a second list.
  await writeFileAt('node_modules/left-pad/package.json', '{"name":"left-pad"}');
  await writeFileAt('vendor/shared/package.json', '{"name":"vendored"}');
  // Its own directory on purpose: macOS is case-insensitive, so `Package.json`
  // cannot sit beside `package.json`.
  await writeFileAt('case/Package.json', '{"name":"shouting"}');

  client = new SimpleGitClient(cloneDir);
});

afterEach(async () => {
  await rm(cloneDir, { recursive: true, force: true });
});

describe('SimpleGitClient.listFiles — names', () => {
  it('returns the manifests and not tsconfig.json or package-lock.json', async () => {
    const out = await client.listFiles(REPO, { ...OPTS, ...MANIFEST, roots: ['.'] });
    expect(paths(out)).toEqual([
      'package.json',
      'a/package.json',
      'a/b/package.json',
      'a/b/c/package.json',
    ]);
  });

  it('matches a name exactly — `Package.json` is not `package.json` to npm', async () => {
    const out = await client.listFiles(REPO, { ...OPTS, ...MANIFEST, roots: ['.'] });
    expect(paths(out)).not.toContain('case/Package.json');
  });

  it('matches a name OR an extension', async () => {
    const out = await client.listFiles(REPO, {
      ...OPTS,
      extensions: ['.md'],
      names: ['package.json'],
      roots: ['.'],
    });
    expect(paths(out)).toContain('README.md');
    expect(paths(out)).toContain('package.json');
  });

  it('falls back to extensions only when names is absent', async () => {
    const out = await client.listFiles(REPO, { ...OPTS, extensions: ['.md'], roots: ['.'] });
    expect(paths(out)).toEqual(['README.md']);
  });

  it('leaves out a manifest under an excluded directory', async () => {
    const out = await client.listFiles(REPO, { ...OPTS, ...MANIFEST, roots: ['.'] });
    expect(paths(out)).not.toContain('node_modules/left-pad/package.json');
    expect(paths(out)).not.toContain('vendor/shared/package.json');
  });
});

describe('SimpleGitClient.listFiles — maxDepth', () => {
  it('descends a/b/ at a depth of 2 and stops before a/b/c/', async () => {
    const out = await client.listFiles(REPO, { ...OPTS, ...MANIFEST, roots: ['.'], maxDepth: 2 });
    expect(paths(out)).toEqual(['package.json', 'a/package.json', 'a/b/package.json']);
  });

  it('reads the root directory only at a depth of 0', async () => {
    const out = await client.listFiles(REPO, { ...OPTS, ...MANIFEST, roots: ['.'], maxDepth: 0 });
    expect(paths(out)).toEqual(['package.json']);
  });

  it('counts depth from each root, not from the clone', async () => {
    const out = await client.listFiles(REPO, { ...OPTS, ...MANIFEST, roots: ['a'], maxDepth: 1 });
    expect(paths(out)).toEqual(['a/package.json', 'a/b/package.json']);
  });

  it('has no limit when maxDepth is absent — what every caller before this had', async () => {
    const out = await client.listFiles(REPO, { ...OPTS, ...MANIFEST, roots: ['.'] });
    expect(paths(out)).toContain('a/b/c/package.json');
  });
});

/**
 * R34 — the ceiling counts found packages, not scanned files. Both directions of
 * the same fixture: 40 manifests buried under 20 `.json` files that sort ahead of
 * every one of them.
 */
describe('SimpleGitClient.listFiles — maxFiles counts matches', () => {
  beforeEach(async () => {
    for (let i = 0; i < 40; i++) {
      const n = String(i).padStart(2, '0');
      await writeFileAt(`many/pkg-${n}/package.json`, `{"name":"pkg-${n}"}`);
    }
    // `many/aaa-NN.json` sorts before `many/pkg-NN/package.json`, and there are
    // more than twelve of them.
    for (let i = 0; i < 20; i++) {
      await writeFileAt(`many/aaa-${String(i).padStart(2, '0')}.json`, '{}');
    }
  });

  it('returns 12 packages out of 40 and reports bounded', async () => {
    const out = await client.listFiles(REPO, {
      ...MANIFEST,
      roots: ['many'],
      maxFiles: 12,
      maxFileBytes: 1_000_000,
    });
    expect(out.files).toHaveLength(12);
    expect(paths(out).every((p) => p.endsWith('/package.json'))).toBe(true);
    expect(out.bounded).toBe(true);
  });

  /**
   * The control, and the reason the package scan asks by name. Same tree, same
   * ceiling, `extensions: ['.json']` instead: twelve files come back and not one
   * of them is a manifest.
   */
  it('by extension, the same ceiling returns twelve files and no manifest at all', async () => {
    const out = await client.listFiles(REPO, {
      extensions: ['.json'],
      roots: ['many'],
      maxFiles: 12,
      maxFileBytes: 1_000_000,
    });
    expect(out.files).toHaveLength(12);
    expect(paths(out).some((p) => p.endsWith('/package.json'))).toBe(false);
    expect(out.bounded).toBe(true);
  });
});

/**
 * The same questions, asked of the mock every other suite in this repository
 * walks a clone through. A mock that ignores `maxDepth` is how a depth bug
 * passes every unit test and fails on a real repository, so the two
 * implementations are pinned to the same answers here rather than each to its
 * own. What the mock does NOT model is `EXCLUDED_WALK_DIRS` — its tree is taken
 * as given, which is why the exclusion case above is asserted against the real
 * adapter only.
 */
describe('MockGitClient.listFiles — the same two options', () => {
  const git = new MockGitClient({
    tree: {
      'package.json': '{"name":"root"}',
      'tsconfig.json': '{}',
      'a/package.json': '{"name":"a"}',
      'a/b/package.json': '{"name":"b"}',
      'a/b/c/package.json': '{"name":"c"}',
      'a/notes.md': 'a note',
      'case/Package.json': '{"name":"shouting"}',
    },
  });
  const manifests = { ...OPTS, ...MANIFEST, roots: ['.'] };

  it('returns the manifests, and matches a name exactly', async () => {
    const out = await git.listFiles(REPO, manifests);
    expect(paths(out)).toEqual([
      'package.json',
      'a/package.json',
      'a/b/package.json',
      'a/b/c/package.json',
    ]);
  });

  it('descends a/b/ at a depth of 2 and stops before a/b/c/', async () => {
    const out = await git.listFiles(REPO, { ...manifests, maxDepth: 2 });
    expect(paths(out)).toEqual(['package.json', 'a/package.json', 'a/b/package.json']);
  });

  it('reads the root directory only at a depth of 0', async () => {
    const out = await git.listFiles(REPO, { ...manifests, maxDepth: 0 });
    expect(paths(out)).toEqual(['package.json']);
  });

  it('counts depth from each root, not from the clone', async () => {
    const out = await git.listFiles(REPO, { ...OPTS, ...MANIFEST, roots: ['a'], maxDepth: 1 });
    expect(paths(out)).toEqual(['a/package.json', 'a/b/package.json']);
  });

  it('falls back to extensions only when names is absent', async () => {
    const out = await git.listFiles(REPO, { ...OPTS, extensions: ['.md'], roots: ['.'] });
    expect(paths(out)).toEqual(['a/notes.md']);
  });

  it('applies maxFiles last, to matches', async () => {
    const out = await git.listFiles(REPO, { ...manifests, maxFiles: 2 });
    expect(paths(out)).toEqual(['package.json', 'a/package.json']);
    expect(out.bounded).toBe(true);
  });

  it('reports the excluded directories it does not itself apply', async () => {
    const out = await git.listFiles(REPO, manifests);
    expect(out.excludedDirs).toEqual([...EXCLUDED_WALK_DIRS]);
  });
});

/**
 * Finding 4 of fix round 1, as the fixture it was found on.
 *
 * 65 `apps/aNNN/package.json` plus the root, against a ceiling of 64. `apps/`
 * sorts before `package.json`, so a path-only sort returns 64 files with no root
 * manifest among them and the caller's first package block becomes `apps/a000`.
 * Raising the ceiling moves that cut and never removes it; ordering by depth
 * does. `next.js` is this fixture in the wild — ~300 `examples/<name>/package.json`.
 *
 * Both implementations answer, because a caller cannot test against one and ship
 * against the other.
 */
describe('listFiles orders by depth before path, so a ceiling keeps the root', () => {
  const CEILING = 64;
  const tree: Record<string, string> = { 'package.json': '{"name":"root"}' };
  for (let i = 0; i < 65; i++) {
    tree[`apps/a${String(i).padStart(3, '0')}/package.json`] = `{"name":"a${i}"}`;
  }

  it('SimpleGitClient keeps it', async () => {
    for (const [path, content] of Object.entries(tree)) await writeFileAt(path, content);
    const out = await client.listFiles(REPO, {
      ...MANIFEST,
      roots: ['.'],
      maxDepth: 2,
      maxFiles: CEILING,
      maxFileBytes: 1_000_000,
    });
    expect(out.files).toHaveLength(CEILING);
    expect(out.bounded).toBe(true);
    expect(paths(out)[0]).toBe('package.json');
  });

  it('MockGitClient keeps it too', async () => {
    const git = new MockGitClient({ tree });
    const out = await git.listFiles(REPO, {
      ...MANIFEST,
      roots: ['.'],
      maxDepth: 2,
      maxFiles: CEILING,
      maxFileBytes: 1_000_000,
    });
    expect(out.files).toHaveLength(CEILING);
    expect(out.bounded).toBe(true);
    expect(paths(out)[0]).toBe('package.json');
  });
});
