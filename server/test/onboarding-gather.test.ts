/**
 * onboarding · what the model is allowed to see.
 *
 * Hermetic: `MockGitClient` over a fake tree, a stub facade, and no model of any
 * kind — the container's `llm`, `prompts` and `tokenizer` throw here, because a
 * gather that reached one of them would be doing the next step's job.
 *
 * ONE thing is deliberately not asserted in this file: that nothing under
 * `node_modules/` or `vendor/` comes back. The mock does not model
 * `EXCLUDED_WALK_DIRS` — its tree is taken as given, and its own docstring
 * forbids adding a second exclusion list to a module to make a mock-backed test
 * pass. That claim is asserted against the real adapter, over a real temp clone,
 * in `test/git-list-files.test.ts` ("leaves out a manifest under an excluded
 * directory"). What IS asserted here is the half this module owns: the options
 * it hands the port, since a walk asked the wrong question excludes nothing no
 * matter how well the port behaves.
 */
import { describe, it, expect } from 'vitest';
import { MockGitClient, type MockGitOptions } from '../src/adapters/mocks.js';
import type { ClonedFile, GitClient, RepoRef } from '@devdigest/shared';
import { OnboardingGatherExecutor } from '../src/modules/onboarding/gather-executor.js';
import type {
  OnboardingGenerationContainer,
  OnboardingRepoRef,
} from '../src/modules/onboarding/generation-types.js';
import {
  MAX_DOC_FILE_BYTES,
  MAX_PACKAGES,
  MAX_SAMPLE_FILE_BYTES,
  MIN_FILE_CHARS,
  PACKAGE_MANIFEST,
  PACKAGE_SCAN_DEPTH,
  PACKAGE_SCAN_LIMIT,
  PATH_PROBE_BYTES,
  REPO_MAP_TOKEN_BUDGET,
  SAMPLE_FILE_COUNT,
} from '../src/modules/onboarding/constants.js';
import { EXCLUDED_WALK_DIRS } from '../src/adapters/git/constants.js';
import { DEFAULT_REPO_MAP_TOKEN_BUDGET } from '../src/modules/repo-intel/constants.js';

const REPO: OnboardingRepoRef = {
  id: 'repo-1',
  owner: 'acme',
  name: 'payments-api',
  fullName: 'acme/payments-api',
};

type ListOpts = Parameters<GitClient['listFiles']>[1];

/** The mock, plus a note of every question the module asked it. */
class RecordingGit extends MockGitClient {
  public listCalls: ListOpts[] = [];
  public reads: { path: string; maxBytes: number }[] = [];

  async listFiles(
    repo: RepoRef,
    opts: ListOpts,
  ): Promise<{ files: ClonedFile[]; bounded: boolean; excludedDirs: string[] }> {
    this.listCalls.push(opts);
    return super.listFiles(repo, opts);
  }

  async readFile(repo: RepoRef, path: string, maxBytes: number): Promise<string> {
    this.reads.push({ path, maxBytes });
    return super.readFile(repo, path, maxBytes);
  }
}

interface FacadeStub {
  repoMap?: { text: string; tokens: number; degraded?: boolean };
  chains?: string[][];
  ranked?: string[];
}

function makeContainer(git: GitClient, facade: FacadeStub = {}) {
  const asked = { mapBudget: [] as (number | undefined)[], rankedN: [] as number[] };
  const unreachable = (what: string) => (): never => {
    throw new Error(`the gather must not reach ${what}`);
  };
  const container: OnboardingGenerationContainer = {
    git,
    prompts: { render: unreachable('prompts') },
    tokenizer: { count: unreachable('the tokenizer'), id: 'cl100k_base' },
    llm: unreachable('the model'),
    settingsRepo: { value: unreachable('settings') },
    repoIntel: {
      getRepoMap: async (_id, budget) => {
        asked.mapBudget.push(budget);
        return facade.repoMap ?? { text: 'skeleton', tokens: 3 };
      },
      getCriticalPaths: async () => facade.chains ?? [],
      getTopFilesByRank: async (_id, n) => {
        asked.rankedN.push(n);
        return facade.ranked ?? [];
      },
    },
  };
  return { container, asked };
}

