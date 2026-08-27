import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { CiResultArtifact } from '@devdigest/shared';
import { ARTIFACT_FILE } from '../src/artifact.js';
import { EXIT_FAILED, EXIT_OK } from '../src/gate.js';
import { PATCH, StubProvider, VALID_MANIFEST, bundleDir, finding, review } from './helpers.js';

const stub = vi.hoisted(() => ({ provider: undefined as unknown }));
vi.mock('../src/review.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/review.js')>();
  return { ...actual, createProvider: () => stub.provider };
});

const { run } = await import('../src/index.js');

const ENV = {
  DEVDIGEST_AGENT: 'security',
  DEVDIGEST_REPOSITORY: 'acme/widgets',
  DEVDIGEST_PR_NUMBER: '7',
  DEVDIGEST_POST_AS: 'github_review',
  GITHUB_TOKEN: 'ghs_job_token_value',
  OPENROUTER_API_KEY: 'sk-or-v1-0123456789abcdef0123456789abcdef',
};

/** An invalid manifest: `model` is required, so `readManifest` throws on it. */
const INVALID_MANIFEST = 'name: A\nsystem_prompt: p\n';

interface Call {
  url: string;
  method: string;
  body: string;
}

/** Stub GitHub and record every call, so a test can assert what was NOT called. */
function stubGitHub(answer: (url: string) => unknown = () => ({})): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? 'GET', body: String(init?.body ?? '') });
    if (url.includes('/files')) return Response.json([{ filename: 'src/handler.ts', patch: PATCH }]);
    if (url.includes('/comments') && (init?.method ?? 'GET') === 'GET') return Response.json([]);
    return Response.json(answer(url));
  });
  return calls;
}

function readArtifact(root: string): CiResultArtifact {
  const file = path.join(root, ARTIFACT_FILE);
  expect(existsSync(file)).toBe(true);
  return CiResultArtifact.parse(JSON.parse(readFileSync(file, 'utf8')));
}

const posts = (calls: Call[]): Call[] => calls.filter((c) => c.method === 'POST');

beforeEach(() => {
  stub.provider = new StubProvider();
});
afterEach(() => vi.unstubAllGlobals());

/**
 * AC-52 is about ORDER, not about the fork branch producing a skip in isolation:
 * "no model call" has to hold even when everything downstream of the check would
 * itself have failed. A fork run has no secrets in its environment at all, so a
 * runner that validated the environment or the manifest first would report a
 * failure where the spec requires a skip.
 */
describe('the branch order (AC-52)', () => {
  it('takes the fork path before reading a deliberately invalid manifest', async () => {
    const root = bundleDir({ '.devdigest/agents/security.yaml': INVALID_MANIFEST });
    const provider = new StubProvider();
    stub.provider = provider;
    const calls = stubGitHub();

    const code = await run({ DEVDIGEST_IS_FORK: 'true', DEVDIGEST_AGENT: 'security' }, root);
    const artifact = readArtifact(root);

    expect(code).toBe(EXIT_OK);
    expect(artifact.status).toBe('skipped');
    expect(artifact.reason).toMatch(/fork pull request/);
    expect(artifact.reason).not.toMatch(/manifest/);
    expect(provider.calls).toBe(0);
    expect(calls).toEqual([]);
  });

  it('takes the fork path with neither secret in the environment', async () => {
    const root = bundleDir({ '.devdigest/agents/security.yaml': VALID_MANIFEST });
    stubGitHub();

    const code = await run({ ...ENV, GITHUB_TOKEN: '', OPENROUTER_API_KEY: '', DEVDIGEST_IS_FORK: 'true' }, root);

    expect(code).toBe(EXIT_OK);
    expect(readArtifact(root).status).toBe('skipped');
  });

  it('still records the agent and the ceiling on a path that read no manifest', async () => {
    const root = bundleDir();
    stubGitHub();

    await run({ DEVDIGEST_IS_FORK: 'true', DEVDIGEST_AGENT: 'security' }, root);
    const artifact = readArtifact(root);

    expect(artifact.agent).toBe('security');
    expect(artifact.max_changed_lines).toBe(15000);
  });

  it('reports the environment before the manifest, so a bad env is not blamed on the bundle', async () => {
    const root = bundleDir({ '.devdigest/agents/security.yaml': INVALID_MANIFEST });
    stubGitHub();

    const code = await run({ ...ENV, DEVDIGEST_PR_NUMBER: 'not-a-number' }, root);
    const artifact = readArtifact(root);

    expect(code).toBe(EXIT_FAILED);
    expect(artifact.reason).toMatch(/environment: expected a positive pull-request number/);
  });
});

/**
 * AC-64: `post_as` decides the publication and nothing else does. The artifact is
 * written on all three, because it is what the server ingests — `none` withholds
 * the comment, not the record.
 */
