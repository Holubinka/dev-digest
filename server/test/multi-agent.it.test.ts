/**
 * Multi-Agent Review end to end, against a real Postgres (SPEC-05).
 *
 * This is the only place several of P2's guarantees can be exercised at all: the
 * creation transaction, the workspace scoping of three different ids, the FK
 * cascade when a run is deleted, the column of an agent that no longer exists,
 * and — the one that matters most — a FAILED run's takes coming back
 * `not_reviewed` through the real persistence path, where `persistFailure`
 * writes no `reviews` row and so leaves exactly the "no findings" shape a `done`
 * agent that flagged nothing leaves (AC-120).
 *
 * Shape borrowed from `reviews.it.test.ts`: testcontainers Postgres, `buildApp`
 * with mock adapters, `waitForPrRuns` before reading anything the background
 * executor writes.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { waitForPrRuns } from './helpers/runs.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import {
  MockLLMProvider,
  MockEmbedder,
  MockGitClient,
  MockSecretsProvider,
} from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import { and, eq } from 'drizzle-orm';
import type { LLMProvider, Review, StructuredRequest, StructuredResult } from '@devdigest/shared';

/** Poll until the executor's continuation has stamped `finished_at` (AC-155). */
async function waitForMultiRunFinish(
  db: PgFixture['handle']['db'],
  multiRunId: string,
  timeoutMs = 10_000,
): Promise<void> {
  const start = Date.now();
  for (;;) {
    const [row] = await db
      .select({ finishedAt: t.multiAgentRuns.finishedAt })
      .from(t.multiAgentRuns)
      .where(eq(t.multiAgentRuns.id, multiRunId));
    if (row?.finishedAt) return;
    if (Date.now() - start > timeoutMs) return;
    await new Promise((r) => setTimeout(r, 25));
  }
}

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,`;

/** One grounded finding on line 11, so every successful run leaves one behind. */
const REVIEW_FIXTURE: Review = {
  verdict: 'request_changes',
  summary: 'Hardcoded Stripe secret introduced.',
  score: 42,
  findings: [
    {
      id: 'f-valid',
      severity: 'CRITICAL',
      category: 'security',
      title: 'Hardcoded Stripe secret key',
      file: 'src/config.ts',
      start_line: 11,
      end_line: 11,
      rationale: 'A live Stripe key is committed in source.',
      suggestion: 'Move the key to an environment variable.',
      confidence: 0.95,
      kind: 'finding',
    },
  ],
};

/** A provider that fails every structured call — one agent's run, not the batch. */
class ExplodingProvider implements LLMProvider {
  readonly id = 'anthropic' as const;
  private inner = new MockLLMProvider('anthropic', { structured: REVIEW_FIXTURE });
  listModels() {
    return this.inner.listModels();
  }
  complete(req: Parameters<LLMProvider['complete']>[0]) {
    return this.inner.complete(req);
  }
  embed(texts: string[]) {
    return this.inner.embed(texts);
  }
  async completeStructured<T>(_req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    throw new Error('provider is down');
  }
}

/** A provider whose structured calls block until the test releases them. */
class GatedProvider implements LLMProvider {
  readonly id = 'openai' as const;
  private inner = new MockLLMProvider('openai', { structured: REVIEW_FIXTURE });
  private waiters: (() => void)[] = [];
  open = false;
  /** How many times a model was actually asked for a review — i.e. what it cost. */
  calls = 0;
  listModels() {
    return this.inner.listModels();
  }
  complete(req: Parameters<LLMProvider['complete']>[0]) {
    return this.inner.complete(req);
  }
  embed(texts: string[]) {
    return this.inner.embed(texts);
  }
  async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    this.calls++;
    if (!this.open) await new Promise<void>((resolve) => this.waiters.push(resolve));
    return this.inner.completeStructured(req);
  }
  release() {
    this.open = true;
    for (const resolve of this.waiters.splice(0)) resolve();
  }
}

let repoSeq = 0;
async function setupRepoAndPr(db: PgFixture['handle']['db'], workspaceId: string) {
  const name = `payments-api-${repoSeq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning();
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId: repo!.id,
      number: 482,
      title: 'Add rate limiting',
      author: 'marisa.koch',
      branch: 'feat/rl',
      base: 'main',
      headSha: 'a1b2c3d4',
      additions: 1,
      deletions: 0,
      filesCount: 1,
      status: 'needs_review',
      body: 'Add rate limiting.',
    })
    .returning();
  await db.insert(t.prFiles).values({
    prId: pr!.id,
    path: 'src/config.ts',
    additions: 1,
    deletions: 0,
    patch: '@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "sk_live_xxx",\n   redisUrl: x,',
  });
  return { repo: repo!, pr: pr! };
}

