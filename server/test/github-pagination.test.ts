import { describe, it, expect, vi } from 'vitest';
import type { Octokit } from 'octokit';
import { OctokitGitHubClient } from '../src/adapters/github/octokit.js';

/**
 * PR import used to issue one `per_page: 100` call and keep whatever came back,
 * so a PR of 161 files reached the reviewing agents as its first 100 in
 * GitHub's ordering. On `Holubinka/dev-digest#7` that was every `client/` file
 * and not one of the 46 under `server/`, and the API Contract Reviewer
 * truthfully reported a vendored contract as "not changed in this diff" —
 * twice, at 0.95 confidence. The input was wrong, not the agent.
 *
 * Octokit is injected rather than mocked at the network layer: `paginate` is
 * the thing under test, so the fake has to be the real `paginate` walking a
 * fake transport.
 */

const FILE_COUNT = 161;

/** The shape `pulls.listFiles` returns, in the order GitHub returns it. */
function fileRows(count: number) {
  return Array.from({ length: count }, (_, i) => {
    const half = Math.floor(count / 2);
    const path = i < half ? `client/src/f${i}.ts` : `server/src/f${i}.ts`;
    return { filename: path, additions: 1, deletions: 0, patch: `@@ -0,0 +1 @@\n+${i}` };
  });
}

/**
 * A stand-in Octokit whose `paginate` walks pages the way the real one does:
 * call the route, hand the page to the map callback, stop when the callback
 * calls `done()` or a short page arrives.
 */
function fakeOctokit(rows: unknown[], perPage = 100) {
  const calls: Array<Record<string, unknown>> = [];

  const listFiles = async (params: Record<string, unknown>) => {
    calls.push(params);
    const page = Number(params.page ?? 1);
    const size = Number(params.per_page ?? perPage);
    return { data: rows.slice((page - 1) * size, page * size) };
  };

  const paginate = async (
    route: (p: Record<string, unknown>) => Promise<{ data: unknown[] }>,
    params: Record<string, unknown>,
    map: (res: { data: unknown[] }, done: () => void) => unknown[],
  ) => {
    const size = Number(params.per_page ?? perPage);
    let stopped = false;
    const done = () => {
      stopped = true;
    };
    for (let page = 1; !stopped; page++) {
      const res = await route({ ...params, page });
      map(res, done);
      if (res.data.length < size) break;
    }
    return [];
  };

  return {
    calls,
    octokit: {
      paginate,
      rest: {
        pulls: {
          get: async () => ({
            data: {
              number: 7,
              title: 'feat(skills): reusable prompt blocks bound to agents',
              user: { login: 'Holubinka' },
              head: { ref: 'feat/skills', sha: 'bb441a2' },
              base: { ref: 'main' },
              additions: 9565,
              deletions: 201,
              changed_files: FILE_COUNT,
              state: 'open',
              merged_at: null,
              created_at: '2026-08-03T12:00:00Z',
              updated_at: '2026-08-03T13:00:00Z',
              body: null,
            },
          }),
          listFiles,
          listCommits: async () => ({ data: [] }),
        },
      },
    } as unknown as Octokit,
  };
}

describe('PR import pagination', () => {
  it('brings back every file, not the first page', async () => {
    const { octokit, calls } = fakeOctokit(fileRows(FILE_COUNT));
    const gh = new OctokitGitHubClient('token', octokit);

    const detail = await gh.getPullRequest({ owner: 'Holubinka', name: 'dev-digest' }, 7);

    expect(detail.files).toHaveLength(FILE_COUNT);
    expect(detail.files_count).toBe(FILE_COUNT);
    // The regression this exists for: the tail of the diff is a different
    // package, and dropping it is what made the reviewer wrong.
    expect(detail.files.some((f) => f.path.startsWith('server/'))).toBe(true);
    expect(calls.map((c) => c.page)).toEqual([1, 2]);
  });

  it('asks for the largest page GitHub will serve', async () => {
    const { octokit, calls } = fakeOctokit(fileRows(FILE_COUNT));
    const gh = new OctokitGitHubClient('token', octokit);
    await gh.getPullRequest({ owner: 'Holubinka', name: 'dev-digest' }, 7);
    expect(calls[0]!.per_page).toBe(100);
  });

  it('keeps the patch text intact across the page boundary', async () => {
    const { octokit } = fakeOctokit(fileRows(FILE_COUNT));
    const gh = new OctokitGitHubClient('token', octokit);
    const detail = await gh.getPullRequest({ owner: 'Holubinka', name: 'dev-digest' }, 7);

    const last = detail.files.at(-1)!;
    expect(last.path).toBe(`server/src/f${FILE_COUNT - 1}.ts`);
    expect(last.patch).toContain(`+${FILE_COUNT - 1}`);
  });

  it('stops at the cap instead of walking a 5000-file PR forever', async () => {
    const { octokit, calls } = fakeOctokit(fileRows(5000));
    const gh = new OctokitGitHubClient('token', octokit);

    const detail = await gh.getPullRequest({ owner: 'Holubinka', name: 'dev-digest' }, 7);

    expect(detail.files).toHaveLength(1000);
    expect(calls).toHaveLength(10);
  });

  it('makes one request when the PR fits on a page', async () => {
    const { octokit, calls } = fakeOctokit(fileRows(12));
    const gh = new OctokitGitHubClient('token', octokit);

    const detail = await gh.getPullRequest({ owner: 'Holubinka', name: 'dev-digest' }, 7);

    expect(detail.files).toHaveLength(12);
    expect(calls).toHaveLength(1);
  });

  it('survives a PR with no files at all', async () => {
    const { octokit } = fakeOctokit([]);
    const gh = new OctokitGitHubClient('token', octokit);
    const detail = await gh.getPullRequest({ owner: 'Holubinka', name: 'dev-digest' }, 7);
    expect(detail.files).toEqual([]);
  });
});

describe('OctokitGitHubClient construction', () => {
  it('builds its own client from the token when none is injected', () => {
    // The seam must not change production wiring — container.ts passes a token.
    expect(() => new OctokitGitHubClient('ghp_example')).not.toThrow();
  });

  it('does not reach the network merely by being constructed', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    new OctokitGitHubClient('ghp_example');
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