describe('post_as decides the publication (AC-64)', () => {
  it('github_review posts to the reviews endpoint', async () => {
    const root = bundleDir({ '.devdigest/agents/security.yaml': VALID_MANIFEST });
    const calls = stubGitHub(() => ({ id: 1 }));

    await run({ ...ENV, DEVDIGEST_POST_AS: 'github_review' }, root);

    expect(posts(calls).map((c) => c.url)).toEqual([
      'https://api.github.com/repos/acme/widgets/pulls/7/reviews',
    ]);
    expect(JSON.parse(posts(calls)[0]?.body ?? '{}').event).toBe('REQUEST_CHANGES');
    expect(readArtifact(root).status).toBe('succeeded');
  });

  it('names the agent in the heading, the way the check name does', async () => {
    // Two agents on one repository post from the same `github-actions[bot]`
    // account, so the heading is the only thing on the review itself that says
    // which one wrote it. The format matches `checkName` in
    // `server/src/modules/ci/generate/workflow.ts` so the review and the check
    // a branch rule matches on cannot drift apart.
    const root = bundleDir({ '.devdigest/agents/security.yaml': VALID_MANIFEST });
    const calls = stubGitHub(() => ({ id: 1 }));

    await run({ ...ENV, DEVDIGEST_POST_AS: 'github_review' }, root);

    const body = JSON.parse(posts(calls)[0]?.body ?? '{}').body as string;
    expect(body.split('\n')[0]).toContain('DevDigest Review (Security Reviewer)');
  });

  it('pr_comment posts to the issue comments endpoint instead', async () => {
    const root = bundleDir({ '.devdigest/agents/security.yaml': VALID_MANIFEST });
    const calls = stubGitHub(() => ({ id: 1 }));

    await run({ ...ENV, DEVDIGEST_POST_AS: 'pr_comment' }, root);

    expect(posts(calls).map((c) => c.url)).toEqual([
      'https://api.github.com/repos/acme/widgets/issues/7/comments',
    ]);
    expect(JSON.parse(posts(calls)[0]?.body ?? '{}').body).toContain('Command injection');
    expect(readArtifact(root).status).toBe('succeeded');
  });

  it('none publishes nothing, and still writes the artifact and fails the gate', async () => {
    const root = bundleDir({ '.devdigest/agents/security.yaml': VALID_MANIFEST });
    const calls = stubGitHub(() => ({ id: 1 }));

    // ci_fail_on is `critical` and the stub answers with a CRITICAL finding.
    const code = await run({ ...ENV, DEVDIGEST_POST_AS: 'none' }, root);
    const artifact = readArtifact(root);

    expect(posts(calls)).toEqual([]);
    expect(code).toBe(1);
    expect(artifact.status).toBe('succeeded');
    expect(artifact.verdict).toBe('request_changes');
    expect(artifact.findings_count).toBe(1);
  });

  it('refuses an unrecognised post_as as an environment failure, publishing nothing', async () => {
    const root = bundleDir({ '.devdigest/agents/security.yaml': VALID_MANIFEST });
    const calls = stubGitHub(() => ({ id: 1 }));

    const code = await run({ ...ENV, DEVDIGEST_POST_AS: 'webhook' }, root);
    const artifact = readArtifact(root);

    expect(code).toBe(EXIT_FAILED);
    expect(artifact.status).toBe('failed');
    expect(artifact.reason).toMatch(/DEVDIGEST_POST_AS|github_review \| pr_comment \| none/);
    expect(calls).toEqual([]);
  });

  it('a publication that fails after its retries is a failed run, not a silent success', async () => {
    const root = bundleDir({ '.devdigest/agents/security.yaml': VALID_MANIFEST });
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'POST') return new Response('{}', { status: 500 });
      if (url.includes('/files')) return Response.json([{ filename: 'src/handler.ts', patch: PATCH }]);
      if (url.includes('/comments')) return Response.json([]);
      return Response.json({ title: 't', body: 'b', head: { ref: 'f', sha: 'abc' } });
    });

    const code = await run(ENV, root);
    const artifact = readArtifact(root);

    expect(code).toBe(EXIT_FAILED);
    expect(artifact.status).toBe('failed');
    expect(artifact.reason).toMatch(/publishing the review failed after retries/);
    // The counts survive the failure: the review DID run, only the posting did not.
    expect(artifact.findings_count).toBe(1);
  });
});

/**
 * AC-61: the grounding gate is inside the engine, so this asserts the whole way
 * out — an ungrounded finding must be absent from the posted review AND from the
 * artifact's counts, which is the number the CI Runs page later shows.
 */
describe('grounding reaches the artifact (AC-61)', () => {
  it('counts only the grounded finding and posts only the grounded finding', async () => {
    const root = bundleDir({ '.devdigest/agents/security.yaml': VALID_MANIFEST });
    stub.provider = new StubProvider(
      review({
        findings: [
          finding({ id: 'in', start_line: 10, end_line: 10 }),
          finding({
            id: 'out',
            title: 'Invented defect',
            file: 'src/never-touched.ts',
            start_line: 900,
            end_line: 901,
          }),
        ],
      }),
    );
    const calls = stubGitHub(() => ({ id: 1 }));

    await run(ENV, root);
    const artifact = readArtifact(root);

    expect(artifact.findings_count).toBe(1);
    expect(artifact.critical).toBe(1);
    expect(posts(calls)[0]?.body).not.toContain('Invented defect');
    expect(posts(calls)[0]?.body).not.toContain('never-touched.ts');
  });
});
