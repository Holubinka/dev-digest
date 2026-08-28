/**
 * P3.4 — Install, over a real Postgres.
 *
 * What only a real database can answer: that publishing twice leaves ONE
 * `ci_installations` row for the pair (`agent_id`, `repo`) and ONE pull request,
 * and that a GitHub refusal leaves ZERO rows — the ordering property the
 * service's comment claims and no stub can prove.
 *
 * `MockSecretsProvider` with real-looking values and an accepted convention in
 * the database are both here on purpose: they make AC-25 and AC-95/AC-96
 * assertions about a bundle built the way production builds it, rather than
 * about a generator called directly with nothing to leak.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import {
  MockAuthProvider,
  MockGitHubClient,
  MockRunnerBundle,
  MockSecretsProvider,
} from '../src/adapters/mocks.js';
import type { GitHubClient, RepoRef, CommitFilesPayload } from '@devdigest/shared';
import * as t from '../src/db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;
const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const OPENROUTER_KEY = 'sk-or-v1-THIS-VALUE-MUST-NEVER-BE-GENERATED';
const CONVENTION_RULE = 'Every repository read is workspace-scoped through an inner join.';

let pg: PgFixture;
let workspaceId: string;
let seq = 0;

/** Refuses to write, the way a token without `contents: write` does (AC-43). */
class RefusingGitHub extends MockGitHubClient {
  override async commitFiles(_repo: RepoRef, _p: CommitFilesPayload): Promise<{ branch: string }> {
    throw new Error('Resource not accessible by personal access token');
  }
}

function appWith(github: GitHubClient) {
  return buildApp({
    config: config(),
    db: pg.handle.db,
    overrides: {
      auth: new MockAuthProvider(undefined, { id: workspaceId, name: 'default' }),
      secrets: new MockSecretsProvider({ OPENROUTER_API_KEY: OPENROUTER_KEY }),
      github,
      runnerBundle: new MockRunnerBundle({ contents: '// runner bundle\n' }),
    },
  });
}

async function makeAgent(name = 'Security Reviewer') {
  const [agent] = await pg.handle.db
    .insert(t.agents)
    .values({
      workspaceId,
      name: `${name} ${seq++}`,
      provider: 'openrouter',
      model: 'anthropic/claude-sonnet-4',
      systemPrompt: 'Review for security.',
      ciFailOn: 'warning',
    })
    .returning();
  return agent!;
}

const body = (repo: string, over: Record<string, unknown> = {}) => ({
  repo,
  base: 'main',
  action: 'open_pr',
  post_as: 'github_review',
  triggers: ['opened', 'synchronize'],
  ...over,
});

