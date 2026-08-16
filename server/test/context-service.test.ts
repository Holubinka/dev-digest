/**
 * ContextService — hermetic. The repository seam is an INTERFACE, so the fake
 * below is an object literal with no cast; that is the whole reason this file
 * can exist (server/INSIGHTS.md, "a repository seam typed as the class cannot be
 * faked without a lying cast").
 *
 * No database, no clone, and — asserted explicitly — no LLM.
 */
import { describe, it, expect, vi } from 'vitest';
import { CloneReadError, type GitClient } from '@devdigest/shared';
import { MockGitClient } from '../src/adapters/mocks.js';
import { ContextService } from '../src/modules/context/service.js';
import { MAX_DOC_CHARS, MAX_DOC_FILE_BYTES } from '../src/modules/context/constants.js';
import type {
  BoundSkillDocs,
  ContextAttachment,
  ContextContainer,
  ContextDocRecord,
  ContextRepo,
} from '../src/modules/context/types.js';

const WS = 'ws-1';
const REPO = 'repo-1';
const AGENT = 'agent-1';
const SKILL = 'skill-1';

const scannedDoc = (path: string, tokens = 10): ContextDocRecord => ({
  path,
  root: path.split('/')[0]!,
  kind: 'docs',
  sizeBytes: 100,
  tokens,
  modifiedAt: null,
  usedByAgents: 0,
  local: false,
  stale: false,
});

interface FakeState {
  agentPaths: ContextAttachment[];
  agentTotal: number;
  skillPaths: ContextAttachment[];
  bound: BoundSkillDocs[];
  docs: ContextDocRecord[];
  clonePath: string | null;
  agentInWs: boolean;
  skillInWs: boolean;
  repoInWs: boolean;
  writes: { agent: string[][]; skill: string[][] };
  edits: { path: string; createdHere: boolean; contentHash: string }[];
}

function makeRepo(overrides: Partial<FakeState> = {}): { repo: ContextRepo; state: FakeState } {
  const state: FakeState = {
    agentPaths: [],
    agentTotal: 0,
    skillPaths: [],
    bound: [],
    docs: [],
    clonePath: '/clones/acme/api',
    agentInWs: true,
    skillInWs: true,
    repoInWs: true,
    writes: { agent: [], skill: [] },
    edits: [],
    ...overrides,
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
    scanFor: async () => ({
      roots: ['docs'],
      fileCount: state.docs.length,
      bounded: false,
      scannedAt: new Date('2026-08-13T00:00:00Z'),
      scanningAt: null,
      lastError: null,
      lastErrorAt: null,
    }),
    docsFor: async () => state.docs,
    docByPath: async (_repoId, path) => state.docs.find((d) => d.path === path),
    scannedPaths: async () => state.docs.map((d) => d.path),
    agentAttachments: async () => state.agentPaths,
    agentAttachmentTotal: async () => state.agentTotal,
    skillAttachments: async () => state.skillPaths,
    boundSkillDocs: async () => state.bound,
    agentInWorkspace: async () => state.agentInWs,
    skillInWorkspace: async () => state.skillInWs,
    repoInWorkspace: async () => state.repoInWs,
    setAgentAttachments: async (_agentId, _repoId, paths) => {
      state.writes.agent.push(paths);
      state.agentPaths = paths.map((path, position) => ({ path, position }));
    },
    setSkillAttachments: async (_skillId, _repoId, paths) => {
      state.writes.skill.push(paths);
      state.skillPaths = paths.map((path, position) => ({ path, position }));
    },
    replaceDocs: async () => undefined,
    recordScanFailure: async () => undefined,
    markScanning: async () => undefined,
    upsertDoc: async (_ws, _repoId, doc) => {
      state.docs = [
        ...state.docs.filter((d) => d.path !== doc.path),
        {
          path: doc.path,
          root: doc.root,
          kind: doc.kind,
          sizeBytes: doc.sizeBytes,
          tokens: doc.tokens,
          modifiedAt: doc.modifiedAt,
          usedByAgents: 0,
          local: state.edits.some((e) => e.path === doc.path && e.createdHere),
          stale: false,
        },
      ].sort((a, b) => (a.path < b.path ? -1 : 1));
    },
    recordEdit: async (_repoId, path, edit) => {
      state.edits.push({ path, ...edit });
      // `created_here` is sticky in the real repository, and the fake has to say
      // so too: a save that demoted a locally created document here would make
      // the `local` assertions pass for the wrong reason.
      state.docs = state.docs.map((d) =>
        d.path === path ? { ...d, local: d.local || edit.createdHere } : d,
      );
    },
  };
  return { repo, state };
}