function gatherOver(tree: MockGitOptions['tree'], facade: FacadeStub = {}) {
  const git = new RecordingGit({ tree });
  const { container, asked } = makeContainer(git, facade);
  return { git, asked, run: () => new OnboardingGatherExecutor(container).gather(REPO) };
}

const BODY = 'export const x = 1;\n'.repeat(40); // comfortably over MIN_FILE_CHARS

describe('the package walk', () => {
  it('finds every manifest in a clone whose .json files are mostly fixtures', async () => {
    const { run } = gatherOver({
      'package.json': '{"name":"root"}',
      'tsconfig.json': '{}',
      'package-lock.json': '{"lockfileVersion":3}',
      'fixtures/a.json': '{}',
      'fixtures/b.json': '{}',
      'server/package.json': '{"name":"@acme/api"}',
      'server/tsconfig.json': '{}',
      'client/package.json': '{"name":"@acme/web"}',
    });
    const sources = await run();
    expect(sources.packages.map((p) => p.path)).toEqual(['.', 'client', 'server']);
    expect(sources.package_scan.found).toBe(3);
    expect(sources.package_scan.shown).toBe(3);
  });

  /**
   * The half of AC-93 this module owns. The exclusion itself is the port's and
   * is proven against the real adapter; what can go wrong HERE is asking the
   * wrong question — by extension instead of by name, or with a ceiling of
   * twelve, which slices alphabetically before this module can order anything.
   */
  it('asks the port by NAME, at the fixed depth, with room above the ceiling', async () => {
    const { git, run } = gatherOver({ 'package.json': '{"name":"root"}' });
    await run();

    expect(git.listCalls).toHaveLength(1);
    const opts = git.listCalls[0]!;
    expect(opts.names).toEqual([PACKAGE_MANIFEST]);
    expect(opts.extensions).toEqual([]);
    expect(opts.roots).toEqual(['.']);
    expect(opts.maxDepth).toBe(PACKAGE_SCAN_DEPTH);
    expect(opts.maxFiles).toBe(PACKAGE_SCAN_LIMIT);
    expect(opts.maxFileBytes).toBe(MAX_SAMPLE_FILE_BYTES);
    // AC-91 in one assertion: the walk is asked for more than can be shown, so
    // the twelve are chosen after the ordering rather than by an alphabetical
    // slice inside the port.
    expect(PACKAGE_SCAN_LIMIT).toBeGreaterThan(MAX_PACKAGES);
  });

  it('does not see a manifest deeper than the scan depth', async () => {
    const { run } = gatherOver({
      'package.json': '{"name":"root"}',
      'a/package.json': '{"name":"a"}',
      'a/b/package.json': '{"name":"b"}',
      'a/b/c/package.json': '{"name":"c"}',
    });
    const sources = await run();
    expect(sources.packages.map((p) => p.path)).toEqual(['.', 'a', 'a/b']);
    expect(sources.package_scan.depth).toBe(PACKAGE_SCAN_DEPTH);
  });

  /** AC-24 — the state slice C renders when a repository has no manifest at all. */
  it('yields no packages and found 0 for a repo with no manifest, without throwing', async () => {
    const { run } = gatherOver({ 'README.md': '# hi', 'main.py': 'print(1)' });
    const sources = await run();
    expect(sources.packages).toEqual([]);
    expect(sources.package_scan).toEqual({
      depth: PACKAGE_SCAN_DEPTH,
      excluded_dirs: [...EXCLUDED_WALK_DIRS],
      found: 0,
      shown: 0,
      bounded: false,
    });
  });

  /**
   * The shape the alphabetical slice was found on (fix round 1, finding 4).
   *
   * 65 manifests at depth 2 under `apps/` plus the root: one more than
   * `PACKAGE_SCAN_LIMIT`, and `apps/` sorts before `package.json`. Under a
   * path-only sort the port returns 64 files, NONE of them the root manifest,
   * and the first block a reader sees is `apps/a000` — which is AC-94 broken by
   * the port rather than by this module, and no ceiling here can repair it.
   * `next.js` reaches this shape for real with ~300 `examples/<name>/package.json`.
   */
  it('keeps the root manifest when a ceiling of manifests sorts before it', async () => {
    const tree: Record<string, string> = { 'package.json': '{"name":"root"}' };
    for (let i = 0; i < 65; i++) {
      tree[`apps/a${String(i).padStart(3, '0')}/package.json`] = `{"name":"a${i}"}`;
    }
    const sources = await gatherOver(tree).run();

    // The ceiling fired, and the entry it did NOT take is the root's.
    expect(sources.package_scan.bounded).toBe(true);
    expect(sources.package_scan.found).toBe(PACKAGE_SCAN_LIMIT);
    expect(sources.packages[0]!.path).toBe('.');
  });

  it('shows the ceiling and reports the walk was bounded when there are too many', async () => {
    const tree: Record<string, string> = { 'package.json': '{"name":"root"}' };
    for (let i = 0; i < 70; i++) {
      tree[`pkg-${String(i).padStart(2, '0')}/package.json`] = `{"name":"pkg-${i}"}`;
    }
    const sources = await gatherOver(tree).run();
    expect(sources.packages).toHaveLength(MAX_PACKAGES);
    expect(sources.package_scan.found).toBe(PACKAGE_SCAN_LIMIT);
    expect(sources.package_scan.bounded).toBe(true);
    // The root survives a full ceiling — AC-94, over the port's own cut.
    expect(sources.packages[0]!.path).toBe('.');
  });
});

