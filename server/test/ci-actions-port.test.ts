import { describe, it, expect, vi } from 'vitest';
import type { Octokit } from 'octokit';
import { OctokitGitHubClient } from '../src/adapters/github/octokit.js';

/**
 * The Actions half of the GitHub port, against an injected Octokit.
 *
 * The property worth a test is the ORDER of the size check: an artifact is
 * written inside a repository DevDigest does not control, so an over-sized one
 * must be refused from its metadata, before the archive is requested. A check
 * that runs after the download is a check that has already paid for the bytes.
 */

const REPO = { owner: 'Holubinka', name: 'dev-digest' };

interface TreeEntry {
  path: string;
  mode: string;
  type: string;
  content?: string;
  sha?: string | null;
}

/** Every `createTree` call's entries, newest last. Reset per `fakeOctokit`. */
let treeEntries: TreeEntry[][] = [];

function resetTrees() {
  treeEntries = [];
}

function runRow(over: Record<string, unknown> = {}) {
  return {
    id: 17_179_869_184,
    head_sha: 'a1b2c3d4',
    status: 'completed',
    conclusion: 'success',
    pull_requests: [{ number: 7 }],
    html_url: 'https://github.com/Holubinka/dev-digest/actions/runs/17179869184',
    run_started_at: '2026-08-26T09:00:00Z',
    updated_at: '2026-08-26T09:02:00Z',
    repository: { full_name: 'Holubinka/dev-digest' },
    ...over,
  };
}

/** An Octokit failure as the real client throws it. */
function httpError(status: number): Error & { status: number } {
  return Object.assign(new Error(status === 404 ? 'Not Found' : `HTTP ${status}`), { status });
}

function fakeOctokit(opts: {
  runs?: unknown[];
  artifacts?: unknown[];
  artifact?: Record<string, unknown>;
  zip?: ArrayBuffer;
  /** Workflow file names the repository does NOT have — a 404 from Actions. */
  missingWorkflows?: string[];
  /** The repository itself is invisible to this token: everything 404s. */
  repoInvisible?: boolean;
  /** Paths the parent commit carries; anything else 404s from `getContent`. */
  existingPaths?: string[];
}) {
  const calls: string[] = [];
  const octokit = {
    rest: {
      repos: {
        get: async () => {
          calls.push('repos.get');
          if (opts.repoInvisible) throw httpError(404);
          return { data: { full_name: 'Holubinka/dev-digest' } };
        },
        getContent: async (params: Record<string, unknown>) => {
          calls.push(`getContent:${String(params.path)}`);
          if (!(opts.existingPaths ?? []).includes(String(params.path))) throw httpError(404);
          return { data: { path: params.path } };
        },
      },
      git: {
        getRef: async () => ({ data: { object: { sha: 'parent-sha' } } }),
        getCommit: async () => ({ data: { tree: { sha: 'parent-tree' } } }),
        createTree: async (params: Record<string, unknown>) => {
          calls.push('createTree');
          treeEntries.push(params.tree as TreeEntry[]);
          return { data: { sha: 'new-tree' } };
        },
        createCommit: async () => ({ data: { sha: 'new-commit' } }),
        updateRef: async () => ({ data: {} }),
        createRef: async () => ({ data: {} }),
      },
      actions: {
        listWorkflowRuns: async (params: Record<string, unknown>) => {
          calls.push(`listWorkflowRuns:${String(params.workflow_id)}`);
          if (
            opts.repoInvisible ||
            (opts.missingWorkflows ?? []).includes(String(params.workflow_id))
          ) {
            throw httpError(404);
          }
          return { data: { workflow_runs: opts.runs ?? [] } };
        },
        listWorkflowRunArtifacts: async (params: Record<string, unknown>) => {
          calls.push(`listWorkflowRunArtifacts:${String(params.run_id)}`);
          return { data: { artifacts: opts.artifacts ?? [] } };
        },
        getArtifact: async (params: Record<string, unknown>) => {
          calls.push(`getArtifact:${String(params.artifact_id)}`);
          return {
            data: {
              id: params.artifact_id,
              name: 'devdigest-result',
              size_in_bytes: 128,
              expired: false,
              ...opts.artifact,
            },
          };
        },
        downloadArtifact: async (params: Record<string, unknown>) => {
          calls.push(`downloadArtifact:${String(params.artifact_id)}`);
          return { data: opts.zip ?? new ArrayBuffer(128) };
        },
      },
    },
  } as unknown as Octokit;

  return { octokit, calls, treeEntries };
}