d('SPEC-05 multi-agent review (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let otherWorkspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
    const [other] = await pg.handle.db
      .insert(t.workspaces)
      .values({ name: 'Another tenant' })
      .returning();
    otherWorkspaceId = other!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  function appWith(extraLlm: Record<string, LLMProvider> = {}) {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        secrets: new MockSecretsProvider({}),
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: DIFF }),
        llm: { openai: new MockLLMProvider('openai', { structured: REVIEW_FIXTURE }), ...extraLlm },
        // Every provider the run resolves — the intent pre-pass included — lands
        // on a mock, so nothing here reaches a network or a paid key.
        llmFallback: new MockLLMProvider('openai', { structured: REVIEW_FIXTURE }),
      },
    });
  }

  const makeAgent = async (
    app: Awaited<ReturnType<typeof buildApp>>,
    name: string,
    provider: 'openai' | 'anthropic' = 'openai',
  ) =>
    (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name, provider, model: 'gpt-4.1', system_prompt: `you are ${name}` },
      })
    ).json();

  it('creates one multi-run, two queued runs and two items, then answers with both columns', async () => {
    const app = await appWith();
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const a = await makeAgent(app, 'Security');
    const b = await makeAgent(app, 'Performance');

    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/multi-agent-run`,
      payload: { agentIds: [a.id, b.id] },
    });
    expect(res.statusCode).toBe(200);
    const created = res.json();
    expect(created.runs).toHaveLength(2);
    expect(created.skipped).toEqual([]);

    // AC-24/AC-26: exactly one multi-run, and the id the result stays reachable by.
    const multiRuns = await pg.handle.db
      .select()
      .from(t.multiAgentRuns)
      .where(eq(t.multiAgentRuns.prId, pr.id));
    expect(multiRuns).toHaveLength(1);
    expect(multiRuns[0]!.id).toBe(created.id);
    expect(multiRuns[0]!.concurrency).toBe(3);
    // The head the comparison was produced against, snapshotted (AC-109).
    expect(multiRuns[0]!.headSha).toBe(pr.headSha);

    // AC-25: every run belongs to exactly one multi-run, by primary key.
    const items = await pg.handle.db
      .select()
      .from(t.multiAgentRunItems)
      .where(eq(t.multiAgentRunItems.multiRunId, created.id))
      .orderBy(t.multiAgentRunItems.position);
    expect(items).toHaveLength(2);
    expect(items.map((i) => i.position)).toEqual([0, 1]);
    // The name snapshot AC-118 later depends on.
    expect(items.map((i) => i.agentName).sort()).toEqual(['Performance', 'Security']);

    await waitForPrRuns(pg.handle.db, pr.id, { expected: 2 });
    // The runs being terminal is NOT the multi-run being over: the completion is
    // stamped by the executor's continuation, a beat after the last run publishes
    // its terminal state (AC-155). Waiting for the runs alone would read the
    // multi-run mid-stamp and see `elapsed`.
    await waitForMultiRunFinish(pg.handle.db, created.id);

    const body = (
      await app.inject({ method: 'GET', url: `/multi-agent-runs/${created.id}` })
    ).json();
    expect(body.agent_count).toBe(2);
    expect(body.pr_number).toBe(482);
    expect(body.pr_title).toBe('Add rate limiting');
    expect(body.columns).toHaveLength(2);
    for (const column of body.columns) {
      expect(column.status).toBe('done');
      expect(column.agent_deleted).toBe(false);
      expect(column.findings).toHaveLength(1);
      expect(column.findings[0].file).toBe('src/config.ts');
    }
    // Both agents flagged the same line: one cross-agent position, two takes.
    expect(body.conflicts).toHaveLength(1);
    expect(body.conflicts[0].file).toBe('src/config.ts');
    expect(body.conflicts[0].takes.map((k: { verdict: string }) => k.verdict)).toEqual([
      'CRITICAL',
      'CRITICAL',
    ]);
    // AC-41: the MULTI-RUN's own measured span, never derived from the columns.
    // It contains every run plus the shared pre-work, so it cannot be shorter
    // than the longest column — and it is captioned as a measurement (AC-155),
    // not as time elapsed (AC-156) or as an interrupted run (AC-158).
    expect(body.total_duration_kind).toBe('measured');
    expect(body.total_duration_ms).toBeGreaterThanOrEqual(
      Math.max(...body.columns.map((c: { duration_ms: number }) => c.duration_ms)),
    );
    // AC-160: the cost, unlike the time, IS the sum — and both runs priced.
    expect(body.total_cost_partial).toBe(false);

    // AC-96: which agent produced which finding is still answerable from the data.
    const reviews = await pg.handle.db
      .select()
      .from(t.reviews)
      .where(eq(t.reviews.prId, pr.id));
    expect(reviews).toHaveLength(2);
    expect(reviews.map((r) => r.agentId).sort()).toEqual([a.id, b.id].sort());

    await app.close();
  });

  it('holds agents over the concurrency ceiling in `queued`, and says so in the column (AC-33, AC-34)', async () => {
    const gated = new GatedProvider();
    const app = await appWith({ openai: gated });
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const agents = [];
    for (const name of ['A', 'B', 'C', 'D']) agents.push(await makeAgent(app, `Queue ${name}`));

    try {
      const created = (
        await app.inject({
          method: 'POST',
          url: `/pulls/${pr.id}/multi-agent-run`,
          payload: { agentIds: agents.map((x) => x.id) },
        })
      ).json();

      // Wait until the ceiling is saturated: three at the engine, one still waiting.
      for (let i = 0; i < 400; i++) {
        const runs = await pg.handle.db
          .select()
          .from(t.agentRuns)
          .where(eq(t.agentRuns.prId, pr.id));
        if (runs.filter((r) => r.status === 'running').length === 3) break;
        await new Promise((r) => setTimeout(r, 25));
      }
      const runs = await pg.handle.db
        .select()
        .from(t.agentRuns)
        .where(eq(t.agentRuns.prId, pr.id));
      expect(runs).toHaveLength(4);
      expect(runs.filter((r) => r.status === 'running')).toHaveLength(3);
      // AC-34: the fourth is NOT "running" — in the data…
      expect(runs.filter((r) => r.status === 'queued')).toHaveLength(1);

      // …and in the response the column header is drawn from.
      const body = (
        await app.inject({ method: 'GET', url: `/multi-agent-runs/${created.id}` })
      ).json();
      const states = body.columns.map((c: { status: string }) => c.status).sort();
      expect(states).toEqual(['queued', 'running', 'running', 'running']);
      // AC-119: the waiting agent has no opinion, and it is not `ignored`.
      const queuedRunId = runs.find((r) => r.status === 'queued')!.id;
      for (const position of body.conflicts) {
        const take = position.takes.find((k: { run_id: string }) => k.run_id === queuedRunId);
        expect(take.verdict).toBe('not_reviewed');
        expect(take.note).toBeNull();
      }
    } finally {
      gated.release();
    }

    await waitForPrRuns(pg.handle.db, pr.id, { expected: 4 });
    await app.close();
  });

  /**
   * Cancelling a run that is still WAITING has to stop it, and stopping it has
   * to mean it never bills.
   *
   * The PR page's Cancel sends every id `activeRunsForPull` returned, and that
   * read now covers `queued` as well as `running` — so the ids the page cancels
   * include agents that have not started. Two things then have to agree with it:
   * the UPDATE that marks the row (or the row keeps saying `queued` while the
   * API answers `{ok:true}`), and the pool worker that later reaches the job (or
   * the row is flipped back to `running` and the full paid review executes
   * anyway). Only the pair is a cancellation; either half alone is a lie.
   *
   * Real SQL is the point of testing it here: the guard is a WHERE clause, and
   * a stub repository would only be asked to agree with itself.
   */
  it('cancels a run still waiting for a slot, and the pool never spends on it', async () => {
    const gated = new GatedProvider();
    const app = await appWith({ openai: gated });
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const agents = [];
    for (const name of ['E', 'F', 'G', 'H']) agents.push(await makeAgent(app, `Cancel ${name}`));

    let queuedRunId = '';
    try {
      const created = await app.inject({
        method: 'POST',
        url: `/pulls/${pr.id}/multi-agent-run`,
        payload: { agentIds: agents.map((x) => x.id) },
      });
      expect(created.statusCode).toBe(200);

      // Saturate the ceiling: three at the engine, the fourth still waiting.
      let runs: (typeof t.agentRuns.$inferSelect)[] = [];
      for (let i = 0; i < 400; i++) {
        runs = await pg.handle.db
          .select()
          .from(t.agentRuns)
          .where(eq(t.agentRuns.prId, pr.id));
        if (runs.filter((r) => r.status === 'running').length === 3) break;
        await new Promise((r) => setTimeout(r, 25));
      }
      expect(runs.filter((r) => r.status === 'queued')).toHaveLength(1);
      queuedRunId = runs.find((r) => r.status === 'queued')!.id;
      // Three agents are open at the engine; the waiting one has cost nothing yet.
      expect(gated.calls).toBe(3);

      const cancelled = await app.inject({ method: 'POST', url: `/runs/${queuedRunId}/cancel` });
      expect(cancelled.statusCode).toBe(200);

      // Half one: the row says what the API just claimed.
      const [row] = await pg.handle.db
        .select()
        .from(t.agentRuns)
        .where(eq(t.agentRuns.id, queuedRunId));
      expect(row!.status).toBe('cancelled');
    } finally {
      gated.release();
    }

    await waitForPrRuns(pg.handle.db, pr.id, { expected: 4 });

    // Half two: the pool reached the job and walked past it. `RunBus.complete`
    // deleted the in-memory cancelled flag during the cancel above, so the row
    // is the only thing that could have stopped the worker — and it did.
    const after = await pg.handle.db
      .select()
      .from(t.agentRuns)
      .where(eq(t.agentRuns.prId, pr.id));
    expect(after.find((r) => r.id === queuedRunId)!.status).toBe('cancelled');
    expect(after.filter((r) => r.status === 'done')).toHaveLength(3);
    // Still the three that were already open when Cancel was pressed.
    expect(gated.calls).toBe(3);

    await app.close();
  });

  it('creates a multi-run for a single agent (AC-24) and counts a repeated id once (AC-29)', async () => {
    const app = await appWith();
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const solo = await makeAgent(app, 'Solo');

    const created = (
      await app.inject({
        method: 'POST',
        url: `/pulls/${pr.id}/multi-agent-run`,
        payload: { agentIds: [solo.id, solo.id, solo.id] },
      })
    ).json();
    expect(created.runs).toHaveLength(1);

    const runs = await pg.handle.db
      .select()
      .from(t.agentRuns)
      .where(eq(t.agentRuns.prId, pr.id));
    expect(runs).toHaveLength(1);

    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });
    await app.close();
  });

  it('refuses an empty set and an oversized one, creating nothing (AC-27, AC-30)', async () => {
    const app = await appWith();
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const one = await makeAgent(app, 'Only');

    const empty = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/multi-agent-run`,
      payload: { agentIds: [] },
    });
    expect(empty.statusCode).toBe(422);
    expect(empty.json().error.code).toBeTruthy();

    // Eleven ids of which one is unique: AC-30 caps the array AS NAMED, so the
    // refusal happens before the dedupe of AC-29 could rescue it.
    const tooMany = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/multi-agent-run`,
      payload: { agentIds: Array.from({ length: 11 }, () => one.id) },
    });
    expect(tooMany.statusCode).toBe(422);

    expect(
      await pg.handle.db.select().from(t.multiAgentRuns).where(eq(t.multiAgentRuns.prId, pr.id)),
    ).toHaveLength(0);
    expect(
      await pg.handle.db.select().from(t.agentRuns).where(eq(t.agentRuns.prId, pr.id)),
    ).toHaveLength(0);

    await app.close();
  });

  it('refuses an agent id from another workspace and starts nothing (AC-28)', async () => {
    const app = await appWith();
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const mine = await makeAgent(app, 'Mine');
    const [theirs] = await pg.handle.db
      .insert(t.agents)
      .values({
        workspaceId: otherWorkspaceId,
        name: 'Not yours',
        provider: 'openai',
        model: 'gpt-4.1',
        systemPrompt: 'nope',
      })
      .returning();

    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/multi-agent-run`,
      payload: { agentIds: [mine.id, theirs!.id] },
    });
    // "Not found", not "forbidden" — indistinguishable from an id that never was.
    expect(res.statusCode).toBe(404);

    expect(
      await pg.handle.db.select().from(t.multiAgentRuns).where(eq(t.multiAgentRuns.prId, pr.id)),
    ).toHaveLength(0);
    expect(
      await pg.handle.db.select().from(t.agentRuns).where(eq(t.agentRuns.prId, pr.id)),
    ).toHaveLength(0);

    await app.close();
  });

  it('answers "not found" for a multi-run of another workspace (AC-95)', async () => {
    const app = await appWith();
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const [theirs] = await pg.handle.db
      .insert(t.multiAgentRuns)
      .values({ workspaceId: otherWorkspaceId, prId: pr.id, concurrency: 3 })
      .returning();

    const res = await app.inject({ method: 'GET', url: `/multi-agent-runs/${theirs!.id}` });
    expect(res.statusCode).toBe(404);

    const rerun = await app.inject({
      method: 'POST',
      url: `/multi-agent-runs/${theirs!.id}/rerun`,
    });
    expect(rerun.statusCode).toBe(404);

    await app.close();
  });

  it('leaves the multi-run readable with one column fewer after a run is deleted (AC-99)', async () => {
    const app = await appWith();
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const a = await makeAgent(app, 'Keeper');
    const b = await makeAgent(app, 'Doomed');

    const created = (
      await app.inject({
        method: 'POST',
        url: `/pulls/${pr.id}/multi-agent-run`,
        payload: { agentIds: [a.id, b.id] },
      })
    ).json();
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 2 });

    const doomed = created.runs.find((r: { agent_id: string }) => r.agent_id === b.id)!;
    const deleted = await app.inject({ method: 'DELETE', url: `/runs/${doomed.run_id}` });
    expect(deleted.json()).toEqual({ ok: true });

    const body = (
      await app.inject({ method: 'GET', url: `/multi-agent-runs/${created.id}` })
    ).json();
    expect(body.columns).toHaveLength(1);
    expect(body.columns[0].agent_id).toBe(a.id);
    expect(body.agent_count).toBe(1);
    // Positions recomputed WITHOUT the deleted run's findings: one agent is left,
    // so its lone finding stays visible rather than reading as a rejected one.
    expect(body.conflicts).toHaveLength(1);
    expect(body.conflicts[0].takes).toHaveLength(1);

    await app.close();
  });

  it('keeps a deleted agent named in its column, and re-runs the rest (AC-117, AC-118)', async () => {
    const app = await appWith();
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const stays = await makeAgent(app, 'Stays');
    const goes = await makeAgent(app, 'Goes away');

    const created = (
      await app.inject({
        method: 'POST',
        url: `/pulls/${pr.id}/multi-agent-run`,
        payload: { agentIds: [stays.id, goes.id] },
      })
    ).json();
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 2 });

    expect((await app.inject({ method: 'DELETE', url: `/agents/${goes.id}` })).statusCode).toBe(200);

    const body = (
      await app.inject({ method: 'GET', url: `/multi-agent-runs/${created.id}` })
    ).json();
    const orphan = body.columns.find((c: { agent_name: string }) => c.agent_name === 'Goes away');
    // AC-118: the column still NAMES the agent, and says it is gone.
    expect(orphan).toBeDefined();
    expect(orphan.agent_deleted).toBe(true);
    expect(orphan.agent_id).toBeNull();
    expect(orphan.findings).toHaveLength(1);

    // AC-117: the re-run runs the survivors and names who was skipped.
    const rerun = (
      await app.inject({ method: 'POST', url: `/multi-agent-runs/${created.id}/rerun` })
    ).json();
    expect(rerun.id).not.toBe(created.id);
    expect(rerun.runs).toHaveLength(1);
    expect(rerun.runs[0].agent_id).toBe(stays.id);
    expect(rerun.skipped).toEqual([{ agent_id: goes.id, agent_name: 'Goes away' }]);

    // AC-115: the previous multi-run is still reachable at its own link.
    expect(
      (await app.inject({ method: 'GET', url: `/multi-agent-runs/${created.id}` })).statusCode,
    ).toBe(200);

    await waitForPrRuns(pg.handle.db, pr.id, { expected: 3 });
    await app.close();
  });

  /**
   * THE CASE THE 2026-08-26 AMENDMENT EXISTS FOR, through the REAL persistence
   * path. `persistFailure` writes no `reviews` row at all, so the failed agent's
   * data is byte-identical to a `done` agent that flagged nothing — and the
   * multi-run has ended, so there is no later moment at which the word gets
   * corrected. Only the run's state distinguishes them, and it must.
   */
  it('leaves a failed run\'s takes `not_reviewed` after the multi-run has ended (AC-36, AC-120)', async () => {
    const app = await appWith({ anthropic: new ExplodingProvider() });
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const good = await makeAgent(app, 'Healthy');
    const bad = await makeAgent(app, 'Broken', 'anthropic');

    const created = (
      await app.inject({
        method: 'POST',
        url: `/pulls/${pr.id}/multi-agent-run`,
        payload: { agentIds: [good.id, bad.id] },
      })
    ).json();
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 2 });

    const body = (
      await app.inject({ method: 'GET', url: `/multi-agent-runs/${created.id}` })
    ).json();

    // AC-36: the other agent finished, and the failed column carries its reason.
    const failed = body.columns.find((c: { agent_id: string }) => c.agent_id === bad.id);
    const done = body.columns.find((c: { agent_id: string }) => c.agent_id === good.id);
    expect(failed.status).toBe('failed');
    expect(String(failed.error)).toContain('provider is down');
    expect(done.status).toBe('done');
    expect(done.findings).toHaveLength(1);

    // The failed run persisted no review, hence no findings — the shape a silent
    // `done` agent leaves. The verdict must still be `not_reviewed`.
    expect(failed.findings).toEqual([]);
    expect(body.conflicts).toHaveLength(1);
    const takes: { run_id: string; verdict: string; note: string | null }[] = body.conflicts[0].takes;
    const failedTake = takes.find((k) => k.run_id === failed.run_id)!;
    expect(failedTake.verdict).toBe('not_reviewed');
    expect(failedTake.verdict).not.toBe('ignored');
    expect(failedTake.note).toBeNull();

    // AC-42: one run priced at null makes the total a floor, not a total.
    expect(body.total_cost_partial).toBe(true);

    await app.close();
  });

  /**
   * R54 — the link on the PR page has to survive a reload, so it is READ, not
   * remembered. A 404 here is the failure this case exists to catch: it would
   * put an error on every PR page that has not been through this feature.
   */
  it('answers `null` with a 200 for a PR never compared, then the newest of two', async () => {
    const app = await appWith();
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const agent = await makeAgent(app, 'Ref');

    const before = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/multi-agent` });
    expect(before.statusCode).toBe(200);
    expect(before.json()).toBeNull();

    const first = (
      await app.inject({
        method: 'POST',
        url: `/pulls/${pr.id}/multi-agent-run`,
        payload: { agentIds: [agent.id] },
      })
    ).json();
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });

    // Two multi-runs a second apart in `ran_at`; the read must give the newer.
    await pg.handle.db
      .update(t.multiAgentRuns)
      .set({ ranAt: new Date(Date.now() - 60_000) })
      .where(eq(t.multiAgentRuns.id, first.id));

    const second = (
      await app.inject({
        method: 'POST',
        url: `/pulls/${pr.id}/multi-agent-run`,
        payload: { agentIds: [agent.id] },
      })
    ).json();
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 2 });

    const ref = (await app.inject({ method: 'GET', url: `/pulls/${pr.id}/multi-agent` })).json();
    expect(ref).toMatchObject({ id: second.id, pr_id: pr.id, pr_number: 482 });
    expect(typeof ref.ran_at).toBe('string');

    await app.close();
  });

  it('answers the newest multi-run of a repo, and `null` for a repo without one (AC-94)', async () => {
    const app = await appWith();
    const { repo, pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const { repo: empty } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const agent = await makeAgent(app, 'Landing');

    const none = await app.inject({
      method: 'GET',
      url: `/repos/${empty.id}/multi-agent-runs/latest`,
    });
    expect(none.statusCode).toBe(200);
    expect(none.json()).toBeNull();

    const created = (
      await app.inject({
        method: 'POST',
        url: `/pulls/${pr.id}/multi-agent-run`,
        payload: { agentIds: [agent.id] },
      })
    ).json();
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });

    const latest = (
      await app.inject({ method: 'GET', url: `/repos/${repo.id}/multi-agent-runs/latest` })
    ).json();
    expect(latest.id).toBe(created.id);

    await app.close();
  });

  it('reports each agent\'s last successful run, and omits an agent that has none (AC-20)', async () => {
    const app = await appWith();
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const ran = await makeAgent(app, 'Has history');
    const never = await makeAgent(app, 'No history');

    await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/multi-agent-run`,
      payload: { agentIds: [ran.id] },
    });
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });

    const rows: { agent_id: string; duration_ms: number | null; cost_usd: number | null }[] = (
      await app.inject({ method: 'GET', url: '/runs/last-successful' })
    ).json();

    const mine = rows.find((r) => r.agent_id === ran.id);
    expect(mine).toBeDefined();
    expect(mine!.duration_ms).toBeGreaterThanOrEqual(0);
    expect(mine!.cost_usd).toBeGreaterThan(0);
    // An agent with no successful run is ABSENT, not a zero row — AC-23 forbids
    // the screen to print "0.0s / $0.00" for "no data".
    expect(rows.some((r) => r.agent_id === never.id)).toBe(false);

    await app.close();
  });

  it('keeps a queued run out of nothing: the reaper marks it failed on the next boot', async () => {
    // The widened reaper is what stops a server restart leaving a column stuck
    // `queued` for ever, which would contradict AC-37.
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const [orphan] = await pg.handle.db
      .insert(t.agentRuns)
      .values({ workspaceId, agentId: null, prId: pr.id, status: 'queued', source: 'local' })
      .returning();

    const app = await appWith();
    await app.close();

    const [after] = await pg.handle.db
      .select()
      .from(t.agentRuns)
      .where(and(eq(t.agentRuns.id, orphan!.id)));
    expect(after!.status).toBe('failed');
  });
});