describe('one package', () => {
  it('takes its manager from the lock file beside its own manifest', async () => {
    const { run } = gatherOver({
      'package.json': '{"name":"root"}',
      'server/package.json': '{"name":"@acme/api","scripts":{"dev":"tsx","test":"vitest"}}',
      'server/pnpm-lock.yaml': 'lockfileVersion: 9',
      'core/package.json': '{"name":"@acme/core"}',
      'core/package-lock.json': '{"lockfileVersion":3}',
    });
    const sources = await run();
    const byPath = Object.fromEntries(sources.packages.map((p) => [p.path, p]));
    expect(byPath.server!.manager).toBe('pnpm');
    expect(byPath.server!.scripts).toEqual(['dev', 'test']);
    expect(byPath.core!.manager).toBe('npm');
    // The root has no lock file of its own, and a manager is never inherited
    // from a package below it.
    expect(byPath['.']!.manager).toBeNull();
  });

  it('has no manager when two lock files sit beside one manifest', async () => {
    const { run } = gatherOver({
      'package.json': '{"name":"mixed"}',
      'pnpm-lock.yaml': 'lockfileVersion: 9',
      'package-lock.json': '{"lockfileVersion":3}',
    });
    const sources = await run();
    expect(sources.packages[0]!.manager).toBeNull();
    expect(sources.packages[0]!.lockfiles).toEqual(['pnpm-lock.yaml', 'package-lock.json']);
  });

  it('probes a lock file for one byte and reads a manifest at the bounded size', async () => {
    const { git, run } = gatherOver({
      'package.json': '{"name":"root"}',
      'pnpm-lock.yaml': 'lockfileVersion: 9\n'.repeat(1000),
    });
    await run();
    const probe = git.reads.find((r) => r.path === 'pnpm-lock.yaml');
    expect(probe?.maxBytes).toBe(PATH_PROBE_BYTES);
    expect(git.reads.find((r) => r.path === 'package.json')?.maxBytes).toBe(MAX_SAMPLE_FILE_BYTES);
  });

  it('falls back to the repository name for a nameless root and to the directory below it', async () => {
    const { run } = gatherOver({
      'package.json': '{"private":true}',
      'apps/web/package.json': '{}',
    });
    const sources = await run();
    expect(sources.packages.map((p) => p.name)).toEqual([REPO.name, 'web']);
  });

  it('gives a malformed manifest a block with no scripts rather than failing the gather', async () => {
    const { run } = gatherOver({ 'server/package.json': '{"name":"half"' });
    const sources = await run();
    expect(sources.packages).toHaveLength(1);
    expect(sources.packages[0]!.scripts).toEqual([]);
  });
});