const llm = vi.fn();

function makeContainer(git: GitClient, settings: Record<string, unknown> = {}): ContextContainer {
  return {
    git,
    tokenizer: { count: (text: string) => text.length },
    jobs: { enqueue: async () => ({ id: 'job-1' }), register: () => undefined },
    settingsRepo: { value: async (_ws: string, key: string) => settings[key] },
    // Not part of the port — present only so a stray provider call would be
    // visible rather than silently unreachable.
    llm,
  } as unknown as ContextContainer;
}

describe('resolveForRun — the six statuses map from what the port did', () => {
  const set = [
    { path: 'docs/ok.md', position: 0 },
    { path: 'docs/gone.md', position: 1 },
    { path: 'docs/outside.md', position: 2 },
    { path: 'docs/git.md', position: 3 },
    { path: 'docs/binary.md', position: 4 },
  ];

  it('maps not_found → missing, outside_clone/git_dir → refused, and a NUL body → binary', async () => {
    const git = new MockGitClient({
      tree: {
        'docs/ok.md': 'Fine.',
        'docs/binary.md': 'text\u0000more',
      },
      refuse: { 'docs/outside.md': 'outside_clone', 'docs/git.md': 'git_dir' },
    });
    const { repo } = makeRepo({
      agentPaths: set,
      agentTotal: set.length,
      // Every candidate IS a scanned document here, so each status below comes
      // from what the port did with the file rather than from the gate.
      docs: set.map((s) => scannedDoc(s.path)),
    });
    const service = new ContextService(makeContainer(git), repo);

    const result = await service.resolveForRun({
      workspaceId: WS,
      agentId: AGENT,
      repoId: REPO,
      repo: { owner: 'acme', name: 'api' },
    });

    expect(result.docs.map((d) => [d.path, d.status])).toEqual([
      ['docs/ok.md', 'included'],
      ['docs/gone.md', 'missing'],
      ['docs/outside.md', 'refused'],
      ['docs/git.md', 'refused'],
      ['docs/binary.md', 'binary'],
    ]);
    // The run continues: the readable document still went.
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0]).toContain('### docs/ok.md');
    expect(result.includedPaths).toEqual(['docs/ok.md']);
    expect(llm).not.toHaveBeenCalled();
  });
});

describe('resolveForRun — deny by default', () => {
  it('never reads an attachment the scan no longer holds, even when the clone still does', async () => {
    // The file IS on disk. It is not a scanned document — an admin narrowed the
    // roots away from it — and the run path must refuse it exactly as the
    // reading pane does, or the page would call it gone while every review kept
    // sending it to the model.
    const git = new MockGitClient({
      tree: { 'docs/kept.md': 'KEPT', 'docs/unscanned.md': 'STILL ON DISK' },
    });
    const readFile = vi.spyOn(git, 'readFile');
    const { repo } = makeRepo({
      agentPaths: [
        { path: 'docs/unscanned.md', position: 0 },
        { path: 'docs/kept.md', position: 1 },
      ],
      agentTotal: 2,
      docs: [scannedDoc('docs/kept.md')],
    });
    const service = new ContextService(makeContainer(git), repo);

    const result = await service.resolveForRun({
      workspaceId: WS,
      agentId: AGENT,
      repoId: REPO,
      repo: { owner: 'acme', name: 'api' },
    });

    // The row STAYS, reported `missing` — the spec's edge case forbids dropping
    // it — and its text never left the disk.
    expect(result.docs.map((d) => [d.path, d.status])).toEqual([
      ['docs/unscanned.md', 'missing'],
      ['docs/kept.md', 'included'],
    ]);
    expect(result.blocks.join('')).not.toContain('STILL ON DISK');
    expect(readFile.mock.calls.map((c) => c[1])).toEqual(['docs/kept.md']);
    readFile.mockRestore();
  });

  it('a set attached before the repo was ever scanned reads nothing', async () => {
    const git = new MockGitClient({ tree: { 'docs/a.md': 'ON DISK' } });
    const { repo } = makeRepo({
      agentPaths: [{ path: 'docs/a.md', position: 0 }],
      agentTotal: 1,
      docs: [],
    });
    const service = new ContextService(makeContainer(git), repo);
    const result = await service.resolveForRun({
      workspaceId: WS,
      agentId: AGENT,
      repoId: REPO,
      repo: { owner: 'acme', name: 'api' },
    });
    expect(result.docs).toEqual([{ path: 'docs/a.md', tokens: 0, status: 'missing' }]);
    expect(result.blocks).toEqual([]);
  });
});

