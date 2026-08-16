/**
 * ContextScanExecutor — hermetic, over `MockGitClient`'s fake tree.
 *
 * The assertion that matters most is the failure path: a scan that throws must
 * leave the previous documents and `scannedAt` EXACTLY as they were and write
 * only the failure columns. That untouched-ness is the requirement, which is why
 * failure is a different set of columns rather than a status value.
 */
import { describe, it, expect } from 'vitest';
import { MockGitClient } from '../src/adapters/mocks.js';
import { ContextScanExecutor } from '../src/modules/context/scan-executor.js';
import { MAX_DOC_FILE_BYTES, MAX_SCAN_CANDIDATES } from '../src/modules/context/constants.js';
import type {
  ContextContainer,
  ContextRepo,
  ScannedDoc,
} from '../src/modules/context/types.js';

const WS = 'ws-1';
const REPO = 'repo-1';

interface Written {
  docs: ScannedDoc[];
  roots: string[];
  bounded: boolean;
}

function makeRepo(overrides: Partial<ContextRepo> = {}) {
  const written: { replace: Written[]; failures: { roots: string[]; message: string }[] } = {
    replace: [],
    failures: [],
  };
  const repo: ContextRepo = {
    repoById: async () => ({
      id: REPO,
      workspaceId: WS,
      owner: 'acme',
      name: 'api',
      clonePath: '/clones/acme/api',
      defaultBranch: 'main',
    }),
    scanFor: async () => undefined,
    docsFor: async () => [],
    docByPath: async () => undefined,
    scannedPaths: async () => [],
    agentAttachments: async () => [],
    agentAttachmentTotal: async () => 0,
    skillAttachments: async () => [],
    boundSkillDocs: async () => [],
    agentInWorkspace: async () => true,
    skillInWorkspace: async () => true,
    repoInWorkspace: async () => true,
    setAgentAttachments: async () => undefined,
    setSkillAttachments: async () => undefined,
    replaceDocs: async (_ws, _repoId, docs, scan) => {
      written.replace.push({ docs, roots: scan.roots, bounded: scan.bounded });
    },
    recordScanFailure: async (_repoId, roots, message) => {
      written.failures.push({ roots, message });
    },
    markScanning: async () => undefined,
    upsertDoc: async () => undefined,
    recordEdit: async () => undefined,
    ...overrides,
  };
  return { repo, written };
}

/**
 * `.devdigest` is appended to every root list (`AC-61`), so it is part of every
 * expectation about roots here. Spelling it out at each call site rather than
 * hiding it in a helper is deliberate: the invariant is what these assertions
 * are for, and a helper that added it silently would let a regression that
 * dropped it pass.
 */
const withDevdigest = (roots: string[]) => [...roots, '.devdigest'];

function makeContainer(git: MockGitClient, roots?: string[]): ContextContainer {
  return {
    git,
    tokenizer: { count: (text: string) => Math.ceil(text.length / 4) },
    jobs: { enqueue: async () => ({ id: 'j' }), register: () => undefined },
    settingsRepo: {
      value: async (_ws: string, key: string) =>
        key === 'context_scan_roots' ? roots : undefined,
    },
  } as unknown as ContextContainer;
}