describe('the other four inputs', () => {
  it('asks the facade for the skeleton at its own budget and for the ranked files', async () => {
    const { asked, run } = gatherOver(
      {},
      { repoMap: { text: 'tree...', tokens: 120 }, chains: [['a.ts', 'b.ts']] },
    );
    const sources = await run();
    expect(asked.mapBudget).toEqual([REPO_MAP_TOKEN_BUDGET]);
    expect(asked.rankedN).toEqual([SAMPLE_FILE_COUNT]);
    expect(sources.repoMap).toEqual({ text: 'tree...', tokens: 120 });
    expect(sources.chains).toEqual([['a.ts', 'b.ts']]);
  });

  it('samples the ranked files, skipping the ones too short to teach anything', async () => {
    const { run } = gatherOver(
      { 'src/big.ts': BODY, 'src/tiny.ts': 'export {};' },
      { ranked: ['src/big.ts', 'src/tiny.ts', 'src/gone.ts'] },
    );
    const sources = await run();
    expect(sources.samples.map((s) => s.path)).toEqual(['src/big.ts']);
    expect(sources.samples[0]!.text.length).toBeGreaterThanOrEqual(MIN_FILE_CHARS);
    // The ranked list itself is kept whole: it is the membership set the reading
    // path is grounded against, and existence is decided separately.
    expect(sources.ranked).toHaveLength(3);
  });

  it('reads config files beside every package AND at the root, with no root package', async () => {
    const { run } = gatherOver({
      'server/package.json': '{"name":"@acme/api"}',
      'server/.env.example': 'PORT=3001\nDATABASE_URL=postgres://…',
      '.env.example': 'ROOT_ONLY=1',
    });
    const sources = await run();
    expect(sources.envSources.map((e) => e.path).sort()).toEqual([
      '.env.example',
      'server/.env.example',
    ]);
    expect(sources.packages.map((p) => p.path)).toEqual(['server']);
  });

  it('reads the compose file Docker Compose itself would load, and only that one', async () => {
    const { run } = gatherOver({
      'compose.yaml': 'services:\n  postgres:\n    image: postgres:16\n',
      'docker-compose.yml': 'services:\n  shadowed:\n    image: nginx\n',
    });
    const sources = await run();
    expect(sources.composeSources).toHaveLength(1);
    expect(sources.composeSources[0]!.path).toBe('compose.yaml');
    // The RAW text, so grounding can ask whether a named service is declared.
    expect(sources.composeSources[0]!.text).toContain('postgres:');
    expect(JSON.stringify(sources.composeSources)).not.toContain('shadowed');
  });

  it('has no compose source when the clone has no compose file', async () => {
    const sources = await gatherOver({ 'package.json': '{}' }).run();
    expect(sources.composeSources).toEqual([]);
  });

  it('reads the project documents at the root and skips a blank one', async () => {
    const { run } = gatherOver({ 'README.md': '# payments-api', 'AGENTS.md': '   \n' });
    const sources = await run();
    expect(sources.docs.map((d) => d.path)).toEqual(['README.md']);
  });
});