describe('resolveForRun — the ways out', () => {
  it('nothing attached anywhere → an empty result with NO note', async () => {
    const { repo } = makeRepo();
    const service = new ContextService(makeContainer(new MockGitClient({})), repo);
    const result = await service.resolveForRun({
      workspaceId: WS,
      agentId: AGENT,
      repoId: REPO,
      repo: { owner: 'acme', name: 'api' },
    });
    expect(result).toEqual({ blocks: [], docs: [], includedPaths: [], note: undefined });
  });

  it('attached, but to ANOTHER repository → empty, a note naming this repo, and no substitution', async () => {
    // The clone of the repo under review holds a same-named file. It must not
    // be picked up: the attachment is bound to a different repository.
    const git = new MockGitClient({ tree: { 'docs/a.md': 'WRONG REPO CONTENT' } });
    const { repo } = makeRepo({ agentPaths: [], agentTotal: 3 });
    const service = new ContextService(makeContainer(git), repo);

    const result = await service.resolveForRun({
      workspaceId: WS,
      agentId: AGENT,
      repoId: REPO,
      repo: { owner: 'acme', name: 'api' },
    });
    expect(result.blocks).toEqual([]);
    expect(result.docs).toEqual([]);
    expect(result.note).toContain('acme/api');
    expect(result.note).toContain('3');
  });

  it('a thrown port yields an empty result and a note, never a throw', async () => {
    const { repo } = makeRepo({ agentPaths: [{ path: 'docs/a.md', position: 0 }] });
    const exploding: ContextRepo = {
      ...repo,
      agentAttachments: async () => {
        throw new Error('database is on fire');
      },
    };
    const service = new ContextService(makeContainer(new MockGitClient({})), exploding);
    const result = await service.resolveForRun({
      workspaceId: WS,
      agentId: AGENT,
      repoId: REPO,
      repo: { owner: 'acme', name: 'api' },
    });
    expect(result.blocks).toEqual([]);
    expect(result.note).toContain('database is on fire');
  });

  it('every path is free of an LLM call', async () => {
    expect(llm).not.toHaveBeenCalled();
  });
});

describe('resolveForRun — order, dedupe and the budget', () => {
  it('takes own documents first, then skills, deduped, and reports one entry per document', async () => {
    const git = new MockGitClient({
      tree: {
        'docs/own.md': 'OWN',
        'docs/shared.md': 'SHARED',
        'docs/skill.md': 'SKILL',
      },
    });
    const { repo } = makeRepo({
      agentPaths: [
        { path: 'docs/own.md', position: 0 },
        { path: 'docs/shared.md', position: 1 },
      ],
      agentTotal: 2,
      docs: [scannedDoc('docs/own.md'), scannedDoc('docs/shared.md'), scannedDoc('docs/skill.md')],
      bound: [
        {
          skillId: SKILL,
          skillName: 'House rules',
          order: 0,
          paths: [
            { path: 'docs/shared.md', position: 0 },
            { path: 'docs/skill.md', position: 1 },
          ],
        },
      ],
    });
    const service = new ContextService(makeContainer(git), repo);
    const result = await service.resolveForRun({
      workspaceId: WS,
      agentId: AGENT,
      repoId: REPO,
      repo: { owner: 'acme', name: 'api' },
    });
    expect(result.includedPaths).toEqual(['docs/own.md', 'docs/shared.md', 'docs/skill.md']);
    expect(result.docs).toHaveLength(3);
  });

  it('honours the workspace budget setting', async () => {
    const git = new MockGitClient({
      tree: { 'docs/a.md': 'x'.repeat(100), 'docs/b.md': 'y'.repeat(100) },
    });
    const { repo } = makeRepo({
      agentPaths: [
        { path: 'docs/a.md', position: 0 },
        { path: 'docs/b.md', position: 1 },
      ],
      agentTotal: 2,
      docs: [scannedDoc('docs/a.md'), scannedDoc('docs/b.md')],
    });
    // The counter is `text.length`, so a 150-token budget fits the first
    // rendered document ('### docs/a.md\n\n' + 100 chars) and not the second.
    const service = new ContextService(
      makeContainer(git, { context_token_budget: 150 }),
      repo,
    );
    const result = await service.resolveForRun({
      workspaceId: WS,
      agentId: AGENT,
      repoId: REPO,
      repo: { owner: 'acme', name: 'api' },
    });
    expect(result.docs.map((d) => d.status)).toEqual(['included', 'dropped']);
  });
});

