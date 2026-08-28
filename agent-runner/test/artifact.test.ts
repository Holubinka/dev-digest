import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { CiResultArtifact } from '@devdigest/shared';
import {
  ARTIFACT_FILE,
  ArtifactSecretError,
  scanForSecrets,
  writeArtifact,
} from '../src/artifact.js';
import { EXIT_FAILED, EXIT_GATE_TRIPPED, EXIT_OK } from '../src/gate.js';
import { PATCH, StubProvider, VALID_MANIFEST, bundleDir, review } from './helpers.js';

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

function githubOk(status = 200) {
  vi.stubGlobal('fetch', async (url: string) => {
    if (status !== 200) return new Response('{"message":"boom"}', { status });
    if (url.includes('/files')) {
      return Response.json([{ filename: 'src/handler.ts', patch: PATCH }]);
    }
    if (url.includes('/comments')) return Response.json([]);
    if (url.includes('/reviews')) return Response.json({ id: 1 });
    return Response.json({ title: 'Add handler', body: 'b', head: { ref: 'f', sha: 'abc' } });
  });
}

function readArtifact(root: string): CiResultArtifact {
  const file = path.join(root, ARTIFACT_FILE);
  expect(existsSync(file)).toBe(true);
  return CiResultArtifact.parse(JSON.parse(readFileSync(file, 'utf8')));
}

beforeEach(() => {
  stub.provider = new StubProvider();
});
afterEach(() => vi.unstubAllGlobals());