describe('OctokitGitHubClient — Actions', () => {
  it('maps a workflow run to the fields a row is attributed by', async () => {
    const { octokit, calls } = fakeOctokit({ runs: [runRow()] });
    const gh = new OctokitGitHubClient('token', octokit);

    const runs = await gh.listWorkflowRuns(REPO, 'devdigest-review-security-reviewer.yml');

    expect(runs).toHaveLength(1);
    expect(runs![0]).toMatchObject({
      // Past 2^31 on purpose — the id has to survive as a number, not overflow.
      id: 17_179_869_184,
      head_sha: 'a1b2c3d4',
      pr_number: 7,
      repository: 'Holubinka/dev-digest',
    });
    expect(calls).toEqual(['listWorkflowRuns:devdigest-review-security-reviewer.yml']);
  });

  it('reports no PR for a run GitHub attached none to', async () => {
    const { octokit } = fakeOctokit({ runs: [runRow({ pull_requests: [] })] });
    const gh = new OctokitGitHubClient('token', octokit);

    const runs = await gh.listWorkflowRuns(REPO, 'devdigest-review-security-reviewer.yml');

    expect(runs![0]!.pr_number).toBeNull();
  });

  it('lists the artifacts of one run', async () => {
    const { octokit } = fakeOctokit({
      artifacts: [{ id: 9, name: 'devdigest-result', size_in_bytes: 512, expired: false }],
    });
    const gh = new OctokitGitHubClient('token', octokit);

    const artifacts = await gh.listRunArtifacts(REPO, 17_179_869_184);

    expect(artifacts).toEqual([
      { id: 9, name: 'devdigest-result', size_in_bytes: 512, expired: false },
    ]);
  });

  it('downloads an artifact inside the cap', async () => {
    const { octokit, calls } = fakeOctokit({});
    const gh = new OctokitGitHubClient('token', octokit);

    const bytes = await gh.downloadArtifact(REPO, 9, 1024);

    expect(bytes.byteLength).toBe(128);
    expect(calls).toEqual(['getArtifact:9', 'downloadArtifact:9']);
  });

  it('refuses an over-sized artifact without requesting the archive', async () => {
    const { octokit, calls } = fakeOctokit({ artifact: { size_in_bytes: 50_000_000 } });
    const gh = new OctokitGitHubClient('token', octokit);

    await expect(gh.downloadArtifact(REPO, 9, 1024)).rejects.toThrow(/over the 1024-byte limit/);

    // The whole point: the zip endpoint was never called, so nothing was held.
    // And exactly one metadata call — a refusal is not a transient failure to
    // retry three more times.
    expect(calls).toEqual(['getArtifact:9']);
  });

  it('refuses a body that arrives larger than the declared size', async () => {
    const { octokit } = fakeOctokit({ zip: new ArrayBuffer(4096) });
    const gh = new OctokitGitHubClient('token', octokit);

    // The declared size is metadata; the body is what actually arrived.
    await expect(gh.downloadArtifact(REPO, 9, 1024)).rejects.toThrow(/downloaded 4096 bytes/);
  });

  it('refuses an expired artifact rather than downloading an empty archive', async () => {
    const { octokit, calls } = fakeOctokit({ artifact: { expired: true } });
    const gh = new OctokitGitHubClient('token', octokit);

    await expect(gh.downloadArtifact(REPO, 9, 1024)).rejects.toThrow(/expired/);
    expect(calls).toEqual(['getArtifact:9']);
  });

  it('does not reach the network merely by listing runs on a constructed client', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const { octokit } = fakeOctokit({ runs: [runRow()] });
    await new OctokitGitHubClient('ghp_example', octokit).listWorkflowRuns(REPO, 'x.yml');
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe('OctokitGitHubClient — a workflow file that is not there (AC-147, AC-83)', () => {
  it('answers null when Actions has no workflow by that name', async () => {
    const { octokit, calls } = fakeOctokit({ missingWorkflows: ['devdigest-review-gone.yml'] });
    const gh = new OctokitGitHubClient('token', octokit);

    expect(await gh.listWorkflowRuns(REPO, 'devdigest-review-gone.yml')).toBeNull();
    // The repository was asked for BEFORE the 404 was believed — GitHub returns
    // the same 404 for "no such workflow" and "this token cannot see this
    // repository", and only the first may be recorded as a missing workflow.
    expect(calls).toEqual(['listWorkflowRuns:devdigest-review-gone.yml', 'repos.get']);
  });

  it('throws when the REPOSITORY is what the token cannot see', async () => {
    const { octokit } = fakeOctokit({ repoInvisible: true });
    const gh = new OctokitGitHubClient('token', octokit);

    // A failed poll, so the caller reports it per repository (AC-83) and leaves
    // `last_polled_at` alone (AC-129) instead of claiming the file is missing.
    await expect(gh.listWorkflowRuns(REPO, 'devdigest-review-x.yml')).rejects.toThrow('Not Found');
  });
});

describe('OctokitGitHubClient — commitFiles removes paths in the same commit (AC-146)', () => {
  const payload = (deletions?: string[]) => ({
    branch: 'devdigest/ci',
    base: 'main',
    message: 'chore(devdigest): add the CI review bundle',
    files: [{ path: '.devdigest/runner.mjs', contents: '// runner\n' }],
    ...(deletions ? { deletions } : {}),
  });

  it('adds a sha:null entry for a path the parent commit carries', async () => {
    resetTrees();
    const legacy = '.github/workflows/devdigest-review.yml';
    const { octokit } = fakeOctokit({ existingPaths: [legacy] });
    const gh = new OctokitGitHubClient('token', octokit);

    await gh.commitFiles(REPO, payload([legacy]));

    // ONE tree, so one commit carries both the writes and the removal.
    expect(treeEntries).toHaveLength(1);
    expect(treeEntries[0]).toEqual([
      { path: '.devdigest/runner.mjs', mode: '100644', type: 'blob', content: '// runner\n' },
      { path: legacy, mode: '100644', type: 'blob', sha: null },
    ]);
  });

  it('skips a path the parent commit does not carry', async () => {
    resetTrees();
    const { octokit, calls } = fakeOctokit({ existingPaths: [] });
    const gh = new OctokitGitHubClient('token', octokit);

    await gh.commitFiles(REPO, payload(['.github/workflows/devdigest-review.yml']));

    // The caller asks for an END STATE and cannot know what the repository
    // holds. Most repositories never had the legacy file, and a delete entry
    // for a path that is not in the base tree is not something to gamble a
    // publication on.
    expect(calls).toContain('getContent:.github/workflows/devdigest-review.yml');
    expect(treeEntries[0]).toHaveLength(1);
    expect(treeEntries[0]![0]!.path).toBe('.devdigest/runner.mjs');
  });

  it('reads nothing at all when there is nothing to remove', async () => {
    resetTrees();
    const { octokit, calls } = fakeOctokit({});
    const gh = new OctokitGitHubClient('token', octokit);

    await gh.commitFiles(REPO, payload());

    expect(calls.filter((c) => c.startsWith('getContent'))).toEqual([]);
    expect(treeEntries[0]).toHaveLength(1);
  });
});
