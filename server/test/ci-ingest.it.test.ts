/**
 * P3.6 — the ingest WRITE, over a real Postgres.
 *
 * The properties here are the database's, not the service's, and that is the
 * whole point: uniqueness per (`repo`, `workflow_run_id`) is a unique index and
 * one `onConflictDoUpdate` statement, never a read followed by a write. Two
 * ingest passes over the same run both find no row under a `select`-then-insert,
 * both insert, and neither fails — which is invisible to every hermetic test in
 * this repository.
 *
 * The "unrecognised state is LOGGED" half of AC-132 is asserted in the hermetic
 * `ci-ingest.test.ts`, where the logger is a spy. Here the app's logger is
 * silent under NODE_ENV=test, so this file asserts the half that survives into
 * the table: the row exists and its state is empty.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { zipSync, strToU8 } from 'fflate';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockAuthProvider, MockGitHubClient, MockSecretsProvider } from '../src/adapters/mocks.js';
import type { RepoRef, WorkflowRunRef } from '@devdigest/shared';
import * as t from '../src/db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;
const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const REPO = 'acme/payments-api';
const RUN_ID = 900_100_200_300;
const ARTIFACT_ID = 5001;

let pg: PgFixture;
let workspaceId: string;
let agentId: string;
let installationId: string;

const RUN: WorkflowRunRef = {
  id: RUN_ID,
  head_sha: 'de50d5c364fb',
  status: 'completed',
  conclusion: 'success',
  pr_number: 42,
  html_url: `https://github.com/${REPO}/actions/runs/${RUN_ID}`,
  run_started_at: '2026-08-26T10:00:00Z',
  updated_at: '2026-08-26T10:04:00Z',
  repository: REPO,
};

const ARTIFACT = {
  findings_count: 2,
  cost_usd: 0.014,
  duration_ms: 42_000,
  // The SLUG, which is what the runner copies out of `DEVDIGEST_AGENT` — and
  // what the ingest now compares against the installation's own (AC-143).
  agent: 'security-reviewer',
  version: '0.1.0',
  pr_number: 42,
  status: 'succeeded',
  verdict: 'comment',
};

function archive(body: unknown): Uint8Array {
  return zipSync({ 'devdigest-result.json': strToU8(JSON.stringify(body)) });
}

/** Throws for ONE repository only — the sibling must still be polled and stamped. */
class PartlyBlindGitHub extends MockGitHubClient {
  constructor(
    private blindRepo: string,
    opts: ConstructorParameters<typeof MockGitHubClient>[0],
  ) {
    super(opts);
  }
  override async listWorkflowRuns(
    repo: RepoRef,
    workflowFile: string,
    opts: { perPage?: number } = {},
  ): Promise<WorkflowRunRef[] | null> {
    if (`${repo.owner}/${repo.name}` === this.blindRepo) {
      throw new Error('Resource not accessible by integration');
    }
    return super.listWorkflowRuns(repo, workflowFile, opts);
  }
}

function github(artifact: unknown, runs: WorkflowRunRef[] = [RUN]) {
  return new MockGitHubClient({
    workflowRuns: runs,
    runArtifacts: Object.fromEntries(
      runs.map((r) => [
        r.id,
        [{ id: ARTIFACT_ID, name: 'devdigest-result', size_in_bytes: 500, expired: false }],
      ]),
    ),
    artifactZips: { [ARTIFACT_ID]: archive(artifact) },
  });
}

function appWith(gh: MockGitHubClient) {
  return buildApp({
    config: config(),
    db: pg.handle.db,
    overrides: {
      auth: new MockAuthProvider(undefined, { id: workspaceId, name: 'default' }),
      secrets: new MockSecretsProvider({}),
      github: gh,
    },
  });
}

async function refresh(gh: MockGitHubClient, force = true) {
  const server = await appWith(gh);
  const res = await server.inject({ method: 'POST', url: '/ci/runs/refresh', payload: { force } });
  await server.close();
  return res;
}

async function installation(repo: string, lastPolledAt: Date | null = null) {
  const [row] = await pg.handle.db
    .insert(t.ciInstallations)
    .values({ agentId, repo, targetType: 'gha', agentVersion: 1, lastPolledAt })
    .returning();
  return row!;
}

const rowsFor = (repo: string) =>
  pg.handle.db.select().from(t.ciRuns).where(eq(t.ciRuns.repo, repo));