d('ci export — install', () => {
  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
    // An accepted convention, so "nothing from the workspace database reaches
    // the bundle" is a claim with something behind it.
    await pg.handle.db.insert(t.conventions).values({
      workspaceId,
      category: 'architecture',
      rule: CONVENTION_RULE,
      status: 'accepted',
    });
  });
  afterAll(async () => {
    await pg?.stop();
  });

  it('leaves exactly one row and one PR when the same agent is published twice (AC-41, AC-42)', async () => {
    const agent = await makeAgent();
    const github = new MockGitHubClient({});
    const server = await appWith(github);
    const repo = 'acme/payments-api';

    const first = await server.inject({
      method: 'POST',
      url: `/agents/${agent.id}/export-ci`,
      payload: body(repo),
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().pr_url).toBe('https://github.com/mock/mock/pull/1');

    const second = await server.inject({
      method: 'POST',
      url: `/agents/${agent.id}/export-ci`,
      payload: body(repo),
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().pr_url).toBe('https://github.com/mock/mock/pull/1');

    const rows = await pg.handle.db
      .select()
      .from(t.ciInstallations)
      .where(and(eq(t.ciInstallations.agentId, agent.id), eq(t.ciInstallations.repo, repo)));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.targetType).toBe('gha');
    expect(rows[0]!.agentVersion).toBe(agent.version);

    // Two commits onto the same branch, one PR — never a second one, and never
    // a commit on the base branch.
    expect(github.committed).toHaveLength(2);
    expect(github.committed.every((c) => c.branch === 'devdigest/ci')).toBe(true);
    expect(github.committed.every((c) => c.base === 'main')).toBe(true);
    expect(github.openedPrs).toHaveLength(1);
    expect(github.openedPrs[0]!.title).toBe('Add DevDigest CI review');
    expect(github.openedPrs[0]!.body).toContain(repo);
    // The count in the PR text follows the generated list, never a constant.
    expect(github.openedPrs[0]!.body).toContain('5 generated files');

    await server.close();
  });

  it('writes every file in ONE commit (AC-39)', async () => {
    const agent = await makeAgent();
    const github = new MockGitHubClient({});
    const server = await appWith(github);
    await server.inject({
      method: 'POST',
      url: `/agents/${agent.id}/export-ci`,
      payload: body('acme/one-commit'),
    });
    expect(github.committed).toHaveLength(1);
    const paths = github.committed[0]!.files.map((f) => f.path);
    // The manifest's name is the agent's slug, and `makeAgent` numbers agents
    // so the suite can run its cases independently — matched by shape, so the
    // assertion does not break the day a case is added above this one.
    expect(paths[0]).toMatch(/^\.devdigest\/agents\/security-reviewer-\d+\.yaml$/);
    expect(paths.slice(1, 4)).toEqual([
      '.devdigest/memory.jsonl',
      '.devdigest/runner.mjs',
      '.devdigest/.gitattributes',
    ]);
    // AC-135: the same slug as the manifest, behind the fixed prefix.
    expect(paths[4]).toMatch(/^\.github\/workflows\/devdigest-review-security-reviewer-\d+\.yml$/);
    await server.close();
  });

  it('removes the legacy shared workflow in that SAME commit (AC-146)', async () => {
    const agent = await makeAgent();
    const github = new MockGitHubClient({});
    const server = await appWith(github);
    await server.inject({
      method: 'POST',
      url: `/agents/${agent.id}/export-ci`,
      payload: body('acme/legacy-removal'),
    });
    // One commit, carrying both halves — never a second commit and never a
    // window in which the repository has two workflows for this agent or none.
    expect(github.committed).toHaveLength(1);
    expect(github.committed[0]!.deletions).toEqual(['.github/workflows/devdigest-review.yml']);
    await server.close();
  });

  it('lets two agents live in one repository, each with its own file (AC-136)', async () => {
    const security = await makeAgent('Security Reviewer');
    const general = await makeAgent('General Reviewer');
    const github = new MockGitHubClient({});
    const server = await appWith(github);
    const repo = 'acme/two-agents';

    for (const agent of [security, general]) {
      const res = await server.inject({
        method: 'POST',
        url: `/agents/${agent.id}/export-ci`,
        payload: body(repo),
      });
      expect(res.statusCode).toBe(200);
    }

    const workflows = github.committed.map(
      (c) => c.files.find((f) => f.path.startsWith('.github/workflows/'))!.path,
    );
    expect(workflows[0]).not.toBe(workflows[1]);
    // Neither publication asks for the other's file to go: the only removal is
    // the legacy shared one.
    expect(github.committed[1]!.deletions).not.toContain(workflows[0]);
    expect(github.committed[0]!.deletions).not.toContain(workflows[1]);

    const rows = await pg.handle.db
      .select()
      .from(t.ciInstallations)
      .where(eq(t.ciInstallations.repo, repo));
    expect(rows).toHaveLength(2);
    await server.close();
  });

  it('refuses to publish an agent whose slug another agent already owns here (AC-137)', async () => {
    // Per-agent paths do not make every pair of agents safe — only the pairs
    // that slugify differently. "Payments Guard" and "payments guard!" do not.
    const [first] = await pg.handle.db
      .insert(t.agents)
      .values({
        workspaceId,
        name: `Payments Guard ${seq}`,
        provider: 'openrouter',
        model: 'anthropic/claude-sonnet-4',
        systemPrompt: 'Review.',
      })
      .returning();
    const [second] = await pg.handle.db
      .insert(t.agents)
      .values({
        workspaceId,
        name: `payments guard ${seq++}!`,
        provider: 'openrouter',
        model: 'anthropic/claude-sonnet-4',
        systemPrompt: 'Review.',
      })
      .returning();

    const github = new MockGitHubClient({});
    const server = await appWith(github);
    const repo = 'acme/slug-collision';

    expect(
      (
        await server.inject({
          method: 'POST',
          url: `/agents/${first!.id}/export-ci`,
          payload: body(repo),
        })
      ).statusCode,
    ).toBe(200);

    const clash = await server.inject({
      method: 'POST',
      url: `/agents/${second!.id}/export-ci`,
      payload: body(repo),
    });
    expect(clash.statusCode).toBe(422);
    // NAMED: the other agent, and the file both would write.
    expect(clash.json().error.message).toContain(first!.name);
    expect(clash.json().error.message).toContain('.github/workflows/devdigest-review-payments-guard');

    // Nothing was published and no second row was written.
    expect(github.committed).toHaveLength(1);
    const rows = await pg.handle.db
      .select()
      .from(t.ciInstallations)
      .where(eq(t.ciInstallations.repo, repo));
    expect(rows).toHaveLength(1);
    await server.close();
  });

  it('writes NO row when GitHub refuses the write (AC-43)', async () => {
    const agent = await makeAgent();
    const server = await appWith(new RefusingGitHub({}));
    const repo = 'acme/no-permission';

    const res = await server.inject({
      method: 'POST',
      url: `/agents/${agent.id}/export-ci`,
      payload: body(repo),
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.json().error.message).toContain('not accessible');

    const rows = await pg.handle.db
      .select()
      .from(t.ciInstallations)
      .where(eq(t.ciInstallations.repo, repo));
    expect(rows).toHaveLength(0);
    await server.close();
  });

  it('writes no row and calls no GitHub for action "files" and for the zip (AC-7, AC-44)', async () => {
    const agent = await makeAgent();
    const github = new MockGitHubClient({});
    const server = await appWith(github);
    const repo = 'acme/preview-only';

    const preview = await server.inject({
      method: 'POST',
      url: `/agents/${agent.id}/export-ci`,
      payload: body(repo, { action: 'files' }),
    });
    expect(preview.statusCode).toBe(200);
    const zip = await server.inject({
      method: 'POST',
      url: `/agents/${agent.id}/export-ci/zip`,
      payload: body(repo),
    });
    expect(zip.statusCode).toBe(200);

    expect(github.committed).toEqual([]);
    expect(github.openedPrs).toEqual([]);
    const rows = await pg.handle.db
      .select()
      .from(t.ciInstallations)
      .where(eq(t.ciInstallations.repo, repo));
    expect(rows).toHaveLength(0);
    await server.close();
  });

  it('ships memory.jsonl empty and carries nothing out of the database (AC-95, AC-96)', async () => {
    const agent = await makeAgent();
    const server = await appWith(new MockGitHubClient({}));
    const res = await server.inject({
      method: 'POST',
      url: `/agents/${agent.id}/export-ci`,
      payload: body('acme/memory', { action: 'files' }),
    });
    const files: { path: string; contents: string }[] = res.json().files;
    const memory = files.find((f) => f.path === '.devdigest/memory.jsonl');
    expect(memory?.contents).toBe('');

    const whole = files.map((f) => f.contents).join('\n');
    // The accepted convention exists in this very workspace and must not be in
    // a file committed to someone else's repository.
    expect(whole).not.toContain(CONVENTION_RULE);
    expect(whole).not.toContain(OPENROUTER_KEY);
    await server.close();
  });

  it('carries the agent’s stored ci_fail_on into the manifest, including a value the tab cannot send (AC-26)', async () => {
    const agent = await makeAgent();
    await pg.handle.db
      .update(t.agents)
      .set({ ciFailOn: 'any' })
      .where(eq(t.agents.id, agent.id));
    const server = await appWith(new MockGitHubClient({}));
    const res = await server.inject({
      method: 'POST',
      url: `/agents/${agent.id}/export-ci`,
      payload: body('acme/fail-on', { action: 'files' }),
    });
    const manifest = res
      .json()
      .files.find((f: { path: string }) => f.path.startsWith('.devdigest/agents/'));
    expect(manifest.contents).toContain('ci_fail_on: any');
    await server.close();
  });

  it('refuses a hand-edited workflow that is not YAML, naming the line, and commits nothing (AC-55)', async () => {
    const agent = await makeAgent();
    const github = new MockGitHubClient({});
    const server = await appWith(github);
    const res = await server.inject({
      method: 'POST',
      url: `/agents/${agent.id}/export-ci`,
      payload: body('acme/hand-edited', {
        workflow: 'name: x\non:\n  pull_request:\n\ttypes: [opened]\n',
      }),
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.message).toContain('line 4');
    expect(github.committed).toEqual([]);
    const rows = await pg.handle.db
      .select()
      .from(t.ciInstallations)
      .where(eq(t.ciInstallations.repo, 'acme/hand-edited'));
    expect(rows).toHaveLength(0);
    await server.close();
  });

  it('lists the installation on the agent’s CI tab, with staleness after a version bump (AC-85, AC-90)', async () => {
    const agent = await makeAgent();
    const server = await appWith(new MockGitHubClient({}));
    await server.inject({
      method: 'POST',
      url: `/agents/${agent.id}/export-ci`,
      payload: body('acme/stale-check'),
    });

    const fresh = await server.inject({ method: 'GET', url: `/agents/${agent.id}/ci` });
    expect(fresh.json()).toHaveLength(1);
    expect(fresh.json()[0].stale).toBe(false);
    expect(fresh.json()[0].last_run_status).toBeNull();
    // AC-148: the row exists because DevDigest published a bundle, which is not
    // evidence that the workflow runs. Nothing has polled it yet.
    expect(fresh.json()[0].unconfirmed_reason).toBe('never_polled');
    expect(fresh.json()[0].workflow_path).toMatch(
      /^\.github\/workflows\/devdigest-review-security-reviewer-\d+\.yml$/,
    );

    await pg.handle.db
      .update(t.agents)
      .set({ version: agent.version + 1 })
      .where(eq(t.agents.id, agent.id));
    const stale = await server.inject({ method: 'GET', url: `/agents/${agent.id}/ci` });
    expect(stale.json()[0].stale).toBe(true);
    await server.close();
  });
});
