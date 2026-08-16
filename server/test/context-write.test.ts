/**
 * 09 — the four authoring use cases, hermetic, over `MockGitClient` and a fake
 * repository.
 *
 * No database and no clone. What is pinned here is everything the service
 * decides BEFORE the port and everything it does with what the port returns:
 * which paths may be written at all, what a refusal turns into, and whether the
 * `SpecFile` that comes back is one the client can render a row from without
 * refetching. The filesystem half — symlinks, `.git/`, atomicity — is
 * `git-write-containment.test.ts`, against a real temp tree.
 */
import { describe, it, expect } from 'vitest';
import type { GitClient } from '@devdigest/shared';
import { MockGitClient } from '../src/adapters/mocks.js';
import { ContextService } from '../src/modules/context/service.js';
import { contentHash, renderDoc } from '../src/modules/context/helpers.js';
import { MAX_DOC_CHARS } from '../src/modules/context/constants.js';
import type {
  ContextContainer,
  ContextDocRecord,
  ContextRepo,
  ScannedDoc,
} from '../src/modules/context/types.js';

const WS = 'ws-1';
const REPO = 'repo-1';

interface FakeState {
  docs: Map<string, ScannedDoc>;
  edits: Map<string, { createdHere: boolean; contentHash: string }>;
  clonePath: string | null;
  fileCount: number;
}

/**
 * The two tables, modelled as two maps and joined the way `repository.ts` joins
 * them. Deriving `local` and `stale` here rather than storing them is what keeps
 * this fake honest: a fake that simply remembered `local: true` would pass every
 * assertion below without the join that produces it ever being right.
 */
function makeRepo(overrides: Partial<FakeState> = {}): { repo: ContextRepo; state: FakeState } {
  const state: FakeState = {
    docs: new Map(),
    edits: new Map(),
    clonePath: '/clones/acme/api',
    fileCount: 0,
    ...overrides,
  };

  const record = (doc: ScannedDoc): ContextDocRecord => {
    const edit = state.edits.get(doc.path);
    return {
      path: doc.path,
      root: doc.root,
      kind: doc.kind,
      sizeBytes: doc.sizeBytes,
      tokens: doc.tokens,
      modifiedAt: doc.modifiedAt,
      usedByAgents: 0,
      local: edit?.createdHere ?? false,
      stale: edit !== undefined && edit.contentHash !== doc.contentHash,
    };
  };

  const repo: ContextRepo = {
    repoById: async (workspaceId, repoId) =>
      workspaceId === WS && repoId === REPO
        ? {
            id: REPO,
            workspaceId: WS,
            owner: 'acme',
            name: 'api',
            clonePath: state.clonePath,
            defaultBranch: 'main',
          }
        : undefined,
    scanFor: async () => undefined,
    docsFor: async () => [...state.docs.values()].map(record),
    docByPath: async (_repoId, path) => {
      const doc = state.docs.get(path);
      return doc ? record(doc) : undefined;
    },
    scannedPaths: async () => [...state.docs.keys()],
    agentAttachments: async () => [],
    agentAttachmentTotal: async () => 0,
    skillAttachments: async () => [],
    boundSkillDocs: async () => [],
    agentInWorkspace: async () => true,
    skillInWorkspace: async () => true,
    repoInWorkspace: async () => true,
    setAgentAttachments: async () => undefined,
    setSkillAttachments: async () => undefined,
    replaceDocs: async () => undefined,
    recordScanFailure: async () => undefined,
    markScanning: async () => undefined,
    upsertDoc: async (_ws, _repoId, doc) => {
      state.docs.set(doc.path, doc);
      state.fileCount = state.docs.size;
    },
    recordEdit: async (_repoId, path, edit) => {
      const previous = state.edits.get(path);
      // Sticky, exactly as the real `ON CONFLICT` clause is: a save arrives with
      // `createdHere: false` and must not demote a document created here.
      state.edits.set(path, {
        createdHere: (previous?.createdHere ?? false) || edit.createdHere,
        contentHash: edit.contentHash,
      });
    },
  };
  return { repo, state };
}