d('ci ingest — the write', () => {
  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
    const [agent] = await pg.handle.db
      .insert(t.agents)
      .values({
        workspaceId,
        name: 'Security Reviewer',
        provider: 'openrouter',
        model: 'anthropic/claude-sonnet-4',
        systemPrompt: 'Review.',
      })
      .returning();
    agentId = agent!.id;
  });

  beforeEach(async () => {
    await pg.handle.db.delete(t.ciRuns);
    await pg.handle.db.delete(t.agentRuns);
    await pg.handle.db.delete(t.ciInstallations);
    installationId = (await installation(REPO)).id;
  });

  afterAll(async () => {
    await pg?.stop();
  });

  it('leaves ONE row for a run polled twice, and the second pass wins (AC-75, AC-124, AC-125)', async () => {
    await refresh(github(ARTIFACT));
    await refresh(github({ ...ARTIFACT, findings_count: 7, verdict: 'request_changes' }));

    const rows = await rowsFor(REPO);
    expect(rows).toHaveLength(1);
    // The UPDATE half actually ran — a silent no-op would leave the first values.
    expect(rows[0]!.findingsCount).toBe(7);
    expect(rows[0]!.verdict).toBe('request_changes');
    expect(rows[0]!.workflowRunId).toBe(RUN_ID);
    expect(rows[0]!.ciInstallationId).toBe(installationId);
  });

  it('adds the run to the history once, not once per poll (AC-76)', async () => {
    await refresh(github(ARTIFACT));
    await refresh(github(ARTIFACT));
    const history = await pg.handle.db
      .select()
      .from(t.agentRuns)
      .where(eq(t.agentRuns.agentId, agentId));
    expect(history).toHaveLength(1);
    expect(history[0]!.source).toBe('ci');
    expect(history[0]!.findingsCount).toBe(2);
    expect(history[0]!.costUsd).toBeCloseTo(0.014);
    expect(history[0]!.durationMs).toBe(42_000);
    // The PR was never imported into this workspace, so there is nothing to
    // attach it to — and inventing a `pull_requests` row would put a PR on
    // screens that never imported it.
    expect(history[0]!.prId).toBeNull();
  });

  it('creates a row with empty state and verdict for an older bundle’s artifact (AC-118)', async () => {
    await refresh(github({ ...ARTIFACT, status: undefined, verdict: undefined }));
    const rows = await rowsFor(REPO);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBeNull();
    expect(rows[0]!.verdict).toBeNull();
    // Everything the older bundle DID write is still stored.
    expect(rows[0]!.findingsCount).toBe(2);
    expect(rows[0]!.headSha).toBe('de50d5c364fb');
    expect(rows[0]!.bundleVersion).toBe('0.1.0');
  });

  it('creates a row with an empty state for a state this build does not carry (AC-132)', async () => {
    await refresh(github({ ...ARTIFACT, status: 'cancelled' }));
    const rows = await rowsFor(REPO);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBeNull();
    // The unrecognised value is dropped, never stored.
    expect(rows[0]!.status).not.toBe('cancelled');
  });

  it('writes a skipped run as skipped — not failed, not no_findings (AC-131)', async () => {
    await refresh(
      github({ ...ARTIFACT, status: 'skipped', reason: 'fork pull request', findings_count: 0 }),
    );
    const rows = await rowsFor(REPO);
    expect(rows[0]!.status).toBe('skipped');
  });

  it('surfaces the run on GET /ci/runs with seconds, not milliseconds', async () => {
    await refresh(github(ARTIFACT));
    const server = await appWith(github(ARTIFACT));
    const res = await server.inject({ method: 'GET', url: '/ci/runs' });
    await server.close();

    expect(res.statusCode).toBe(200);
    const page = res.json();
    expect(page.runs).toHaveLength(1);
    expect(page.runs[0].duration_s).toBe(42);
    expect(page.runs[0].repo).toBe(REPO);
    expect(page.runs[0].pr_number).toBe(42);
    expect(page.last_polled_at).not.toBeNull();
  });

  it('stamps last_polled_at only on the poll that returned (AC-128, AC-129)', async () => {
    const before = new Date('2026-08-01T00:00:00.000Z');
    await pg.handle.db.delete(t.ciInstallations);
    const blind = await installation('acme/no-actions-access', before);
    const seeing = await installation(REPO, before);

    const res = await refresh(
      new PartlyBlindGitHub('acme/no-actions-access', {
        workflowRuns: [RUN],
        runArtifacts: {
          [RUN_ID]: [
            { id: ARTIFACT_ID, name: 'devdigest-result', size_in_bytes: 500, expired: false },
          ],
        },
        artifactZips: { [ARTIFACT_ID]: archive(ARTIFACT) },
      }),
    );

    expect(res.json().errors).toEqual([
      { repo: 'acme/no-actions-access', reason: 'Resource not accessible by integration' },
    ]);

    const [blindRow] = await pg.handle.db
      .select()
      .from(t.ciInstallations)
      .where(eq(t.ciInstallations.id, blind.id));
    const [seeingRow] = await pg.handle.db
      .select()
      .from(t.ciInstallations)
      .where(eq(t.ciInstallations.id, seeing.id));

    // The failed poll left the stored value exactly where it was, so the AC-84
    // timestamp keeps naming the last poll that actually returned data and the
    // AC-121 window is not restarted by a failure.
    expect(blindRow!.lastPolledAt?.toISOString()).toBe(before.toISOString());
    expect(seeingRow!.lastPolledAt!.getTime()).toBeGreaterThan(before.getTime());
  });

  it('records the workflow as missing, and the tab says so (AC-147)', async () => {
    // The repository answered; it simply has no workflow by that name — the
    // state every installation is in until its pull request is merged.
    const gh = new MockGitHubClient({
      runsByWorkflow: { 'devdigest-review-security-reviewer.yml': null },
    });
    const res = await refresh(gh);
    expect(res.json().errors).toEqual([]);

    const [row] = await pg.handle.db
      .select()
      .from(t.ciInstallations)
      .where(eq(t.ciInstallations.id, installationId));
    expect(row!.workflowPresent).toBe(false);
    expect(row!.lastPolledAt).not.toBeNull();

    const server = await appWith(gh);
    const tab = await server.inject({ method: 'GET', url: `/agents/${agentId}/ci` });
    await server.close();
    expect(tab.json()[0].unconfirmed_reason).toBe('workflow_missing');
    expect(tab.json()[0].workflow_path).toBe(
      '.github/workflows/devdigest-review-security-reviewer.yml',
    );
  });

  it('refuses a run whose artifact names another agent, and names it on the tab (AC-143, AC-149)', async () => {
    const res = await refresh(github({ ...ARTIFACT, agent: 'general-reviewer' }));
    expect(res.json().errors).toEqual([]);
    // AC-143: no row at all, the same shape as AC-74's refusals.
    expect(await rowsFor(REPO)).toHaveLength(0);

    const server = await appWith(github(ARTIFACT));
    const tab = await server.inject({ method: 'GET', url: `/agents/${agentId}/ci` });
    await server.close();
    expect(tab.json()[0].unconfirmed_reason).toBe('other_agent');
    expect(tab.json()[0].observed_agent).toBe('general-reviewer');
  });

  it('never re-attributes an existing row to whoever polled last (AC-144)', async () => {
    await refresh(github(ARTIFACT));
    const [first] = await rowsFor(REPO);
    expect(first!.ciInstallationId).toBe(installationId);

    // A second installation in the same repository, for a second agent — and a
    // run id that already exists. Nothing may move the row to it.
    const [other] = await pg.handle.db
      .insert(t.agents)
      .values({
        workspaceId,
        name: 'General Reviewer',
        provider: 'openrouter',
        model: 'anthropic/claude-sonnet-4',
        systemPrompt: 'Review.',
      })
      .returning();
    const [otherInstall] = await pg.handle.db
      .insert(t.ciInstallations)
      .values({ agentId: other!.id, repo: REPO, targetType: 'gha', agentVersion: 1 })
      .returning();

    const gh = new MockGitHubClient({
      runsByWorkflow: {
        'devdigest-review-security-reviewer.yml': [],
        'devdigest-review-general-reviewer.yml': [RUN],
      },
      runArtifacts: {
        [RUN_ID]: [
          { id: ARTIFACT_ID, name: 'devdigest-result', size_in_bytes: 500, expired: false },
        ],
      },
      artifactZips: { [ARTIFACT_ID]: archive({ ...ARTIFACT, agent: 'general-reviewer' }) },
    });
    await refresh(gh);

    const rows = await rowsFor(REPO);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.ciInstallationId).toBe(installationId);
    expect(rows[0]!.ciInstallationId).not.toBe(otherInstall!.id);

    await pg.handle.db.delete(t.ciInstallations).where(eq(t.ciInstallations.id, otherInstall!.id));
    await pg.handle.db.delete(t.agents).where(eq(t.agents.id, other!.id));
  });

  it('does not poll again inside the five-minute window (AC-121)', async () => {
    const gh = github(ARTIFACT);
    await refresh(gh, true);
    expect(gh.polledWorkflows).toHaveLength(1);

    const second = github(ARTIFACT);
    await refresh(second, false);
    expect(second.polledWorkflows).toEqual([]);
    // …and the stored rows are still what the page gets back.
    const page = await refresh(github(ARTIFACT), false);
    expect(page.json().runs).toHaveLength(1);
  });
});
