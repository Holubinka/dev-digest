/**
 * `RepoService.refresh` — which job the Refresh button actually enqueues.
 *
 * The distinction these tests pin down is not cosmetic. `GitClient.clone`
 * falls through to a bare `fetch()` when `.git` is already present
 * (`adapters/git/simple-git.ts`), and a bare fetch moves `origin/<branch>`
 * only — HEAD and the worktree stay where they were. Every consumer of a
 * clone reads the WORKTREE: the context scan walks it for documents, the
 * indexer parses it for the blast radius. So a refresh that enqueues the
 * clone job serves the commit the repo was imported at, indefinitely, while
 * reporting success.
 *
 * `git.sync` (fetch + `reset --hard origin/<branch>`) is what advances the
 * worktree, and `repo-intel`'s resync job is the only caller of it. Hence:
 * an already-cloned repo must refresh through RESYNC, and only a repo with
 * no clone yet goes through CLONE.
 */
import { describe, it, expect } from 'vitest';
import { RepoService } from '../src/modules/repos/service.js';
import { CLONE_JOB_KIND } from '../src/modules/repos/constants.js';
import { RESYNC_JOB_KIND, REFRESH_JOB_KIND } from '../src/modules/repo-intel/constants.js';
import type { RepoRepository } from '../src/modules/repos/repository.js';
import type { Container } from '../src/platform/container.js';

interface Enqueued {
  kind: string;
  payload: unknown;
}

/**
 * A service whose repository is stubbed and whose JobRunner only records.
 * `failKinds` makes `enqueue` throw for the named kinds, which is how the
 * "repo-intel not wired" fallback is exercised without unwiring anything.
 */
function makeService(opts: { clonePath: string | null; failKinds?: string[] }) {
  const enqueued: Enqueued[] = [];
  const repo = {
    getById: async () => ({
      id: 'r1',
      workspaceId: 'w1',
      owner: 'acme',
      name: 'app',
      fullName: 'acme/app',
      defaultBranch: 'main',
      clonePath: opts.clonePath,
      lastPolledAt: null,
      createdBy: 'u1',
    }),
  } as unknown as RepoRepository;

  const container = {
    db: {},
    jobs: {
      enqueue: async (_ws: string, kind: string, payload: unknown) => {
        if (opts.failKinds?.includes(kind)) throw new Error(`no handler for ${kind}`);
        enqueued.push({ kind, payload });
      },
    },
  } as unknown as Container;

  const service = new RepoService(container);
  (service as unknown as { repo: RepoRepository }).repo = repo;
  return { service, enqueued };
}

describe('RepoService.refresh', () => {
  it('resyncs an already-cloned repo, so the worktree advances and not just the refs', async () => {
    const { service, enqueued } = makeService({ clonePath: '/mock/clone' });

    await service.refresh('w1', 'r1');

    const kinds = enqueued.map((e) => e.kind);
    expect(kinds).toContain(RESYNC_JOB_KIND);
    // The clone job is the bug: on an existing clone it fetches and returns,
    // leaving HEAD behind while reporting done.
    expect(kinds).not.toContain(CLONE_JOB_KIND);
    expect(enqueued.find((e) => e.kind === RESYNC_JOB_KIND)?.payload).toMatchObject({
      repoId: 'r1',
      owner: 'acme',
      name: 'app',
    });
  });

  it('clones a repo that has no clone yet — resync cannot create one', async () => {
    const { service, enqueued } = makeService({ clonePath: null });

    await service.refresh('w1', 'r1');

    const kinds = enqueued.map((e) => e.kind);
    expect(kinds).toContain(CLONE_JOB_KIND);
    expect(kinds).not.toContain(RESYNC_JOB_KIND);
    expect(enqueued.find((e) => e.kind === CLONE_JOB_KIND)?.payload).toMatchObject({
      repoId: 'r1',
      url: 'https://github.com/acme/app.git',
    });
  });

  it('falls back to the clone job when repo-intel has no resync handler', async () => {
    const { service, enqueued } = makeService({
      clonePath: '/mock/clone',
      failKinds: [RESYNC_JOB_KIND, REFRESH_JOB_KIND],
    });

    await service.refresh('w1', 'r1');

    expect(enqueued.map((e) => e.kind)).toContain(CLONE_JOB_KIND);
  });

  it('reports refreshing rather than throwing when no job handler is registered at all', async () => {
    const { service } = makeService({
      clonePath: '/mock/clone',
      failKinds: [RESYNC_JOB_KIND, REFRESH_JOB_KIND, CLONE_JOB_KIND],
    });

    await expect(service.refresh('w1', 'r1')).resolves.toEqual({ status: 'refreshing' });
  });
});