describe('ContextScanExecutor — a successful scan', () => {
  it('persists one row per document with its root, kind and token count', async () => {
    const git = new MockGitClient({
      tree: {
        'docs/a.md': 'Alpha.',
        'specs/b.md': 'Beta.',
        'handbook/c.md': 'Gamma.',
        'src/ignored.ts': 'not markdown',
      },
    });
    const { repo, written } = makeRepo();
    await new ContextScanExecutor(
      makeContainer(git, ['docs', 'specs', 'handbook']),
      repo,
    ).run({ workspaceId: WS, repoId: REPO });

    expect(written.replace).toHaveLength(1);
    const { docs, bounded } = written.replace[0]!;
    expect(docs.map((d) => [d.path, d.root, d.kind])).toEqual([
      ['docs/a.md', 'docs', 'docs'],
      ['handbook/c.md', 'handbook', 'other'],
      ['specs/b.md', 'specs', 'specs'],
    ]);
    expect(bounded).toBe(false);
    // Counted over the RENDERED document, which is what the run assembles.
    expect(docs[0]!.tokens).toBe(Math.ceil('### docs/a.md\n\nAlpha.'.length / 4));
  });

  it('uses the spec defaults when the workspace configured no roots', async () => {
    const git = new MockGitClient({ tree: { 'insights/a.md': 'x', 'other/b.md': 'y' } });
    const { repo, written } = makeRepo();
    await new ContextScanExecutor(makeContainer(git), repo).run({
      workspaceId: WS,
      repoId: REPO,
    });
    expect(written.replace[0]!.roots).toEqual(withDevdigest(['specs', 'docs', 'insights']));
    expect(written.replace[0]!.docs.map((d) => d.path)).toEqual(['insights/a.md']);
  });

  /**
   * The root is compared as a STRING against every walked path, and the walk
   * resolves it through `path.join`, which normalises. A root written `docs/` or
   * `./docs` therefore used to walk the right directory and then match none of
   * the files it produced — a successful scan with zero documents and no error
   * anywhere. One canonical form, resolved once, is what closes it.
   */
  it('finds the same documents whether the root is written `docs`, `docs/` or `./docs`', async () => {
    const tree = { 'docs/a.md': 'Alpha.', 'docs/adr/b.md': 'Beta.' };
    const found = async (root: string) => {
      const { repo, written } = makeRepo();
      await new ContextScanExecutor(makeContainer(new MockGitClient({ tree }), [root]), repo).run({
        workspaceId: WS,
        repoId: REPO,
      });
      return written.replace[0]!;
    };

    const plain = await found('docs');
    expect(plain.docs.map((d) => [d.path, d.root])).toEqual([
      ['docs/a.md', 'docs'],
      ['docs/adr/b.md', 'docs'],
    ]);
    for (const spelling of ['docs/', './docs', 'docs//', '.\\docs']) {
      const result = await found(spelling);
      expect(result.docs.map((d) => [d.path, d.root, d.kind])).toEqual(
        plain.docs.map((d) => [d.path, d.root, d.kind]),
      );
      // The roots the scan RECORDS are canonical too — the page echoes them.
      expect(result.roots).toEqual(withDevdigest(['docs']));
    }
  });

  it('drops a root that normalises to nothing, or that climbs out of the clone', async () => {
    const git = new MockGitClient({ tree: { 'docs/a.md': 'Alpha.', 'specs/b.md': 'Beta.' } });
    const { repo, written } = makeRepo();
    await new ContextScanExecutor(makeContainer(git, ['.', '', '../../etc', 'docs']), repo).run({
      workspaceId: WS,
      repoId: REPO,
    });
    // `.` and `` would resolve to the clone directory itself and walk the whole
    // repository; `..` escapes it. Only the real root survives.
    expect(written.replace[0]!.roots).toEqual(withDevdigest(['docs']));
    expect(written.replace[0]!.docs.map((d) => d.path)).toEqual(['docs/a.md']);
  });

  it('collapses two spellings of one root instead of walking it twice', async () => {
    const git = new MockGitClient({ tree: { 'docs/a.md': 'Alpha.' } });
    const { repo, written } = makeRepo();
    await new ContextScanExecutor(makeContainer(git, ['docs', './docs/']), repo).run({
      workspaceId: WS,
      repoId: REPO,
    });
    expect(written.replace[0]!.roots).toEqual(withDevdigest(['docs']));
    expect(written.replace[0]!.docs.map((d) => d.path)).toEqual(['docs/a.md']);
  });

  it('finds `.MD` — the extension match is case-insensitive', async () => {
    const git = new MockGitClient({ tree: { 'docs/SHOUTING.MD': 'loud' } });
    const { repo, written } = makeRepo();
    await new ContextScanExecutor(makeContainer(git, ['docs']), repo).run({
      workspaceId: WS,
      repoId: REPO,
    });
    expect(written.replace[0]!.docs.map((d) => d.path)).toEqual(['docs/SHOUTING.MD']);
  });

  it('skips a file over MAX_DOC_FILE_BYTES', async () => {
    const git = new MockGitClient({
      tree: { 'docs/ok.md': 'small', 'docs/huge.md': 'x'.repeat(MAX_DOC_FILE_BYTES + 1) },
    });
    const { repo, written } = makeRepo();
    await new ContextScanExecutor(makeContainer(git, ['docs']), repo).run({
      workspaceId: WS,
      repoId: REPO,
    });
    expect(written.replace[0]!.docs.map((d) => d.path)).toEqual(['docs/ok.md']);
  });

  it('sets bounded when the candidate cap fires', async () => {
    const tree: Record<string, string> = {};
    for (let i = 0; i <= MAX_SCAN_CANDIDATES; i += 1) {
      tree[`docs/f${String(i).padStart(5, '0')}.md`] = 'x';
    }
    const git = new MockGitClient({ tree });
    const { repo, written } = makeRepo();
    await new ContextScanExecutor(makeContainer(git, ['docs']), repo).run({
      workspaceId: WS,
      repoId: REPO,
    });
    expect(written.replace[0]!.docs).toHaveLength(MAX_SCAN_CANDIDATES);
    expect(written.replace[0]!.bounded).toBe(true);
  });

  it('records an empty result for a repo with no clone, without an error', async () => {
    const { repo, written } = makeRepo({
      repoById: async () => ({
        id: REPO,
        workspaceId: WS,
        owner: 'acme',
        name: 'api',
        clonePath: null,
        defaultBranch: 'main',
      }),
    });
    await new ContextScanExecutor(makeContainer(new MockGitClient({}), ['docs']), repo).run({
      workspaceId: WS,
      repoId: REPO,
    });
    expect(written.replace[0]!.docs).toEqual([]);
    expect(written.failures).toEqual([]);
  });

  it('keeps scanning past one unreadable file', async () => {
    const git = new MockGitClient({
      tree: { 'docs/a.md': 'fine', 'docs/b.md': 'also fine' },
      refuse: { 'docs/a.md': 'outside_clone' },
    });
    const { repo, written } = makeRepo();
    await new ContextScanExecutor(makeContainer(git, ['docs']), repo).run({
      workspaceId: WS,
      repoId: REPO,
    });
    expect(written.replace[0]!.docs.map((d) => d.path)).toEqual(['docs/b.md']);
  });
});