function makeContainer(git: GitClient, settings: Record<string, unknown> = {}): ContextContainer {
  return {
    git,
    tokenizer: { count: (text: string) => text.length },
    jobs: { enqueue: async () => ({ id: 'job-1' }), register: () => undefined },
    settingsRepo: { value: async (_ws: string, key: string) => settings[key] },
  } as unknown as ContextContainer;
}

const scanned = (path: string, root: string): ScannedDoc => ({
  path,
  root,
  kind: 'docs',
  sizeBytes: 10,
  tokens: 5,
  modifiedAt: null,
  contentHash: contentHash('on disk'),
});

const bytes = (text: string) => new TextEncoder().encode(text);

describe('createDoc — the zone is `.devdigest/`, and nowhere else', () => {
  it('writes the file, returns a full SpecFile, and marks it local', async () => {
    const git = new MockGitClient({});
    const { repo, state } = makeRepo();
    const service = new ContextService(makeContainer(git), repo);

    const doc = await service.createDoc(WS, REPO, {
      path: '.devdigest/specs/public-api.md',
      content: '# Public API',
    });

    expect(doc.path).toBe('.devdigest/specs/public-api.md');
    expect(doc.root).toBe('.devdigest');
    // The row will read `specs/public-api.md` — the path relative to its group's
    // root — so the badge beside it says `specs`. `.devdigest` is a container,
    // not a family, and the folder below it is what names one.
    expect(doc.kind).toBe('specs');
    // The SAME counter over the SAME rendered string the run assembles.
    expect(doc.tokens).toBe(renderDoc('.devdigest/specs/public-api.md', '# Public API').length);
    expect(doc.size).toBe(Buffer.byteLength('# Public API', 'utf8'));
    expect(doc.used_by_agents).toBe(0);
    expect(doc.local).toBe(true);
    expect(doc.stale).toBe(false);
    // And it is an ordinary scan result from this moment: in the list, with no
    // rescan anywhere in between.
    expect((await repo.docsFor(REPO)).map((d) => d.path)).toEqual([
      '.devdigest/specs/public-api.md',
    ]);
    expect(state.fileCount).toBe(1);
  });

  it('refuses a path outside .devdigest/, even one under a configured root', async () => {
    const git = new MockGitClient({});
    const { repo } = makeRepo();
    const service = new ContextService(makeContainer(git, { context_scan_roots: ['docs'] }), repo);
    await expect(
      service.createDoc(WS, REPO, { path: 'docs/new.md', content: 'x' }),
    ).rejects.toMatchObject({ statusCode: 400, code: 'invalid_path' });
    // Nothing reached the clone. A refusal that writes first is not a refusal.
    expect(await repo.scannedPaths(REPO)).toEqual([]);
  });

  it('refuses `.devdigest` itself, a traversal, a non-.md name and a control character', async () => {
    const { repo } = makeRepo();
    const service = new ContextService(makeContainer(new MockGitClient({})), repo);
    for (const path of [
      '.devdigest',
      '.devdigest/../../etc/passwd.md',
      '../../etc/passwd.md',
      '.devdigest/notes.txt',
      '.devdigest/bad\u0000.md',
      '/etc/passwd.md',
      '.git/config.md',
    ]) {
      await expect(
        service.createDoc(WS, REPO, { path, content: 'x' }),
      ).rejects.toMatchObject({ statusCode: 400, code: 'invalid_path' });
    }
  });

  it('answers 409 already_exists and does not overwrite', async () => {
    const git = new MockGitClient({ tree: { '.devdigest/a.md': 'ORIGINAL' } });
    const { repo } = makeRepo();
    const service = new ContextService(makeContainer(git), repo);
    await expect(
      service.createDoc(WS, REPO, { path: '.devdigest/a.md', content: 'REPLACED' }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'already_exists' });
    await expect(git.readFile({ owner: 'acme', name: 'api' }, '.devdigest/a.md', 4096)).resolves.toBe(
      'ORIGINAL',
    );
  });

  it('refuses a body over the character cap before the port is called', async () => {
    const git = new MockGitClient({});
    const { repo } = makeRepo();
    const service = new ContextService(makeContainer(git), repo);
    await expect(
      service.createDoc(WS, REPO, { path: '.devdigest/big.md', content: 'x'.repeat(MAX_DOC_CHARS + 1) }),
    ).rejects.toMatchObject({ statusCode: 400, code: 'too_large' });
    expect(await repo.scannedPaths(REPO)).toEqual([]);
  });

  it('answers 409 clone_not_ready rather than a write error when there is no clone', async () => {
    const { repo } = makeRepo({ clonePath: null });
    const service = new ContextService(makeContainer(new MockGitClient({})), repo);
    await expect(
      service.createDoc(WS, REPO, { path: '.devdigest/a.md', content: 'x' }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'clone_not_ready' });
  });

  it('404s a repo from another workspace before anything is written', async () => {
    const git = new MockGitClient({});
    const { repo } = makeRepo();
    const service = new ContextService(makeContainer(git), repo);
    await expect(
      service.createDoc('ws-other', REPO, { path: '.devdigest/a.md', content: 'x' }),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(await repo.scannedPaths(REPO)).toEqual([]);
  });
});

describe('uploadDoc — the filename is a name, never a path', () => {
  it('strips a traversal filename to its basename and lands under .devdigest/', async () => {
    const git = new MockGitClient({});
    const { repo } = makeRepo();
    const service = new ContextService(makeContainer(git), repo);

    const doc = await service.uploadDoc(WS, REPO, {
      filename: '../../evil.md',
      bytes: bytes('# Uploaded'),
    });
    expect(doc.path).toBe('.devdigest/evil.md');
    expect(doc.local).toBe(true);
    // An upload lands directly under `.devdigest/`, so no folder names a family
    // and the badge is `other`. The service reaches the same derivation the scan
    // does, and passes it the path — not just the root.
    expect(doc.kind).toBe('other');
  });

  it('strips a backslash path too — a browser is not obliged to use "/"', async () => {
    const git = new MockGitClient({});
    const { repo } = makeRepo();
    const service = new ContextService(makeContainer(git), repo);
    const doc = await service.uploadDoc(WS, REPO, {
      filename: 'C:\\Users\\me\\notes.md',
      bytes: bytes('x'),
    });
    expect(doc.path).toBe('.devdigest/notes.md');
  });

  it('allows the extension case-insensitively — `.MD` is a file people commit', async () => {
    const git = new MockGitClient({});
    const { repo } = makeRepo();
    const service = new ContextService(makeContainer(git), repo);
    await expect(
      service.uploadDoc(WS, REPO, { filename: 'SHOUTING.MD', bytes: bytes('loud') }),
    ).resolves.toMatchObject({ path: '.devdigest/SHOUTING.MD' });
  });

  it('refuses a name that is not .md at all', async () => {
    const { repo } = makeRepo();
    const service = new ContextService(makeContainer(new MockGitClient({})), repo);
    for (const filename of ['payload.exe', 'notes', '..', 'archive.md.zip']) {
      await expect(
        service.uploadDoc(WS, REPO, { filename, bytes: bytes('x') }),
      ).rejects.toMatchObject({ statusCode: 400, code: 'invalid_path' });
    }
  });

  it('refuses a body carrying U+0000 — the one check a renamed binary cannot pass', async () => {
    const git = new MockGitClient({});
    const { repo } = makeRepo();
    const service = new ContextService(makeContainer(git), repo);
    await expect(
      service.uploadDoc(WS, REPO, {
        filename: 'trojan.md',
        bytes: new Uint8Array([0x4d, 0x5a, 0x00, 0x41]),
      }),
    ).rejects.toMatchObject({ statusCode: 400, code: 'binary_content' });
    expect(await repo.scannedPaths(REPO)).toEqual([]);
  });
});

describe('createFolder — says so, rather than returning an unchanged list', () => {
  it('creates the folder and answers with its path', async () => {
    const git = new MockGitClient({});
    const { repo } = makeRepo();
    const service = new ContextService(makeContainer(git), repo);
    await expect(service.createFolder(WS, REPO, { path: '.devdigest/specs' })).resolves.toEqual({
      path: '.devdigest/specs',
    });
    expect(git.dirs).toEqual(['.devdigest/specs']);
    // A folder holds no `.md`, so the document list cannot have changed.
    expect(await repo.scannedPaths(REPO)).toEqual([]);
  });

  it('refuses a folder outside .devdigest/, and one named like a document', async () => {
    const git = new MockGitClient({});
    const { repo } = makeRepo();
    const service = new ContextService(makeContainer(git, { context_scan_roots: ['docs'] }), repo);
    for (const path of ['docs/new', '.devdigest', '../escape', '.devdigest/notes.md']) {
      await expect(service.createFolder(WS, REPO, { path })).rejects.toMatchObject({
        statusCode: 400,
        code: 'invalid_path',
      });
    }
    expect(git.dirs).toEqual([]);
  });

  it('answers 409 clone_not_ready with no clone', async () => {
    const { repo } = makeRepo({ clonePath: null });
    const service = new ContextService(makeContainer(new MockGitClient({})), repo);
    await expect(
      service.createFolder(WS, REPO, { path: '.devdigest/specs' }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'clone_not_ready' });
  });
});

describe('saveDoc — any scanned root, but only a scanned document', () => {
  it('overwrites a tracked document and returns the new size and tokens', async () => {
    const git = new MockGitClient({ tree: { 'docs/style.md': 'OLD' } });
    const { repo, state } = makeRepo();
    state.docs.set('docs/style.md', scanned('docs/style.md', 'docs'));
    const service = new ContextService(makeContainer(git, { context_scan_roots: ['docs'] }), repo);

    const doc = await service.saveDoc(WS, REPO, { path: 'docs/style.md', content: '# New style' });

    expect(doc.tokens).toBe(renderDoc('docs/style.md', '# New style').length);
    expect(doc.size).toBe(Buffer.byteLength('# New style', 'utf8'));
    // A save is not a create: the document is the repository's, not ours.
    expect(doc.local).toBe(false);
    expect(doc.stale).toBe(false);
    await expect(git.readFile({ owner: 'acme', name: 'api' }, 'docs/style.md', 4096)).resolves.toBe(
      '# New style',
    );
  });

  it('keeps a document created here LOCAL across a later save', async () => {
    const git = new MockGitClient({});
    const { repo } = makeRepo();
    const service = new ContextService(makeContainer(git), repo);
    await service.createDoc(WS, REPO, { path: '.devdigest/a.md', content: 'first' });
    const saved = await service.saveDoc(WS, REPO, { path: '.devdigest/a.md', content: 'second' });
    expect(saved.local).toBe(true);
  });

  it('refuses a path under no configured root', async () => {
    const git = new MockGitClient({ tree: { 'handbook/x.md': 'OLD' } });
    const { repo, state } = makeRepo();
    state.docs.set('handbook/x.md', scanned('handbook/x.md', 'handbook'));
    const service = new ContextService(makeContainer(git, { context_scan_roots: ['docs'] }), repo);
    await expect(
      service.saveDoc(WS, REPO, { path: 'handbook/x.md', content: 'new' }),
    ).rejects.toMatchObject({ statusCode: 400, code: 'invalid_path' });
    await expect(git.readFile({ owner: 'acme', name: 'api' }, 'handbook/x.md', 4096)).resolves.toBe(
      'OLD',
    );
  });

  it('refuses a path inside a root that the scan has never produced', async () => {
    // Deny by default, the same rule the reading pane applies: a `.md` sitting
    // under `docs/` that no scan has listed is not a document anyone was looking
    // at when they pressed save.
    const git = new MockGitClient({ tree: { 'docs/unscanned.md': 'ON DISK' } });
    const { repo } = makeRepo();
    const service = new ContextService(makeContainer(git, { context_scan_roots: ['docs'] }), repo);
    await expect(
      service.saveDoc(WS, REPO, { path: 'docs/unscanned.md', content: 'new' }),
    ).rejects.toMatchObject({ statusCode: 404 });
    await expect(
      git.readFile({ owner: 'acme', name: 'api' }, 'docs/unscanned.md', 4096),
    ).resolves.toBe('ON DISK');
  });

  it('answers 409 clone_not_ready with no clone', async () => {
    const { repo, state } = makeRepo({ clonePath: null });
    state.docs.set('docs/style.md', scanned('docs/style.md', 'docs'));
    const service = new ContextService(makeContainer(new MockGitClient({})), repo);
    await expect(
      service.saveDoc(WS, REPO, { path: 'docs/style.md', content: 'x' }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'clone_not_ready' });
  });
});

describe('read → edit → save never deletes a tail the editor was not shown', () => {
  it('serves a long document whole, and refuses the save rather than writing a prefix', async () => {
    // The defect this pins: `docContent` cut the body at `MAX_DOC_CHARS`, the
    // editor seeded its draft from exactly that string, and the save wrote the
    // draft as the ENTIRE file. Under `.devdigest/` — untracked, no git copy —
    // the deleted tail was unrecoverable.
    const head = 'ORIGINAL HEAD';
    const tail = 'TAIL THE EDITOR MUST NOT DELETE';
    const onDisk = `${head}\n${'a'.repeat(MAX_DOC_CHARS)}\n${tail}`;
    const git = new MockGitClient({ tree: { '.devdigest/long.md': onDisk } });
    const { repo, state } = makeRepo();
    state.docs.set('.devdigest/long.md', scanned('.devdigest/long.md', '.devdigest'));
    const service = new ContextService(makeContainer(git), repo);

    // Read: the whole file reaches the editor, tail included.
    const read = await service.docContent(WS, REPO, '.devdigest/long.md');
    expect(read.content).toBe(onDisk);

    // Edit: the draft is what the editor holds, with one change made to it.
    const draft = read.content!.replace(head, 'EDITED HEAD');

    // Save: refused, because the whole document is past the write cap. The cap
    // is the same one `createDoc` enforces, and nothing reached the port.
    await expect(
      service.saveDoc(WS, REPO, { path: '.devdigest/long.md', content: draft }),
    ).rejects.toMatchObject({ statusCode: 400, code: 'too_large' });

    // The file is byte-for-byte what it was, tail and all.
    await expect(
      git.readFile({ owner: 'acme', name: 'api' }, '.devdigest/long.md', onDisk.length + 1024),
    ).resolves.toBe(onDisk);
  });
});

describe('a port refusal becomes the status the contract promises', () => {
  it('maps symlink, outside_clone and git_dir to 400 invalid_path', async () => {
    for (const reason of ['symlink', 'outside_clone', 'git_dir'] as const) {
      const git = new MockGitClient({ refuseWrite: { '.devdigest/a.md': reason } });
      const { repo } = makeRepo();
      const service = new ContextService(makeContainer(git), repo);
      await expect(
        service.createDoc(WS, REPO, { path: '.devdigest/a.md', content: 'x' }),
      ).rejects.toMatchObject({ statusCode: 400, code: 'invalid_path' });
    }
  });

  it('maps the adapter‘s own too_large to 400, and records nothing', async () => {
    const git = new MockGitClient({ refuseWrite: { '.devdigest/a.md': 'too_large' } });
    const { repo, state } = makeRepo();
    const service = new ContextService(makeContainer(git), repo);
    await expect(
      service.createDoc(WS, REPO, { path: '.devdigest/a.md', content: 'x' }),
    ).rejects.toMatchObject({ statusCode: 400, code: 'too_large' });
    expect(state.docs.size).toBe(0);
    expect(state.edits.size).toBe(0);
  });
});

describe('stale — the disk no longer holds what DevDigest saved', () => {
  it('is false right after a save, and true once the row is rewritten from other text', async () => {
    const git = new MockGitClient({ tree: { 'docs/style.md': 'OLD' } });
    const { repo, state } = makeRepo();
    state.docs.set('docs/style.md', scanned('docs/style.md', 'docs'));
    const service = new ContextService(makeContainer(git, { context_scan_roots: ['docs'] }), repo);

    expect((await service.saveDoc(WS, REPO, { path: 'docs/style.md', content: 'mine' })).stale).toBe(
      false,
    );

    // What a resync does: `git reset --hard` puts the branch's text back, and
    // the next scan writes a row hashed from THAT.
    state.docs.set('docs/style.md', {
      ...state.docs.get('docs/style.md')!,
      contentHash: contentHash('the branch version'),
    });
    const after = await repo.docByPath(REPO, 'docs/style.md');
    expect(after?.stale).toBe(true);
  });
});
