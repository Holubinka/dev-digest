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
import { eq } from 'drizzle-orm';
import type { Intent, LLMProvider, Review } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

/**
 * A unified diff touching src/config.ts (line 11 added) so grounding can keep a
 * finding on line 11 and drop one on line 999 / a non-existent file.
 */
const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,`;

/** A Review fixture: one valid finding (line 11), one hallucinated (line 999). */
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
    {
      id: 'f-halluc',
      severity: 'WARNING',
      category: 'bug',
      title: 'Phantom finding on a line not in the diff',
      file: 'src/config.ts',
      start_line: 999,
      end_line: 999,
      rationale: 'This line does not exist in the diff.',
      confidence: 0.5,
      kind: 'finding',
    },
  ],
};

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
      body: 'Add rate limiting. Closes #471.',
    })
    .returning();
  // persist the patch so the reviewer can reconstruct a diff (MockGit also returns one)
  await db.insert(t.prFiles).values({
    prId: pr!.id,
    path: 'src/config.ts',
    additions: 1,
    deletions: 0,
    patch: '@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "sk_live_xxx",\n   redisUrl: x,',
  });
  return { repo: repo!, pr: pr! };
}

d('A2 reviews + agents (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  /**
   * `structured` serves every schemaName, so the 05 intent pre-pass receives the
   * Review fixture for `Intent`, fails validation, and the run continues without
   * an intent section — which is the degrade path, asserted explicitly below.
   *
   * `llmFallback` is what makes that hermetic, and it is STRUCTURAL. The intent
   * pre-pass resolves its provider from `settings.feature_models`, so no `llm`
   * key written here can name every id the run will ask for; the catch-all is
   * consulted for whichever one it turns out to be, before any secret is read.
   * `MockSecretsProvider({})` stays as defence in depth — it is no longer the
   * mechanism, and a test that depended on it was depending on a missing key
   * (a `ConfigError` on the failure path) rather than on an override.
   */
  function appWith(
    structured: unknown,
    provider: 'openai' | 'anthropic' = 'openai',
    extraLlm: Record<string, MockLLMProvider> = {},
    llmFallback: LLMProvider = new MockLLMProvider('openai', { structured }),
  ) {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        secrets: new MockSecretsProvider({}),
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: DIFF }),
        llm: {
          [provider]: new MockLLMProvider(provider, { structured }),
          ...extraLlm,
        },
        llmFallback,
      },
    });
  }

  it('agents CRUD', async () => {
    const app = await appWith(REVIEW_FIXTURE);

    const created = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: {
        name: 'Test Reviewer',
        provider: 'openai',
        model: 'gpt-4.1',
        system_prompt: 'You are a reviewer.',
      },
    });
    expect(created.statusCode).toBe(201);
    const agent = created.json();
    expect(agent.version).toBe(1);

    const list = (await app.inject({ method: 'GET', url: '/agents' })).json();
    expect(list.some((a: { id: string }) => a.id === agent.id)).toBe(true);

    // a config change bumps version
    const updated = (
      await app.inject({
        method: 'PUT',
        url: `/agents/${agent.id}`,
        payload: { system_prompt: 'Updated prompt.' },
      })
    ).json();
    expect(updated.version).toBe(2);

    await app.close();
  });

  it('runs a review: map-reduce + grounding drops the hallucinated finding, keeps the valid one', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'Sec', provider: 'openai', model: 'gpt-4.1', system_prompt: 'sec' },
      })
    ).json();

    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/review`,
      payload: { agentId: agent.id },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.runs).toHaveLength(1);

    // runReview is fire-and-forget: wait for the background run, then read the
    // persisted reviews (the POST returns runIds, not the reviews themselves).
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });
    const reviews = (
      await app.inject({ method: 'GET', url: `/pulls/${pr.id}/reviews` })
    ).json();
    expect(reviews).toHaveLength(1);

    const review = reviews[0];
    expect(review.verdict).toBe('request_changes');
    // Score is derived from the GROUNDED findings, not the model's self-reported
    // 42: grounding keeps one CRITICAL (line 11) ⇒ 100 − 35 = 65.
    expect(review.score).toBe(65);
    // grounding kept only the valid finding (line 11), dropped the line-999 one
    expect(review.findings).toHaveLength(1);
    expect(review.findings[0].file).toBe('src/config.ts');
    expect(review.findings[0].start_line).toBe(11);

    // a run_traces document was written (single doc)
    const runId = body.runs[0].run_id;
    const trace = (await app.inject({ method: 'GET', url: `/runs/${runId}/trace` })).json();
    expect(trace.config.model).toBe('gpt-4.1');
    expect(trace.stats.grounding).toBe('1/2 passed');
    expect(trace.log.length).toBeGreaterThan(0);
    // Cost rides along on the trace — no extra call, just the usage the
    // completion already reported (MockLLMProvider: $0.001 per call).
    expect(trace.stats.cost_usd).toBeGreaterThan(0);

    // agent_runs row populated for A5 to aggregate
    const [run] = await pg.handle.db.select().from(t.agentRuns).where(eq(t.agentRuns.id, runId));
    expect(run!.status).toBe('done');
    expect(run!.findingsCount).toBe(1);
    expect(run!.grounding).toBe('1/2 passed');
    expect(run!.costUsd).toBe(trace.stats.cost_usd);

    await app.close();
  });

  it('dual-provider structured output: anthropic provider returns the same Review shape', async () => {
    const app = await appWith(REVIEW_FIXTURE, 'anthropic');
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'Claude Rev', provider: 'anthropic', model: 'claude-x', system_prompt: 'rev' },
      })
    ).json();
    await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: agent.id } });
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });
    const reviews = (
      await app.inject({ method: 'GET', url: `/pulls/${pr.id}/reviews` })
    ).json();
    expect(reviews[0].findings).toHaveLength(1);
    expect(reviews[0].model).toBe('claude-x');
    await app.close();
  });

  it('finding actions: accept, dismiss', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'ActAgent', provider: 'openai', model: 'gpt-4.1', system_prompt: 's' },
      })
    ).json();
    await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: agent.id } });
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });
    const reviews = (
      await app.inject({ method: 'GET', url: `/pulls/${pr.id}/reviews` })
    ).json();
    const findingId = reviews[0].findings[0].id;

    const accepted = (
      await app.inject({ method: 'POST', url: `/findings/${findingId}/accept` })
    ).json();
    expect(accepted.finding.accepted_at).not.toBeNull();

    const dismissed = (
      await app.inject({ method: 'POST', url: `/findings/${findingId}/dismiss` })
    ).json();
    expect(dismissed.finding.dismissed_at).not.toBeNull();
    expect(dismissed.finding.accepted_at).toBeNull();

    await app.close();
  });

  it('SSE: /runs/:id/events streams events and completes', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'SseAgent', provider: 'openai', model: 'gpt-4.1', system_prompt: 's' },
      })
    ).json();
    // The run is synchronous; events are buffered on the bus. Subscribing after
    // the run still replays the buffer (replay-first semantics), then completes.
    const body = (
      await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: agent.id } })
    ).json();
    const runId = body.runs[0].run_id;

    const sse = await app.inject({ method: 'GET', url: `/runs/${runId}/events` });
    expect(sse.statusCode).toBe(200);
    expect(sse.headers['content-type']).toContain('text/event-stream');
    // The replay buffer should contain our log lines as SSE `data:` frames.
    expect(sse.payload).toContain('Starting review');
    expect(sse.payload).toContain('Citation grounding');
    await app.close();
  });

  it('run all enabled agents reviews with each enabled agent', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const body = (
      await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { all: true } })
    ).json();
    // seed has 2 enabled agents; we may have created more above in this PR's ws.
    expect(body.runs.length).toBeGreaterThanOrEqual(2);
    await app.close();
  });

  // ---- 05: the intent pre-pass ------------------------------------------

  const INTENT_FIXTURE: Intent = {
    intent: 'Adds rate limiting to the public API.',
    in_scope: ['the limiter middleware'],
    out_of_scope: ['billing'],
    risk_areas: ['performance'],
  };

  it('a review derives the intent once, persists it, and sends it in the prompt', async () => {
    const app = await appWith(REVIEW_FIXTURE, 'openai', {
      openrouter: new MockLLMProvider('openai', {
        structuredBySchema: { Intent: INTENT_FIXTURE },
      }),
    });
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'Intent A', provider: 'openai', model: 'gpt-4.1', system_prompt: 'rev' },
      })
    ).json();

    const body = (
      await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: agent.id } })
    ).json();
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });

    const [intentRow] = await pg.handle.db
      .select()
      .from(t.prIntent)
      .where(eq(t.prIntent.prId, pr.id));
    expect(intentRow!.intent).toBe(INTENT_FIXTURE.intent);
    expect(intentRow!.riskAreas).toEqual(INTENT_FIXTURE.risk_areas);
    // 12 — the usage lands on pr_intent, once, and nowhere else.
    expect(intentRow!.tokensIn).toBeGreaterThan(0);
    expect(intentRow!.costUsd).toBeGreaterThan(0);

    const trace = (
      await app.inject({ method: 'GET', url: `/runs/${body.runs[0].run_id}/trace` })
    ).json();
    expect(trace.prompt_assembly.intent).not.toBeNull();
    expect(trace.prompt_assembly.intent).toContain(INTENT_FIXTURE.intent);
    expect(trace.prompt_assembly.user).toContain('## Intent');
    expect(trace.prompt_assembly.user).toContain('<untrusted source="derived-intent">');
    // Order invariant: after the description it summarises, before the rules
    // and (always) before the diff.
    const user: string = trace.prompt_assembly.user;
    expect(user.indexOf('## PR description')).toBeLessThan(user.indexOf('## Intent'));
    expect(user.indexOf('## Intent')).toBeLessThan(user.indexOf('## Diff to review'));

    await app.close();
  });

  /**
   * The plan's load-bearing guarantee. The intent call fails (no `Intent`
   * fixture, so the Review fixture is offered to the `Intent` schema and is
   * rejected) and the review must be completely unaffected.
   *
   * The reason string is asserted, not just the degrade: it is what distinguishes
   * "the fallback answered and its fixture did not satisfy `Intent`" from "no key
   * was configured", and only the first is an override doing the isolating.
   */
  it('a failed intent never fails a review', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'Intent B', provider: 'openai', model: 'gpt-4.1', system_prompt: 'rev' },
      })
    ).json();

    const body = (
      await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: agent.id } })
    ).json();
    const runId = body.runs[0].run_id;
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });

    const [run] = await pg.handle.db.select().from(t.agentRuns).where(eq(t.agentRuns.id, runId));
    expect(run!.status).toBe('done');
    expect(run!.findingsCount).toBe(1);

    const reviews = (await app.inject({ method: 'GET', url: `/pulls/${pr.id}/reviews` })).json();
    expect(reviews[0].findings).toHaveLength(1);

    const trace = (await app.inject({ method: 'GET', url: `/runs/${runId}/trace` })).json();
    expect(trace.prompt_assembly.intent).toBeNull();
    expect(trace.prompt_assembly.user).not.toContain('## Intent');
    // Nothing is persisted on a failed derivation.
    const rows = await pg.handle.db.select().from(t.prIntent).where(eq(t.prIntent.prId, pr.id));
    expect(rows).toHaveLength(0);
    // …and the Live Log says why, rather than swallowing it. The reason names the
    // fixture, so the fallback provider IS what answered the intent call — with
    // no fallback this would read "OPENROUTER_API_KEY is not configured".
    expect(trace.log.map((l: { msg: string }) => l.msg)).toContainEqual(
      expect.stringMatching(/Intent unavailable — MockLLMProvider fixture failed schema/),
    );

    await app.close();
  });

  /**
   * `ContainerOverrides.llm` cannot express "this run touches no live LLM".
   * `review_intent` is a row in `settings`, so the provider id the pre-pass asks
   * `container.llm` for is chosen by DATA — here `anthropic`, which `overrides.llm`
   * does not carry (the review agent's own `openai` mock is the only entry).
   * `llmFallback` is what answers, and this asserts it three ways: the fallback
   * recorded exactly the one `completeStructured` call, no per-id mock did, and
   * the persisted row carries the workspace's chosen provider+model.
   *
   * Delete `llmFallback` and `container.llm('anthropic')` hits the empty
   * `MockSecretsProvider`, throws `ConfigError`, `derive` degrades, and `pr_intent`
   * stays empty — every assertion below fails.
   */
  it('the intent pre-pass is served by the catch-all override for a provider chosen from settings', async () => {
    const fallback = new MockLLMProvider('openai', {
      structuredBySchema: { Intent: INTENT_FIXTURE },
    });
    const app = await appWith(REVIEW_FIXTURE, 'openai', {}, fallback);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    try {
      const put = await app.inject({
        method: 'PUT',
        url: '/settings',
        payload: {
          feature_models: { review_intent: { provider: 'anthropic', model: 'claude-haiku-x' } },
        },
      });
      expect(put.statusCode).toBe(200);

      const agent = (
        await app.inject({
          method: 'POST',
          url: '/agents',
          payload: { name: 'Intent C', provider: 'openai', model: 'gpt-4.1', system_prompt: 'rev' },
        })
      ).json();
      await app.inject({
        method: 'POST',
        url: `/pulls/${pr.id}/review`,
        payload: { agentId: agent.id },
      });
      await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });

      const [row] = await pg.handle.db
        .select()
        .from(t.prIntent)
        .where(eq(t.prIntent.prId, pr.id));
      expect(row!.provider).toBe('anthropic');
      expect(row!.model).toBe('claude-haiku-x');
      expect(row!.intent).toBe(INTENT_FIXTURE.intent);

      const structuredCalls = fallback.calls.filter((c) => c.method === 'completeStructured');
      expect(structuredCalls).toHaveLength(1);
      expect((structuredCalls[0]!.req as { schemaName: string }).schemaName).toBe('Intent');
    } finally {
      // The override is a workspace row shared with every later case in this
      // file; put `review_intent` back on the registry default.
      await app.inject({ method: 'PUT', url: '/settings', payload: { feature_models: {} } });
      await app.close();
    }
  });

  it("the PR list's cost is the SUM of every run, not just the latest review's", async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const { repo, pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    // Two agents on the MOCKED provider, reviewed one after the other. Explicit
    // agentIds rather than {all:true}: the seeded agents run on 'openrouter',
    // which appWith does not mock, so a fan-out would price an unpredictable
    // subset and make this assertion depend on test order.
    const agentIds: string[] = [];
    for (const name of ['Cost A', 'Cost B']) {
      const created = (
        await app.inject({
          method: 'POST',
          url: '/agents',
          payload: { name, provider: 'openai', model: 'gpt-4.1', system_prompt: 'rev' },
        })
      ).json();
      agentIds.push(created.id);
    }
    for (const agentId of agentIds) {
      await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId } });
    }
    await waitForPrRuns(pg.handle.db, pr.id, { expected: agentIds.length });

    const runs = await pg.handle.db.select().from(t.agentRuns).where(eq(t.agentRuns.prId, pr.id));
    const costs = runs.map((r) => r.costUsd).filter((c): c is number => c != null);
    expect(costs).toHaveLength(2);
    const total = costs.reduce((a, b) => a + b, 0);

    const list = (await app.inject({ method: 'GET', url: `/repos/${repo.id}/pulls` })).json();
    const row = list.find((p: { number: number }) => p.number === pr.number);
    expect(row.cost_usd).toBeCloseTo(total, 10);
    // The regression this guards: fanning out to N agents must not report one
    // agent's spend. The sum strictly exceeds the largest single run.
    expect(row.cost_usd).toBeGreaterThan(Math.max(...costs));

    await app.close();
  });
});