describe('ContextScanExecutor — a failed scan', () => {
  it('writes ONLY the failure, touches no result, and rethrows so JobRunner retries', async () => {
    // `listFiles` throws for a clone directory that is not there.
    const git = new MockGitClient({ noClone: true });
    const { repo, written } = makeRepo();
    const executor = new ContextScanExecutor(makeContainer(git, ['docs']), repo);

    await expect(executor.run({ workspaceId: WS, repoId: REPO })).rejects.toThrow(/ENOENT/);

    // The previous documents and `scannedAt` are untouched: nothing called
    // replaceDocs, which is the only writer of either.
    expect(written.replace).toEqual([]);
    expect(written.failures).toHaveLength(1);
    expect(written.failures[0]!.message).toMatch(/ENOENT/);
    expect(written.failures[0]!.roots).toEqual(withDevdigest(['docs']));
  });

  it('rethrows even when recording the failure itself fails', async () => {
    const git = new MockGitClient({ noClone: true });
    const { repo } = makeRepo({
      recordScanFailure: async () => {
        throw new Error('the database is down too');
      },
    });
    // The ORIGINAL cause survives; a persistence error must not replace it.
    await expect(
      new ContextScanExecutor(makeContainer(git, ['docs']), repo).run({
        workspaceId: WS,
        repoId: REPO,
      }),
    ).rejects.toThrow(/ENOENT/);
  });

  it('fails a scan for a repo that is not in the workspace', async () => {
    const { repo, written } = makeRepo({ repoById: async () => undefined });
    await expect(
      new ContextScanExecutor(makeContainer(new MockGitClient({}), ['docs']), repo).run({
        workspaceId: WS,
        repoId: REPO,
      }),
    ).rejects.toThrow(/not in workspace/);
    expect(written.replace).toEqual([]);
  });
});