describe('devdigest-result.json — one per path', () => {
  it('succeeded: counts, verdict and the gate exit code', async () => {
    const root = bundleDir({ '.devdigest/agents/security.yaml': VALID_MANIFEST });
    githubOk();

    const code = await run({ ...ENV, GITHUB_STEP_SUMMARY: '' }, root);
    const artifact = readArtifact(root);

    expect(code).toBe(EXIT_GATE_TRIPPED);
    expect(artifact.status).toBe('succeeded');
    expect(artifact.reason).toBeNull();
    expect(artifact.verdict).toBe('request_changes');
    expect(artifact.findings_count).toBe(1);
    expect(artifact.critical).toBe(1);
    expect(artifact.agent).toBe('security');
    expect(artifact.changed_lines).toBe(2);
    expect(artifact.max_changed_lines).toBe(50000);
    expect(artifact.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it('succeeded with no findings: exit 0 and an approve verdict', async () => {
    const root = bundleDir({ '.devdigest/agents/security.yaml': VALID_MANIFEST });
    stub.provider = new StubProvider(review({ verdict: 'approve', score: 95, findings: [] }));
    githubOk();

    expect(await run(ENV, root)).toBe(EXIT_OK);
    const artifact = readArtifact(root);
    expect(artifact.status).toBe('succeeded');
    expect(artifact.findings_count).toBe(0);
    expect(artifact.verdict).toBe('approve');
  });

  it('failed: GitHub exhausted its retries, non-zero exit, reason named', async () => {
    const root = bundleDir({ '.devdigest/agents/security.yaml': VALID_MANIFEST });
    githubOk(500);

    expect(await run(ENV, root)).toBe(EXIT_FAILED);
    const artifact = readArtifact(root);
    expect(artifact.status).toBe('failed');
    expect(artifact.reason).toMatch(/GitHub API failed after retries/);
    expect(artifact.findings_count).toBe(0);
  });

  it('failed: an invalid manifest names the field and calls no model', async () => {
    const root = bundleDir({ '.devdigest/agents/security.yaml': 'name: A\nsystem_prompt: p\n' });
    const provider = new StubProvider();
    stub.provider = provider;
    githubOk();

    expect(await run(ENV, root)).toBe(EXIT_FAILED);
    const artifact = readArtifact(root);
    expect(artifact.status).toBe('failed');
    expect(artifact.reason).toMatch(/manifest invalid at "model"/);
    expect(provider.calls).toBe(0);
  });

  it('skipped: a diff over the ceiling, exit 0, no model call', async () => {
    const root = bundleDir({ '.devdigest/agents/security.yaml': VALID_MANIFEST });
    const provider = new StubProvider();
    stub.provider = provider;
    githubOk();

    expect(await run({ ...ENV, DEVDIGEST_MAX_DIFF_LINES: '1' }, root)).toBe(EXIT_OK);
    const artifact = readArtifact(root);
    expect(artifact.status).toBe('skipped');
    expect(artifact.reason).toMatch(/over the 1-line ceiling/);
    expect(artifact.changed_lines).toBe(2);
    expect(artifact.max_changed_lines).toBe(1);
    expect(provider.calls).toBe(0);
  });

  it('skipped: a fork PR, exit 0, and a job-summary line naming the secrets', async () => {
    const root = bundleDir({ '.devdigest/agents/security.yaml': VALID_MANIFEST });
    const summary = path.join(root, 'summary.md');
    const provider = new StubProvider();
    stub.provider = provider;
    githubOk();

    const code = await run(
      { ...ENV, DEVDIGEST_IS_FORK: 'true', GITHUB_STEP_SUMMARY: summary },
      root,
    );
    const artifact = readArtifact(root);

    expect(code).toBe(EXIT_OK);
    expect(artifact.status).toBe('skipped');
    expect(artifact.reason).toMatch(/fork pull request/);
    expect(provider.calls).toBe(0);
    const written = readFileSync(summary, 'utf8');
    expect(written).toMatch(/secrets are not available/);
    expect(written).toMatch(/OPENROUTER_API_KEY/);
  });
});

describe('the secret scan', () => {
  it('refuses the file rather than truncating a planted key value', () => {
    const root = bundleDir();
    const key = 'sk-or-v1-0123456789abcdef0123456789abcdef';
    expect(() =>
      writeArtifact(
        root,
        { findings_count: 0, cost_usd: null, agent: 'a', reason: `provider said ${key}` },
        [key],
      ),
    ).toThrow(ArtifactSecretError);
    expect(existsSync(path.join(root, ARTIFACT_FILE))).toBe(false);
  });

  it('catches a credential shape even when the literal is unknown to it', () => {
    expect(scanForSecrets('{"reason":"AKIA1234567890ABCDEF"}', [])).toBe('aws access key');
    expect(scanForSecrets('{"reason":"ghp_0123456789012345678901"}', [])).toBe('github token');
    expect(scanForSecrets('{"reason":"nothing to see"}', [])).toBeNull();
  });

  it('ignores a short literal that would otherwise match everything', () => {
    expect(scanForSecrets('{"agent":"a"}', ['a', ''])).toBeNull();
  });

  it('strips every key the contract does not name, so no prompt or diff can ride along', () => {
    const root = bundleDir();
    const { artifact } = writeArtifact(root, {
      findings_count: 0,
      cost_usd: null,
      agent: 'a',
      prompt: 'the whole assembled prompt',
      diff: 'diff --git a/x b/x',
    });
    expect(Object.keys(artifact)).not.toContain('prompt');
    const raw = readFileSync(path.join(root, ARTIFACT_FILE), 'utf8');
    expect(raw).not.toContain('assembled prompt');
    expect(raw).not.toContain('diff --git');
  });

  it('never carries a finding title, so a credential inside one cannot reach the file', async () => {
    const root = bundleDir({ '.devdigest/agents/security.yaml': VALID_MANIFEST });
    stub.provider = new StubProvider(
      review({
        findings: [{ ...review().findings[0]!, title: 'leaked ghp_012345678901234567890123' }],
      }),
    );
    githubOk();

    await run(ENV, root);
    const artifact = readArtifact(root);
    expect(artifact.status).toBe('succeeded');
    expect(artifact.findings_count).toBe(1);
    expect(JSON.stringify(artifact)).not.toContain('ghp_012345678901234567890123');
  });

  it('withholds the result when a reason would have echoed a secret back', async () => {
    const root = bundleDir({ '.devdigest/agents/security.yaml': VALID_MANIFEST });
    githubOk();

    // The environment error names the value it refused, and here that value IS
    // the OpenRouter key — the one reachable way a credential reaches a field
    // the schema keeps.
    const code = await run({ ...ENV, DEVDIGEST_REPOSITORY: ENV.OPENROUTER_API_KEY }, root);
    const artifact = readArtifact(root);

    expect(code).toBe(EXIT_FAILED);
    expect(artifact.status).toBe('failed');
    expect(artifact.reason).toBe('result withheld: a credential was detected in it');
    expect(readFileSync(path.join(root, ARTIFACT_FILE), 'utf8')).not.toContain(
      ENV.OPENROUTER_API_KEY,
    );
  });
});