describe('the documents beside the packages', () => {
  it('reads the README of every shown package, root documents first', async () => {
    const { run } = gatherOver({
      'README.md': '# monorepo',
      'AGENTS.md': '# house rules',
      'server/package.json': '{"name":"@acme/api"}',
      'server/README.md': '# api\n\nThe API map lives here.',
      'client/package.json': '{"name":"@acme/web"}',
      'client/README.md': '# web',
    });
    const sources = await run();

    // Root pair first: the walk offers these one at a time and stops at the
    // first that does not fit, so this order IS the priority.
    expect(sources.docs.map((d) => d.path)).toEqual([
      'README.md',
      'AGENTS.md',
      'client/README.md',
      'server/README.md',
    ]);
    expect(sources.docs.find((d) => d.path === 'server/README.md')?.text).toContain('API map');
  });

  it('offers no document for a package that has none, and never a hole in the list', async () => {
    const { run } = gatherOver({
      'README.md': '# monorepo',
      'server/package.json': '{}',
      'client/package.json': '{}',
      'client/README.md': '# web',
    });
    const sources = await run();
    expect(sources.docs.map((d) => d.path)).toEqual(['README.md', 'client/README.md']);
  });

  it('does not read a document beside a package the ceiling did not show', async () => {
    const tree: Record<string, string> = {};
    for (let i = 0; i < MAX_PACKAGES + 3; i += 1) {
      const dir = `packages/p${String(i).padStart(2, '0')}`;
      tree[`${dir}/package.json`] = '{}';
      tree[`${dir}/README.md`] = `# p${i}`;
    }
    const sources = await gatherOver(tree).run();

    expect(sources.packages).toHaveLength(MAX_PACKAGES);
    expect(sources.docs).toHaveLength(MAX_PACKAGES);
    // The three the ceiling cut contribute no document either: the model is
    // given material only about the packages it is shown.
    const shown = new Set(sources.packages.map((p) => `${p.path}/README.md`));
    for (const doc of sources.docs) expect(shown.has(doc.path)).toBe(true);
  });

  it('asks for the root README once when a root package.json also names it', async () => {
    const { git, run } = gatherOver({
      'package.json': '{"name":"root"}',
      'README.md': '# root',
    });
    const sources = await run();

    expect(sources.docs.map((d) => d.path)).toEqual(['README.md']);
    expect(git.reads.filter((r) => r.path === 'README.md')).toHaveLength(1);
  });

  it('bounds a document read at the DOCUMENT size, not at the sample size', async () => {
    const { git, run } = gatherOver({
      'README.md': '# root\n'.repeat(4000),
      'server/package.json': '{}',
      'server/README.md': '# api\n'.repeat(4000),
      'server/src/index.ts': BODY,
    });
    await run();

    // The bound is what makes the ceiling real: `readFile` fills a fixed buffer,
    // so a cap applied to the returned string has already paid for the file.
    for (const path of ['README.md', 'server/README.md']) {
      expect(git.reads.find((r) => r.path === path)?.maxBytes).toBe(MAX_DOC_FILE_BYTES);
    }
    expect(MAX_DOC_FILE_BYTES).toBeLessThan(MAX_SAMPLE_FILE_BYTES);
  });

  it('puts a package README into knownPaths, so a link to it costs no probe', async () => {
    const { run } = gatherOver({
      'server/package.json': '{}',
      'server/README.md': '# api',
    });
    const sources = await run();
    expect(sources.knownPaths.has('server/README.md')).toBe(true);
  });
});