describe('setAgentDocs / setSkillDocs — the input gate', () => {
  it('rejects the WHOLE request on the first bad path and writes nothing', async () => {
    const { repo, state } = makeRepo();
    const service = new ContextService(makeContainer(new MockGitClient({})), repo);
    await expect(
      service.setAgentDocs(WS, AGENT, {
        repo_id: REPO,
        paths: ['docs/fine.md', '../../etc/passwd'],
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(state.writes.agent).toEqual([]);
    expect(state.agentPaths).toEqual([]);
  });

  it('saves a repeated path once, at its first position', async () => {
    const { repo, state } = makeRepo();
    const service = new ContextService(makeContainer(new MockGitClient({})), repo);
    await service.setAgentDocs(WS, AGENT, {
      repo_id: REPO,
      paths: ['docs/b.md', 'docs/a.md', 'docs/b.md'],
    });
    expect(state.writes.agent).toEqual([['docs/b.md', 'docs/a.md']]);
  });

  it('refuses an agent from another workspace before any write', async () => {
    const { repo, state } = makeRepo({ agentInWs: false });
    const service = new ContextService(makeContainer(new MockGitClient({})), repo);
    await expect(
      service.setAgentDocs(WS, AGENT, { repo_id: REPO, paths: ['docs/a.md'] }),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(state.writes.agent).toEqual([]);
  });

  it('refuses a repo from another workspace before any write', async () => {
    const { repo, state } = makeRepo({ repoInWs: false });
    const service = new ContextService(makeContainer(new MockGitClient({})), repo);
    await expect(
      service.setSkillDocs(WS, SKILL, { repo_id: REPO, paths: ['docs/a.md'] }),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(state.writes.skill).toEqual([]);
  });

  it('refuses a skill from another workspace before any write', async () => {
    const { repo, state } = makeRepo({ skillInWs: false });
    const service = new ContextService(makeContainer(new MockGitClient({})), repo);
    await expect(
      service.setSkillDocs(WS, SKILL, { repo_id: REPO, paths: ['docs/a.md'] }),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(state.writes.skill).toEqual([]);
  });
});

describe('agentDocs — the inherited group', () => {
  it('marks a document the agent also attaches, and counts it once', async () => {
    const { repo } = makeRepo({
      agentPaths: [{ path: 'docs/shared.md', position: 0 }],
      docs: [scannedDoc('docs/shared.md', 40), scannedDoc('docs/skill.md', 25)],
      bound: [
        {
          skillId: SKILL,
          skillName: 'House rules',
          order: 0,
          paths: [
            { path: 'docs/shared.md', position: 0 },
            { path: 'docs/skill.md', position: 1 },
          ],
        },
      ],
    });
    const service = new ContextService(makeContainer(new MockGitClient({})), repo);
    const out = await service.agentDocs(WS, AGENT, REPO);

    expect(out.attached).toEqual([
      { path: 'docs/shared.md', position: 0, tokens: 40, missing: false },
    ]);
    expect(out.inherited.map((d) => [d.path, d.also_attached, d.skill_name])).toEqual([
      ['docs/shared.md', true, 'House rules'],
      ['docs/skill.md', false, 'House rules'],
    ]);
  });

  it('reports a saved path the current scan does not hold as missing, with no token count', async () => {
    const { repo } = makeRepo({
      agentPaths: [{ path: 'docs/vanished.md', position: 0 }],
      docs: [],
    });
    const service = new ContextService(makeContainer(new MockGitClient({})), repo);
    const out = await service.agentDocs(WS, AGENT, REPO);
    // The row STAYS. Cleaning it up is the opposite of what the edge case asks.
    expect(out.attached).toEqual([
      { path: 'docs/vanished.md', position: 0, tokens: null, missing: true },
    ]);
  });
});

describe('docContent — deny by default', () => {
  it('refuses a path with no scanned row, even when the clone holds the file', async () => {
    const git = new MockGitClient({ tree: { 'secret/notes.md': 'not a scanned document' } });
    const { repo } = makeRepo({ docs: [scannedDoc('docs/a.md')] });
    const service = new ContextService(makeContainer(git), repo);
    await expect(service.docContent(WS, REPO, 'secret/notes.md')).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('refuses a path that is not repo-relative markdown with 400', async () => {
    const { repo } = makeRepo();
    const service = new ContextService(makeContainer(new MockGitClient({})), repo);
    await expect(service.docContent(WS, REPO, '../../etc/passwd')).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it('serves a scanned document', async () => {
    const git = new MockGitClient({ tree: { 'docs/a.md': '# Title' } });
    const { repo } = makeRepo({ docs: [scannedDoc('docs/a.md')] });
    const service = new ContextService(makeContainer(git), repo);
    const doc = await service.docContent(WS, REPO, 'docs/a.md');
    expect(doc.content).toBe('# Title');
    expect(doc.path).toBe('docs/a.md');
  });

  it('serves a document past the editor cap WHOLE — the reading pane never truncates', async () => {
    // This repository carries a 74 636-code-point document. Served short, its
    // tail is what the next save deletes, so the reader hands over all of it or
    // none of it. The scan and the run still truncate; this path does not.
    const body = `${'a'.repeat(MAX_DOC_CHARS)}TAIL`;
    const git = new MockGitClient({ tree: { 'docs/long.md': body } });
    const { repo } = makeRepo({ docs: [scannedDoc('docs/long.md')] });
    const service = new ContextService(makeContainer(git), repo);

    const doc = await service.docContent(WS, REPO, 'docs/long.md');
    expect([...(doc.content ?? '')].length).toBe(MAX_DOC_CHARS + 4);
    expect(doc.content).toBe(body);
  });

  it('refuses a file larger than a document may be rather than serving its prefix', async () => {
    // The only body the read can still cut is one that grew past the size at
    // which the scan stops calling a file a document. `doc_refused` is the
    // reader's own word for "DevDigest would not read this file", and the
    // editor is never offered for a document that has no content.
    const git = new MockGitClient({ tree: { 'docs/huge.md': 'x'.repeat(MAX_DOC_FILE_BYTES + 1) } });
    const { repo } = makeRepo({ docs: [scannedDoc('docs/huge.md')] });
    const service = new ContextService(makeContainer(git), repo);
    await expect(service.docContent(WS, REPO, 'docs/huge.md')).rejects.toMatchObject({
      statusCode: 403,
      code: 'doc_refused',
    });
  });

  it('serves a file of exactly the document size cap — the refusal is off by no bytes', async () => {
    const git = new MockGitClient({ tree: { 'docs/edge.md': 'x'.repeat(MAX_DOC_FILE_BYTES) } });
    const { repo } = makeRepo({ docs: [scannedDoc('docs/edge.md')] });
    const service = new ContextService(makeContainer(git), repo);
    const doc = await service.docContent(WS, REPO, 'docs/edge.md');
    expect(doc.content?.length).toBe(MAX_DOC_FILE_BYTES);
  });
});

describe('docsPage — the four states', () => {
  it('reports no_clone with an empty list rather than pretending the repo has no documents', async () => {
    const { repo } = makeRepo({ clonePath: null });
    const service = new ContextService(makeContainer(new MockGitClient({})), repo);
    const page = await service.docsPage(WS, REPO);
    expect(page.state).toBe('no_clone');
    expect(page.documents).toEqual([]);
  });

  it('404s a repo from another workspace', async () => {
    const { repo } = makeRepo();
    const service = new ContextService(makeContainer(new MockGitClient({})), repo);
    await expect(service.docsPage('ws-other', REPO)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('reports the workspace defaults when neither setting was ever written', async () => {
    const { repo } = makeRepo({ docs: [scannedDoc('docs/a.md')] });
    const service = new ContextService(makeContainer(new MockGitClient({})), repo);
    const page = await service.docsPage(WS, REPO);
    // `.devdigest` is appended to every list, configured or defaulted (`AC-61`),
    // and it is appended AFTER the fallback fires — a `.devdigest` added before
    // that branch would make the list non-empty and delete the three defaults.
    expect(page.roots).toEqual(['specs', 'docs', 'insights', '.devdigest']);
    expect(page.budget_tokens).toBe(16000);
    expect(page.state).toBe('scanned');
  });

  it('enqueues the FIRST scan lazily, on the first read, and says scanning', async () => {
    const { repo } = makeRepo();
    const enqueue = vi.fn(async () => ({ id: 'job-1' }));
    const container = makeContainer(new MockGitClient({}));
    const service = new ContextService(
      { ...container, jobs: { enqueue, register: () => undefined } },
      { ...repo, scanFor: async () => undefined },
    );
    const page = await service.docsPage(WS, REPO);
    expect(page.state).toBe('scanning');
    expect(page.documents).toEqual([]);
    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  it('reports failed only when the failure is NEWER than the last success, and carries both', async () => {
    const { repo } = makeRepo({ docs: [scannedDoc('docs/a.md')] });
    const withFailure: ContextRepo = {
      ...repo,
      scanFor: async () => ({
        roots: ['docs'],
        fileCount: 7,
        bounded: false,
        scannedAt: new Date('2026-08-12T00:00:00Z'),
        scanningAt: null,
        lastError: 'clone path vanished',
        lastErrorAt: new Date('2026-08-13T00:00:00Z'),
      }),
    };
    const service = new ContextService(makeContainer(new MockGitClient({})), withFailure);
    const page = await service.docsPage(WS, REPO);
    expect(page.state).toBe('failed');
    // The previous success is INTACT beside the failure.
    expect(page.file_count).toBe(7);
    expect(page.scanned_at).toBe('2026-08-12T00:00:00.000Z');
    expect(page.last_error).toBe('clone path vanished');
    expect(page.documents).toHaveLength(1);
  });

  it('an older failure does not mask a newer success', async () => {
    const { repo } = makeRepo();
    const stale: ContextRepo = {
      ...repo,
      scanFor: async () => ({
        roots: ['docs'],
        fileCount: 2,
        bounded: false,
        scannedAt: new Date('2026-08-13T00:00:00Z'),
        scanningAt: null,
        lastError: 'an old failure',
        lastErrorAt: new Date('2026-08-01T00:00:00Z'),
      }),
    };
    const service = new ContextService(makeContainer(new MockGitClient({})), stale);
    expect((await service.docsPage(WS, REPO)).state).toBe('scanned');
  });

  /**
   * A RESCAN is the case a previous result hides: the row already carries a
   * `scannedAt`, so a scan claimed with anything less than its own column reads
   * back as `scanned` and the page never polls.
   */
  it('a scan in flight over a previous SUCCESS reports scanning, keeping the old result', async () => {
    const { repo } = makeRepo({ docs: [scannedDoc('docs/a.md')] });
    const rescanning: ContextRepo = {
      ...repo,
      scanFor: async () => ({
        roots: ['docs'],
        fileCount: 3,
        bounded: false,
        scannedAt: new Date('2026-08-13T00:00:00Z'),
        // A LIVE claim: `scanState` ignores one older than SCAN_CLAIM_STALE_MS.
        scanningAt: new Date(Date.now() - 1_000),
        lastError: null,
        lastErrorAt: null,
      }),
    };
    const service = new ContextService(makeContainer(new MockGitClient({})), rescanning);
    const page = await service.docsPage(WS, REPO);
    expect(page.state).toBe('scanning');
    // The previous documents and time are still shown beneath the in-flight scan.
    expect(page.file_count).toBe(3);
    expect(page.scanned_at).toBe('2026-08-13T00:00:00.000Z');
    expect(page.documents).toHaveLength(1);
  });

  it('stops believing a claim no outcome ever cleared, so the page can retry', async () => {
    // Only a process killed mid-scan leaves this behind — both outcomes clear
    // the column. Believing it forever polls forever AND disables the one
    // button that would fix it.
    const { repo } = makeRepo({ docs: [scannedDoc('docs/a.md')] });
    const abandoned: ContextRepo = {
      ...repo,
      scanFor: async () => ({
        roots: ['docs'],
        fileCount: 1,
        bounded: false,
        scannedAt: new Date('2026-08-13T00:00:00Z'),
        scanningAt: new Date(Date.now() - 11 * 60 * 1000),
        lastError: null,
        lastErrorAt: null,
      }),
    };
    const service = new ContextService(makeContainer(new MockGitClient({})), abandoned);
    expect((await service.docsPage(WS, REPO)).state).toBe('scanned');
  });

  /**
   * The same corpse on a repo that never completed a scan: no previous success
   * to fall back to. Reporting `scanning` here polls forever, and it is the row
   * an API restart under `tsx watch` produces routinely — between `markScanning`
   * and the handler finishing, with nothing recovering the in-memory queue.
   */
  it('a FIRST scan whose claim went stale does not report scanning, and the read re-enqueues it', async () => {
    const { repo } = makeRepo({ docs: [] });
    const claimed = vi.fn(async () => undefined);
    const enqueue = vi.fn(async () => ({ id: 'job-1' }));
    const stranded: ContextRepo = {
      ...repo,
      markScanning: claimed,
      scanFor: async () => ({
        roots: ['docs'],
        fileCount: 0,
        bounded: false,
        scannedAt: null,
        scanningAt: new Date(Date.now() - 11 * 60 * 1000),
        lastError: null,
        lastErrorAt: null,
      }),
    };
    const container = makeContainer(new MockGitClient({}), { context_scan_roots: ['docs'] });
    const service = new ContextService(
      { ...container, jobs: { enqueue, register: () => undefined } },
      stranded,
    );

    const page = await service.docsPage(WS, REPO);

    expect(page.state).not.toBe('scanning');
    expect(page.state).toBe('failed');
    // And the read is the route back: the claim is renewed and a scan queued,
    // so the same page load that stops lying also starts the recovery.
    expect(claimed).toHaveBeenCalledWith(REPO, ['docs', '.devdigest']);
    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  it('a LIVE claim is not re-enqueued: one scan in flight stays one scan', async () => {
    const { repo } = makeRepo({ docs: [scannedDoc('docs/a.md')] });
    const enqueue = vi.fn(async () => ({ id: 'job-1' }));
    const inFlight: ContextRepo = {
      ...repo,
      scanFor: async () => ({
        roots: ['docs'],
        fileCount: 1,
        bounded: false,
        scannedAt: null,
        scanningAt: new Date(Date.now() - 1_000),
        lastError: null,
        lastErrorAt: null,
      }),
    };
    const container = makeContainer(new MockGitClient({}));
    const service = new ContextService(
      { ...container, jobs: { enqueue, register: () => undefined } },
      inFlight,
    );

    expect((await service.docsPage(WS, REPO)).state).toBe('scanning');
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('a scan in flight over a previous FAILURE reports scanning, not failed', async () => {
    const { repo } = makeRepo();
    const retrying: ContextRepo = {
      ...repo,
      scanFor: async () => ({
        roots: ['docs'],
        fileCount: 0,
        bounded: false,
        scannedAt: null,
        scanningAt: new Date(Date.now() - 1_000),
        lastError: 'clone path vanished',
        lastErrorAt: new Date('2026-08-13T01:00:00Z'),
      }),
    };
    const service = new ContextService(makeContainer(new MockGitClient({})), retrying);
    expect((await service.docsPage(WS, REPO)).state).toBe('scanning');
  });
});

describe('CloneReadError', () => {
  it('carries its reason as data, not as a message to be matched on', () => {
    const err = new CloneReadError('git_dir', 'refusing to read the clone git directory');
    expect(err.reason).toBe('git_dir');
    expect(err).toBeInstanceOf(Error);
  });
});
