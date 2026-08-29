import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockGitClient, MockGitHubClient } from '../src/adapters/mocks.js';
import type { AgentPerf, AgentPerfDetail } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[performance] Docker not available — skipping integration tests.');
}

/**
 * Agent Performance over real rows (SPEC-07).
 *
 * The claim worth a real Postgres is the one the aggregation cannot make on its
 * own: that the counted-run predicate, the findings join and the grouping behave
 * in SQL the way `helpers.test.ts` assumes they do. The strongest case here is
 * the last one — `GET /agents/:id/stats` returning byte-for-byte the row
 * `GET /agents/performance` puts in its table (AC-46).
 */
d('Agent Performance', () => {
  let pg: PgFixture;
  let app: Awaited<ReturnType<typeof makeApp>>;
  let workspaceId: string;
  let prId: string;
  let securityId: string;
  let quietId: string;

  function makeApp() {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    return buildApp({
      config,
      db: pg.handle.db,
      overrides: { git: new MockGitClient(), github: new MockGitHubClient() },
    });
  }

  const HOUR = 3_600_000;
  const now = Date.now();
  const ago = (ms: number) => new Date(now - ms);

  beforeAll(async () => {
    pg = await startPg();
    const seeded = await seed(pg.handle.db);
    workspaceId = seeded.workspaceId;

    const [pr] = await pg.handle.db.select().from(t.pullRequests).limit(1);
    prId = pr!.id;

    const [security] = await pg.handle.db
      .insert(t.agents)
      .values({
        workspaceId,
        name: 'Security Reviewer',
        provider: 'openai',
        model: 'gpt-4.1',
        systemPrompt: 'Review the diff.',
      })
      .returning({ id: t.agents.id });
    securityId = security!.id;

    const [quiet] = await pg.handle.db
      .insert(t.agents)
      .values({
        workspaceId,
        name: 'Quiet Reviewer',
        provider: 'openai',
        model: 'gpt-4o-mini',
        systemPrompt: 'Review the diff.',
      })
      .returning({ id: t.agents.id });
    quietId = quiet!.id;

    // Three counted runs for Security Reviewer, inside the window.
    const runs = await pg.handle.db
      .insert(t.agentRuns)
      .values([
        {
          workspaceId,
          agentId: securityId,
          prId,
          ranAt: ago(2 * HOUR),
          model: 'gpt-4.1',
          status: 'done',
          durationMs: 6_000,
          costUsd: 0.04,
        },
        {
          workspaceId,
          agentId: securityId,
          prId,
          ranAt: ago(3 * HOUR),
          model: 'gpt-4o',
          status: 'done',
          durationMs: 8_000,
          costUsd: 0.06,
        },
        // Counted, but priced and timed by nothing — a failed run still burned
        // tokens, and its absence from the averages must be visible, not silent.
        {
          workspaceId,
          agentId: securityId,
          prId,
          ranAt: ago(4 * HOUR),
          model: 'gpt-4.1',
          status: 'failed',
          durationMs: null,
          costUsd: null,
        },
        // Not counted: outside a 1-day window, inside a 30-day one.
        {
          workspaceId,
          agentId: securityId,
          prId,
          ranAt: ago(120 * HOUR),
          model: 'gpt-4.1',
          status: 'done',
          durationMs: 1_000,
          costUsd: 1,
        },
      ])
      .returning({ id: t.agentRuns.id, ranAt: t.agentRuns.ranAt });

    // Findings of the first counted run: 2 accepted, 1 dismissed, 1 untouched.
    const [review] = await pg.handle.db
      .insert(t.reviews)
      .values({ workspaceId, prId, agentId: securityId, runId: runs[0]!.id, kind: 'review' })
      .returning({ id: t.reviews.id });

    await pg.handle.db.insert(t.findings).values(
      (
        [
          ['CRITICAL', new Date(), null],
          ['WARNING', new Date(), null],
          ['WARNING', null, new Date()],
          ['SUGGESTION', null, null],
        ] as const
      ).map(([severity, acceptedAt, dismissedAt], i) => ({
        reviewId: review!.id,
        file: `src/file-${i}.ts`,
        startLine: 1,
        endLine: 2,
        severity,
        category: 'bug',
        title: `Finding ${i}`,
        rationale: 'because',
        confidence: 0.9,
        acceptedAt,
        dismissedAt,
      })),
    );

    // ONE app for the whole suite, built before the in-flight runs below exist.
    //
    // `buildApp` reaps on boot: a run still `running` or `queued` belonged to a
    // process that is gone, so the engine closes it into a terminal status
    // (`reviews/repository.ts`). Build the app after inserting them and the two
    // rows this suite needs to stay in flight are terminal — and counted — by the
    // time the first assertion runs.
    app = await makeApp();

    await pg.handle.db.insert(t.agentRuns).values([
      {
        workspaceId,
        agentId: securityId,
        prId,
        ranAt: ago(1 * HOUR),
        model: 'gpt-4.1',
        status: 'running',
        costUsd: 99,
      },
      {
        workspaceId,
        agentId: securityId,
        prId,
        ranAt: ago(1 * HOUR),
        model: 'gpt-4.1',
        status: 'queued',
        costUsd: 99,
      },
    ]);
  });

  afterAll(async () => {
    await app?.close();
    await pg?.stop();
  });

  async function dashboard(query = 'range=1d'): Promise<AgentPerf> {
    const res = await app.inject({ method: 'GET', url: `/agents/performance?${query}` });
    expect(res.statusCode, res.body).toBe(200);
    return res.json() as AgentPerf;
  }

  it('counts only terminal runs inside the window', async () => {
    const perf = await dashboard('range=1d');
    expect(perf.summary.runs).toBe(3);
    const row = perf.agents.find((a) => a.agent_id === securityId)!;
    expect(row.runs).toBe(3);
    expect(row.runs_with_cost).toBe(2);
    expect(row.runs_without_cost).toBe(1);
  });

  it('widens with the period rather than re-counting the same runs', async () => {
    const month = await dashboard('range=30d');
    expect(month.summary.runs).toBe(4);
  });

  it('sums cost over the runs that have one, and says how many did not', async () => {
    const perf = await dashboard('range=1d');
    expect(perf.summary.total_cost_usd!.toFixed(6)).toBe('0.100000');
    expect(perf.summary.runs_without_cost).toBe(1);
    const row = perf.agents.find((a) => a.agent_id === securityId)!;
    expect(row.avg_cost_usd!.toFixed(6)).toBe('0.050000');
    expect(row.avg_duration_ms).toBe(7_000);
  });

  it('reads accept rate off the findings of the counted runs, with its denominator', async () => {
    const row = (await dashboard('range=1d')).agents.find((a) => a.agent_id === securityId)!;
    expect(row.findings_total).toBe(4);
    expect(row.accepted).toBe(2);
    expect(row.dismissed).toBe(1);
    expect(row.pending).toBe(1);
    expect(row.judged).toBe(3);
    expect(row.accept_rate).toBeCloseTo(2 / 3, 10);
    expect(row.low_sample).toBe(true);
    expect(row.findings_by_severity).toEqual({ CRITICAL: 1, WARNING: 2, SUGGESTION: 1 });
  });

  it('keeps an agent that never ran in the table, as zeros and dashes', async () => {
    const row = (await dashboard('range=1d')).agents.find((a) => a.agent_id === quietId)!;
    expect(row.runs).toBe(0);
    expect(row.total_cost_usd).toBeNull();
    expect(row.avg_duration_ms).toBeNull();
    expect(row.accept_rate).toBeNull();
    expect(row.last_run_at).toBeNull();
  });

  it('names the most-active agent by run count and echoes the window', async () => {
    const perf = await dashboard('range=1d');
    expect(perf.summary.most_active_agent?.agent_id).toBe(securityId);
    expect(perf.summary.most_active_agent?.runs).toBe(3);
    expect(perf.period.kind).toBe('1d');
    expect(new Date(perf.period.to).getTime() - new Date(perf.period.from).getTime()).toBe(
      24 * HOUR,
    );
  });

  it('splits the same total two ways', async () => {
    const perf = await dashboard('range=1d');
    const total = perf.summary.total_cost_usd!;
    expect(perf.cost_by_agent.reduce((n, s) => n + s.value, 0).toFixed(6)).toBe(total.toFixed(6));
    expect(perf.cost_by_model.reduce((n, s) => n + s.value, 0).toFixed(6)).toBe(total.toFixed(6));
    expect(perf.cost_by_model.map((s) => s.label).sort()).toEqual(['gpt-4.1', 'gpt-4o']);
  });

  it('says every figure is an estimate', async () => {
    expect((await dashboard('range=1d')).cost_basis).toBe('estimated');
  });

  it("serves the agent's Stats tab the very row the dashboard drew", async () => {
    const perf = await dashboard('range=1d');
    const res = await app.inject({ method: 'GET', url: `/agents/${securityId}/stats?range=1d` });
    expect(res.statusCode, res.body).toBe(200);
    const detail = res.json() as AgentPerfDetail;
    expect(detail.agent).toEqual(perf.agents.find((a) => a.agent_id === securityId));
    expect(detail.min_decisions_for_rank).toBe(perf.min_decisions_for_rank);
    expect(detail.cost_basis).toBe(perf.cost_basis);
  });

  it('refuses a custom range that has no bounds, and one that runs backwards', async () => {
    const noBounds = await app.inject({ method: 'GET', url: '/agents/performance?range=custom' });
    expect(noBounds.statusCode).toBe(422);

    const backwards = await app.inject({
      method: 'GET',
      url: '/agents/performance?range=custom&from=2026-08-29T00:00:00Z&to=2026-08-01T00:00:00Z',
    });
    expect(backwards.statusCode).toBe(422);
  });

  it('answers 404 for an agent this workspace does not have', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/agents/00000000-0000-4000-8000-000000000000/stats',
    });
    expect(res.statusCode).toBe(404);
  });

  it('leaves the runs of a deleted agent in the total, named as their own', async () => {
    const [orphan] = await pg.handle.db
      .insert(t.agents)
      .values({
        workspaceId,
        name: 'About To Go',
        provider: 'openai',
        model: 'gpt-4o-mini',
        systemPrompt: 'Review the diff.',
      })
      .returning({ id: t.agents.id });

    await pg.handle.db.insert(t.agentRuns).values({
      workspaceId,
      agentId: orphan!.id,
      prId,
      ranAt: ago(2 * HOUR),
      model: 'gpt-4o-mini',
      status: 'done',
      durationMs: 500,
      costUsd: 0.02,
    });
    await pg.handle.db
      .delete(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.id, orphan!.id)));

    const perf = await dashboard('range=1d');
    expect(perf.summary.runs).toBe(4);
    expect(perf.summary.runs_without_agent).toBe(1);
    expect(perf.agents.some((a) => a.agent_id === orphan!.id)).toBe(false);

    const total = perf.summary.total_cost_usd!;
    expect(perf.cost_by_agent.reduce((n, s) => n + s.value, 0).toFixed(6)).toBe(total.toFixed(6));
    expect(perf.cost_by_agent.find((s) => s.agent_id === null)?.value).toBeCloseTo(0.02, 10);
  });
});