describe('knownPaths', () => {
  it('holds what was read, and not what the index merely remembers', async () => {
    const { run } = gatherOver(
      {
        'package.json': '{"name":"root"}',
        'pnpm-lock.yaml': 'lockfileVersion: 9',
        'README.md': '# hi',
        'src/big.ts': BODY,
      },
      {
        ranked: ['src/big.ts', 'src/deleted.ts'],
        chains: [['src/deleted.ts', 'src/also-gone.ts']],
      },
    );
    const sources = await run();
    expect([...sources.knownPaths].sort()).toEqual([
      'README.md',
      'package.json',
      'pnpm-lock.yaml',
      'src/big.ts',
    ]);
    // A file the index still lists but the clone no longer has is exactly the
    // case this set exists to keep out: it is unproven until something probes it.
    expect(sources.knownPaths.has('src/deleted.ts')).toBe(false);
    expect(sources.knownPaths.has('src/also-gone.ts')).toBe(false);
  });

  it('keeps a file that exists but was too short to sample', async () => {
    const { run } = gatherOver({ 'src/tiny.ts': 'export {};' }, { ranked: ['src/tiny.ts'] });
    const sources = await run();
    expect(sources.samples).toEqual([]);
    expect(sources.knownPaths.has('src/tiny.ts')).toBe(true);
  });

  /**
   * A manifest the walk RETURNED but the ceiling did not SHOW is still proven to
   * exist: the port listed it off the disk one step ago, and nothing since has
   * made that less true. Dropping it is not a missing optimisation — grounding
   * spends one of `MAX_PATH_PROBES` re-asking a question already answered, and
   * once the budget is gone the same path is counted `unknown_path` and its link
   * dropped. That is the feature reporting "no such file" about a file it found
   * itself, which is the one failure the whole grounding discipline exists to
   * prevent.
   *
   * `git.reads` is asserted empty for that path deliberately: it is what makes
   * the walk, and not a read, the thing being tested.
   */
  it('holds the manifest of a package the ceiling did not show', async () => {
    const dirs = Array.from({ length: MAX_PACKAGES + 8 }, (_, i) =>
      `pkg-${String(i).padStart(2, '0')}`,
    );
    const tree: Record<string, string> = { 'package.json': '{"name":"root"}' };
    for (const dir of dirs) tree[`${dir}/package.json`] = `{"name":"${dir}"}`;
    // Sorts last, so it is past the ceiling however the twelve are chosen.
    const beyond = dirs.at(-1)!;

    const { git, run } = gatherOver(tree);
    const sources = await run();

    expect(sources.package_scan.found).toBe(dirs.length + 1);
    expect(sources.packages).toHaveLength(MAX_PACKAGES);
    expect(sources.packages.map((p) => p.path)).not.toContain(beyond);
    expect(git.reads.map((r) => r.path)).not.toContain(`${beyond}/${PACKAGE_MANIFEST}`);

    expect(sources.knownPaths.has(`${beyond}/${PACKAGE_MANIFEST}`)).toBe(true);
  });
});

describe('a clone that is not there', () => {
  it('lets the failure out rather than storing a tour of five empty sections', async () => {
    const git = new MockGitClient({ noClone: true });
    const { container } = makeContainer(git);
    await expect(new OnboardingGatherExecutor(container).gather(REPO)).rejects.toThrow(/ENOENT/);
  });
});

/**
 * The drift alarm for the one number this module must agree with another's.
 *
 * The test above asserts the budget the facade is ASKED for; this one asserts
 * that the number is the only one which can answer. `getRepoMap` is a cache read
 * keyed on the exact triple `(repoId, commitSha, tokenBudget)`
 * (`repo-intel/repository.ts`, `eq(t.repoMapCache.tokenBudget, tokenBudget)`),
 * and the pipeline writes exactly one row per commit, at
 * `DEFAULT_REPO_MAP_TOKEN_BUDGET`. So a budget of this module's own choosing
 * does not buy a bigger skeleton — it misses, and the highest-priority input
 * arrives empty on every generation of every repository.
 *
 * `no-cross-module` is what stops `constants.ts` importing that number instead
 * of restating it. A test is bound by no such rule (`pnpm arch` cruises `src`
 * only), so this is where the two can be held against each other — the same
 * move, for the same reason, as "excluded_dirs is an echo of the walk" in
 * `test/onboarding-packages.test.ts`.
 */
describe('the repo-map budget is the pipeline’s number, not a preference', () => {
  it('equals the budget the cached map was rendered at', () => {
    expect(REPO_MAP_TOKEN_BUDGET).toBe(DEFAULT_REPO_MAP_TOKEN_BUDGET);
  });
});
