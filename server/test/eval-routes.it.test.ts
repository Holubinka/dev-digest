/**
 * L06 — the eval routes against real Postgres and the real migrations
 * (AC-1 … AC-11, AC-21, AC-22, AC-27 … AC-29, AC-67 … AC-68).
 *
 * The hermetic suites fake the store, so they can prove what the executor does
 * with a row but not that the row behaves. Four things here are properties of
 * SQL and a fake cannot get them wrong the way Postgres can:
 *
 *  - `eval_runs` has NO `workspace_id`, so every read and write scopes through
 *    the join to `eval_cases`. A foreign-workspace agent id must return nothing,
 *    and that is only checkable against a database with two workspaces in it;
 *  - the `ON DELETE CASCADE` from `eval_cases` to `eval_runs`, and the fact that
 *    it leaves an ALREADY WRITTEN aggregate on another case's row untouched;
 *  - `eval_cases` has no foreign key to `findings`, so deleting the pull request
 *    the case was born from must leave the case readable;
 *  - the three jsonb reads — `DISTINCT ON (actual_output->>'batch_id')`,
 *    `jsonb_typeof(...->'aggregate')` and the `jsonb_set` that writes it.
 *
 * `MockSecretsProvider({})` is not decoration: with no keys, any provider this
 * suite failed to override throws `ConfigError` instead of reaching the network.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import type {
  CompletionRequest,
  CompletionResult,
  LLMProvider,
  ModelInfo,
  StructuredRequest,
  StructuredResult,
} from '@devdigest/shared';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockGitClient, MockLLMProvider, MockSecretsProvider } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import { EvalRepository } from '../src/modules/eval/repository.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

/**
 * `MockGitClient`'s default diff — one file, `src/config.ts`, whose hunk covers
 * new-side lines 10, 11 and 12. Every finding below cites line 11.
 */
const CITED_FILE = 'src/config.ts';
const CITED_LINE = 11;

/** A `Review` the mock returns: one finding on the cited line. */
const HIT = {
  verdict: 'request_changes',
  summary: 'one issue',
  score: 30,
  findings: [
    {
      id: 'f-model',
      severity: 'CRITICAL',
      category: 'security',
      title: 'Hardcoded secret',
      file: CITED_FILE,
      start_line: CITED_LINE,
      end_line: CITED_LINE,
      rationale: 'A live key in source.',
      suggestion: null,
      confidence: 0.95,
      kind: 'finding',
      trifecta_components: null,
      evidence: null,
    },
  ],
};

let pg: PgFixture;
let seq = 0;

function appWith(opts: { llm?: LLMProvider; diff?: string } = {}) {
  return buildApp({
    config: config(),
    db: pg.handle.db,
    overrides: {
      secrets: new MockSecretsProvider({}),
      git: new MockGitClient(opts.diff !== undefined ? { diff: opts.diff } : {}),
      ...(opts.llm ? { llm: { openai: opts.llm } } : {}),
    },
  });
}

async function makeAgent(workspaceId: string, name = `reviewer-${seq++}`) {
  const [agent] = await pg.handle.db
    .insert(t.agents)
    .values({
      workspaceId,
      name,
      description: 'test agent',
      provider: 'openai',
      model: 'gpt-4.1',
      systemPrompt: 'You are a security reviewer.',
      version: 1,
      enabled: true,
    })
    .returning();
  await pg.handle.db
    .insert(t.agentVersions)
    .values({
      agentId: agent!.id,
      version: 1,
      configJson: { system_prompt: 'You are a security reviewer.', model: 'gpt-4.1' },
    })
    .onConflictDoNothing();
  return agent!;
}

/** A repo + PR + review + one finding, with the decision the caller asks for. */
async function makeFinding(
  workspaceId: string,
  agentId: string,
  decision: 'accepted' | 'dismissed' | 'undecided',
) {
  const name = `payments-api-${seq++}`;
  const [repo] = await pg.handle.db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning();
  const [pr] = await pg.handle.db
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
      status: 'needs_review',
      body: 'Rate-limit the public API. 🎯',
    })
    .returning();
  const [review] = await pg.handle.db
    .insert(t.reviews)
    .values({
      workspaceId,
      prId: pr!.id,
      agentId,
      runId: null,
      headSha: 'a1b2c3d4',
      kind: 'review',
      verdict: 'request_changes',
      summary: 's',
      score: 30,
      model: 'gpt-4.1',
    })
    .returning();
  const [finding] = await pg.handle.db
    .insert(t.findings)
    .values({
      reviewId: review!.id,
      file: CITED_FILE,
      startLine: CITED_LINE,
      endLine: CITED_LINE,
      severity: 'CRITICAL',
      category: 'security',
      title: 'Hardcoded Stripe key',
      rationale: 'A live key in source.',
      confidence: 0.95,
      kind: 'finding',
      ...(decision === 'accepted' ? { acceptedAt: new Date('2026-08-20T10:00:00Z') } : {}),
      ...(decision === 'dismissed' ? { dismissedAt: new Date('2026-08-20T11:00:00Z') } : {}),
    })
    .returning();
  return { repo: repo!, pr: pr!, review: review!, finding: finding! };
}

async function makeSkill(workspaceId: string, name = `security-rubric-${seq++}`) {
  const [skill] = await pg.handle.db
    .insert(t.skills)
    .values({
      workspaceId,
      name,
      description: 'test skill',
      type: 'security',
      source: 'manual',
      body: 'Look for hardcoded secrets.',
    })
    .returning();
  return skill!;
}

async function bindSkill(agentId: string, skillId: string) {
  await pg.handle.db.insert(t.agentSkills).values({ agentId, skillId, order: 0 });
}

async function countRuns(caseId: string) {
  const rows = await pg.handle.db
    .select()
    .from(t.evalRuns)
    .where(eq(t.evalRuns.caseId, caseId));
  return rows;
}

d('L06 eval routes (Testcontainers pg)', () => {
  let workspaceId: string;
  let otherWorkspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
    const [other] = await pg.handle.db
      .insert(t.workspaces)
      .values({ name: 'Someone Else' })
      .returning();
    otherWorkspaceId = other!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  // ---- creation from a decided finding -----------------------------------

  it('AC-1 — an ACCEPTED finding becomes a case with one must_find expectation', async () => {
    const app = await appWith();
    const agent = await makeAgent(workspaceId);
    const { finding, repo } = await makeFinding(workspaceId, agent.id, 'accepted');

    const res = await app.inject({ method: 'POST', url: `/findings/${finding.id}/eval-case` });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.created).toBe(true);
    expect(body.case.owner_kind).toBe('agent');
    expect(body.case.owner_id).toBe(agent.id);
    expect(body.case.name).toBe('hardcoded-stripe-key');
    expect(body.case.expected_output).toEqual([
      {
        file: CITED_FILE,
        start_line: CITED_LINE,
        end_line: CITED_LINE,
        polarity: 'must_find',
        severity: 'CRITICAL',
        category: 'security',
        title: 'Hardcoded Stripe key',
      },
    ]);
    // AC-4 — the fragment carries exactly the cited file; AC-12 — the derived
    // paths and the PR meta.
    expect(body.case.input_diff).toContain(CITED_FILE);
    expect(body.case.input_files).toEqual([CITED_FILE]);
    expect(body.case.input_meta).toEqual({
      title: 'Add rate limiting',
      body: 'Rate-limit the public API. 🎯',
    });
    // AC-9 — provenance as plain text: the finding id, the repo, the PR number,
    // the decision and its date.
    expect(body.case.notes).toContain(`finding:${finding.id}`);
    expect(body.case.notes).toContain(`acme/${repo.name} PR #482`);
    expect(body.case.notes).toContain('accepted');
    expect(body.case.notes).toContain('2026-08-20T10:00:00');

    await app.close();
  });

  it('AC-2 — a DISMISSED finding becomes one must_not_flag with the same coordinates', async () => {
    const app = await appWith();
    const agent = await makeAgent(workspaceId);
    const { finding } = await makeFinding(workspaceId, agent.id, 'dismissed');

    const res = await app.inject({ method: 'POST', url: `/findings/${finding.id}/eval-case` });
    expect(res.statusCode).toBe(200);
    const [expectation] = res.json().case.expected_output;
    expect(expectation).toMatchObject({
      polarity: 'must_not_flag',
      file: CITED_FILE,
      start_line: CITED_LINE,
      end_line: CITED_LINE,
    });
    await app.close();
  });

  it('AC-3 — an UNDECIDED finding is refused and writes no row', async () => {
    const app = await appWith();
    const agent = await makeAgent(workspaceId);
    const { finding } = await makeFinding(workspaceId, agent.id, 'undecided');

    const res = await app.inject({ method: 'POST', url: `/findings/${finding.id}/eval-case` });
    expect(res.statusCode).toBe(422);

    const set = await app.inject({ method: 'GET', url: `/agents/${agent.id}/eval-cases` });
    expect(set.json().total).toBe(0);
    await app.close();
  });

  it('AC-10 — the second click opens the existing case and creates no second one', async () => {
    const app = await appWith();
    const agent = await makeAgent(workspaceId);
    const { finding } = await makeFinding(workspaceId, agent.id, 'accepted');

    const first = await app.inject({ method: 'POST', url: `/findings/${finding.id}/eval-case` });
    const second = await app.inject({ method: 'POST', url: `/findings/${finding.id}/eval-case` });

    expect(first.json().created).toBe(true);
    expect(second.json().created).toBe(false);
    expect(second.json().case.id).toBe(first.json().case.id);

    const set = await app.inject({ method: 'GET', url: `/agents/${agent.id}/eval-cases` });
    expect(set.json().total).toBe(1);
    await app.close();
  });

  it('AC-5 — no obtainable diff refuses with 409 and creates nothing', async () => {
    // Git returns an empty diff and no `pr_files` rows were written, so there is
    // no fragment to store. A case with an empty input would score 0 for ever
    // and read as a failing agent.
    const app = await appWith({ diff: '' });
    const agent = await makeAgent(workspaceId);
    const { finding } = await makeFinding(workspaceId, agent.id, 'accepted');

    const res = await app.inject({ method: 'POST', url: `/findings/${finding.id}/eval-case` });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('diff_unavailable');

    const set = await app.inject({ method: 'GET', url: `/agents/${agent.id}/eval-cases` });
    expect(set.json().total).toBe(0);
    await app.close();
  });

  it('AC-6 — a finding whose range anchors to no hunk is refused with 422', async () => {
    const app = await appWith();
    const agent = await makeAgent(workspaceId);
    const { finding } = await makeFinding(workspaceId, agent.id, 'accepted');
    // Move the finding past every line the fragment covers.
    await pg.handle.db
      .update(t.findings)
      .set({ startLine: 900, endLine: 901 })
      .where(eq(t.findings.id, finding.id));

    const res = await app.inject({ method: 'POST', url: `/findings/${finding.id}/eval-case` });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('expectation_unanchored');
    await app.close();
  });

  it('AC-8 — a colliding slug gets the smallest free numeric suffix', async () => {
    const app = await appWith();
    const agent = await makeAgent(workspaceId);
    const a = await makeFinding(workspaceId, agent.id, 'accepted');
    const b = await makeFinding(workspaceId, agent.id, 'accepted');

    await app.inject({ method: 'POST', url: `/findings/${a.finding.id}/eval-case` });
    const second = await app.inject({ method: 'POST', url: `/findings/${b.finding.id}/eval-case` });

    expect(second.json().case.name).toBe('hardcoded-stripe-key-2');
    await app.close();
  });

  it('AC-11 — deleting the pull request leaves the case and its runs readable', async () => {
    const app = await appWith({ llm: new MockLLMProvider('openai', { structured: HIT }) });
    const agent = await makeAgent(workspaceId);
    const { finding, pr } = await makeFinding(workspaceId, agent.id, 'accepted');

    const created = await app.inject({ method: 'POST', url: `/findings/${finding.id}/eval-case` });
    const caseId = created.json().case.id;
    const run = await app.inject({ method: 'POST', url: `/eval-cases/${caseId}/run` });
    expect(run.statusCode).toBe(200);

    // The PR cascades away the review and the finding with it. There is no
    // foreign key from `eval_cases` (D11), so nothing here may follow.
    await pg.handle.db.delete(t.pullRequests).where(eq(t.pullRequests.id, pr.id));

    const read = await app.inject({ method: 'GET', url: `/eval-cases/${caseId}` });
    expect(read.statusCode).toBe(200);
    expect(read.json().notes).toContain(`finding:${finding.id}`);
    expect(await countRuns(caseId)).toHaveLength(1);
    await app.close();
  });

  // ---- running -----------------------------------------------------------

  it('AC-21 — a single-case run answers traces_total = 1 and writes exactly one row', async () => {
    const llm = new MockLLMProvider('openai', { structured: HIT });
    const app = await appWith({ llm });
    const agent = await makeAgent(workspaceId);
    const { finding } = await makeFinding(workspaceId, agent.id, 'accepted');
    const created = await app.inject({ method: 'POST', url: `/findings/${finding.id}/eval-case` });
    const caseId = created.json().case.id;

    const res = await app.inject({ method: 'POST', url: `/eval-cases/${caseId}/run` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.case_id).toBe(caseId);
    expect(body.run_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.result.traces_total).toBe(1);
    expect(body.result.traces_passed).toBe(1);
    expect(body.result.recall).toBe(1);

    const rows = await countRuns(caseId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.pass).toBe(true);
    // The envelope round-tripped through jsonb.
    const envelope = rows[0]!.actualOutput as { agent_version: number; findings: unknown[] };
    expect(envelope.agent_version).toBe(1);
    expect(envelope.findings).toHaveLength(1);
    await app.close();
  });

  it('AC-22 — deleting a case cascades its runs and leaves a past aggregate untouched', async () => {
    const llm = new MockLLMProvider('openai', { structured: HIT });
    const app = await appWith({ llm });
    const agent = await makeAgent(workspaceId);
    const a = await makeFinding(workspaceId, agent.id, 'accepted');
    const b = await makeFinding(workspaceId, agent.id, 'accepted');
    const caseA = (
      await app.inject({ method: 'POST', url: `/findings/${a.finding.id}/eval-case` })
    ).json().case.id;
    const caseB = (
      await app.inject({ method: 'POST', url: `/findings/${b.finding.id}/eval-case` })
    ).json().case.id;

    const batch = await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs` });
    expect(batch.statusCode).toBe(200);
    expect(batch.json().aggregate.cases).toBe(2);

    const before = (await countRuns(caseB))[0]!.actualOutput as { aggregate: unknown };

    const del = await app.inject({ method: 'DELETE', url: `/eval-cases/${caseA}` });
    expect(del.statusCode).toBe(204);

    expect(await countRuns(caseA)).toHaveLength(0);
    const after = (await countRuns(caseB))[0]!.actualOutput as { aggregate: unknown };
    // D3 — a stored aggregate never moves. Recomputing on read is the easier
    // code and would make this "2 cases" become "1" retroactively, turning every
    // v6 → v7 comparison into a comparison of different denominators.
    expect(after.aggregate).toEqual(before.aggregate);
    await app.close();
  });

  // ---- the four pre-flight refusals --------------------------------------

  it('AC-27 — an empty set answers 409 and makes zero provider calls', async () => {
    const llm = new MockLLMProvider('openai', { structured: HIT });
    const app = await appWith({ llm });
    const agent = await makeAgent(workspaceId);

    const res = await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs` });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('no_cases');
    expect(llm.calls).toHaveLength(0);
    await app.close();
  });

  it('AC-28 — a batch already running answers 409 and names its batch_id', async () => {
    /** Blocks inside `completeStructured` until the test releases it. */
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const inner = new MockLLMProvider('openai', { structured: HIT });
    let calls = 0;
    const blocking: LLMProvider = {
      id: 'openai',
      listModels: (): Promise<ModelInfo[]> => inner.listModels(),
      complete: (req: CompletionRequest): Promise<CompletionResult> => inner.complete(req),
      async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
        calls++;
        await gate;
        return inner.completeStructured(req);
      },
      embed: (texts: string[]) => inner.embed(texts),
    };

    const app = await appWith({ llm: blocking });
    const agent = await makeAgent(workspaceId);
    const { finding } = await makeFinding(workspaceId, agent.id, 'accepted');
    await app.inject({ method: 'POST', url: `/findings/${finding.id}/eval-case` });

    const first = app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs` });
    // Let the first request reach the provider and park there.
    await new Promise((r) => setTimeout(r, 50));
    const second = await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs` });

    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe('batch_in_progress');
    expect(second.json().error.details.batch_id).toMatch(/^[0-9a-f-]{36}$/);
    // The refusal cost nothing: still exactly the first batch's single call.
    expect(calls).toBe(1);

    release();
    const done = await first;
    expect(done.statusCode).toBe(200);
    expect(second.json().error.details.batch_id).toBe(done.json().batch_id);

    // …and the lock is released, so the set is runnable again.
    const third = await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs` });
    expect(third.statusCode).toBe(200);
    await app.close();
  });

  it('AC-29 — no provider key answers 409 before the first call and writes no row', async () => {
    // No `llm` override at all, and `MockSecretsProvider({})` holds no keys, so
    // `container.llm('openai')` throws `ConfigError`.
    const app = await appWith();
    const agent = await makeAgent(workspaceId);
    const { finding } = await makeFinding(workspaceId, agent.id, 'accepted');
    const caseId = (
      await app.inject({ method: 'POST', url: `/findings/${finding.id}/eval-case` })
    ).json().case.id;

    const res = await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs` });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('provider_not_configured');
    expect(await countRuns(caseId)).toHaveLength(0);
    await app.close();
  });

  it('AC-67/AC-68 — an owner in another workspace is a 404 that runs nothing', async () => {
    const llm = new MockLLMProvider('openai', { structured: HIT });
    const app = await appWith({ llm });
    // The agent, its case and its runs all live in the OTHER workspace; the app
    // resolves the default one through `LocalNoAuthProvider`.
    const foreign = await makeAgent(otherWorkspaceId);
    const [foreignCase] = await pg.handle.db
      .insert(t.evalCases)
      .values({
        workspaceId: otherWorkspaceId,
        ownerKind: 'agent',
        ownerId: foreign.id,
        name: 'not-yours',
        inputDiff: 'diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1,1 +1,2 @@\n a\n+b',
        inputFiles: ['x'],
        inputMeta: null,
        expectedOutput: [],
        notes: null,
      })
      .returning();

    // A COMPLETED batch belonging to that other workspace. `eval_runs` has no
    // `workspace_id`, so the only thing keeping this row out of the reads below
    // is the join through `eval_cases` — the exact "parent scoped, child
    // assumed" shape `server/INSIGHTS.md` warns this table would repeat.
    const foreignBatchId = '00000000-0000-4000-8000-0000000000ff';
    await pg.handle.db.insert(t.evalRuns).values({
      caseId: foreignCase!.id,
      actualOutput: {
        batch_id: foreignBatchId,
        agent_id: foreign.id,
        agent_version: 1,
        provider: 'openai',
        model: 'gpt-4.1',
        skills: [],
        findings: [],
        findings_truncated: false,
        returned: 0,
        dropped: 0,
        error: null,
        aggregate: {
          batch_id: foreignBatchId,
          completed_at: new Date().toISOString(),
          cases: 1,
          passed: 1,
          errored: 0,
          recall: 1,
          precision: 1,
          citation_accuracy: 1,
          cost_usd: 0.01,
          duration_ms: 10,
          case_ids: [foreignCase!.id],
        },
      },
      pass: true,
      recall: 1,
      precision: 1,
      citationAccuracy: 1,
      durationMs: 10,
      costUsd: 0.01,
    });

    const list = await app.inject({ method: 'GET', url: `/agents/${foreign.id}/eval-cases` });
    expect(list.statusCode).toBe(404);

    const read = await app.inject({ method: 'GET', url: `/eval-cases/${foreignCase!.id}` });
    expect(read.statusCode).toBe(404);

    const run = await app.inject({ method: 'POST', url: `/eval-cases/${foreignCase!.id}/run` });
    expect(run.statusCode).toBe(404);

    const batch = await app.inject({ method: 'POST', url: `/agents/${foreign.id}/eval-runs` });
    expect(batch.statusCode).toBe(404);

    const del = await app.inject({ method: 'DELETE', url: `/eval-cases/${foreignCase!.id}` });
    expect(del.statusCode).toBe(404);

    const dash = await app.inject({ method: 'GET', url: `/agents/${foreign.id}/eval-dashboard` });
    expect(dash.statusCode).toBe(404);

    // The foreign batch is invisible to every batch read of THIS workspace.
    const all = await app.inject({ method: 'GET', url: '/eval-dashboard' });
    expect(all.statusCode).toBe(200);
    expect(
      all.json().recent.map((b: { batch_id: string }) => b.batch_id),
    ).not.toContain(foreignBatchId);
    expect(
      all.json().cards.map((c: { agent_id: string }) => c.agent_id),
    ).not.toContain(foreign.id);

    const cmp = await app.inject({
      method: 'GET',
      url: `/eval-batches/compare?a=${foreignBatchId}&b=${foreignBatchId}`,
    });
    expect(cmp.statusCode).toBe(404);

    // AND AT THE REPOSITORY, DIRECTLY. The four assertions above all pass with
    // the workspace filter deleted from `completedBatches`, because the service
    // resolves the agent through `agentsRepo.getById(workspaceId, …)` first and
    // that second lock hides the first. C13 says the JOIN is the primary
    // defence — `eval_runs` has no `workspace_id` of its own — so it is checked
    // here where nothing else can stand in for it. Measured: removing
    // `c.workspace_id = …` from `completedBatches` leaves every route-level
    // assertion above green and fails only these.
    const repo = new EvalRepository(pg.handle.db);
    expect(await repo.completedBatches(workspaceId, { limit: 50 })).not.toContainEqual(
      expect.objectContaining({ batch_id: foreignBatchId }),
    );
    expect(await repo.batchById(workspaceId, foreignBatchId)).toBeUndefined();
    expect(await repo.latestRunPerCase(workspaceId, foreign.id)).toEqual([]);
    expect(await repo.runsForCases(workspaceId, [foreignCase!.id], 10)).toEqual([]);
    expect(await repo.getCase(workspaceId, foreignCase!.id)).toBeUndefined();
    expect(await repo.listCases(workspaceId, foreign.id)).toEqual([]);
    expect(await repo.caseCountsByOwner(workspaceId)).not.toContainEqual(
      expect.objectContaining({ ownerId: foreign.id }),
    );
    // …and the same reads from the OTHER side see it, so the emptiness above is
    // the scoping and not a broken query.
    expect(await repo.batchById(otherWorkspaceId, foreignBatchId)).toBeDefined();
    expect(await repo.latestRunPerCase(otherWorkspaceId, foreign.id)).toHaveLength(1);
    expect(await repo.runsForCases(otherWorkspaceId, [foreignCase!.id], 10)).toHaveLength(1);

    // An aggregate write addressed by batch id alone would cross the tenant
    // boundary too, so it carries the same join.
    await repo.updateRunEnvelopes(workspaceId, foreignBatchId, { batch_id: 'tampered' });
    const untouched = await repo.batchById(otherWorkspaceId, foreignBatchId);
    expect((untouched!.aggregate as { batch_id: string }).batch_id).toBe(foreignBatchId);

    // Nothing was run, and nothing was deleted.
    expect(llm.calls).toHaveLength(0);
    const still = await pg.handle.db
      .select()
      .from(t.evalCases)
      .where(eq(t.evalCases.id, foreignCase!.id));
    expect(still).toHaveLength(1);
    await app.close();
  });

  // ---- the reads over real jsonb ------------------------------------------

  it('the case set carries the three last-run states and the N/M passing badge', async () => {
    const llm = new MockLLMProvider('openai', { structured: HIT });
    const app = await appWith({ llm });
    const agent = await makeAgent(workspaceId);
    const hit = await makeFinding(workspaceId, agent.id, 'accepted');
    const miss = await makeFinding(workspaceId, agent.id, 'accepted');
    const neverRun = await makeFinding(workspaceId, agent.id, 'accepted');

    const ids: string[] = [];
    for (const f of [hit, miss, neverRun]) {
      const res = await app.inject({ method: 'POST', url: `/findings/${f.finding.id}/eval-case` });
      ids.push(res.json().case.id);
    }
    // Move the second case's expectation somewhere the model never reports, so
    // it runs and FAILS rather than never running.
    await app.inject({
      method: 'PUT',
      url: `/eval-cases/${ids[1]}`,
      payload: {
        expected_output: [
          { file: CITED_FILE, start_line: 10, end_line: 10, polarity: 'must_find' },
        ],
      },
    });

    await app.inject({ method: 'POST', url: `/eval-cases/${ids[0]}/run` });
    await app.inject({ method: 'POST', url: `/eval-cases/${ids[1]}/run` });

    const set = await app.inject({ method: 'GET', url: `/agents/${agent.id}/eval-cases` });
    const body = set.json();
    expect(body.total).toBe(3);
    expect(body.passing).toBe(1);

    const byId = new Map(body.cases.map((c: { id: string }) => [c.id, c]));
    expect(byId.get(ids[0]!).last_run.pass).toBe(true);
    expect(byId.get(ids[0]!).last_run.findings_count).toBe(1);
    expect(byId.get(ids[1]!).last_run.pass).toBe(false);
    // The third state: never run.
    expect(byId.get(ids[2]!).last_run).toBeNull();
    expect(byId.get(ids[2]!).expected_count).toBe(1);
    await app.close();
  });

  it('two batches reach the dashboards and compare old → new', async () => {
    const llm = new MockLLMProvider('openai', { structured: HIT });
    const app = await appWith({ llm });
    const agent = await makeAgent(workspaceId, `compared-${seq++}`);
    const { finding } = await makeFinding(workspaceId, agent.id, 'accepted');
    await app.inject({ method: 'POST', url: `/findings/${finding.id}/eval-case` });

    const one = await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs` });
    // A config change between the two batches bumps the version and snapshots
    // the new prompt — which is what the comparison's prompt diff reads.
    await app.inject({
      method: 'PUT',
      url: `/agents/${agent.id}`,
      payload: { system_prompt: 'You are a security reviewer.\nAlso report style nits.' },
    });
    const two = await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs` });
    expect(one.statusCode).toBe(200);
    expect(two.statusCode).toBe(200);

    const dash = await app.inject({ method: 'GET', url: `/agents/${agent.id}/eval-dashboard` });
    expect(dash.statusCode).toBe(200);
    // `DISTINCT ON (actual_output->>'batch_id')` over the workspace join.
    expect(dash.json().batches).toHaveLength(2);
    expect(dash.json().dashboard.trend).toHaveLength(2);
    expect(dash.json().dashboard.cases_total).toBe(1);
    expect(dash.json().dashboard.alert).toBeTypeOf('string');

    const all = await app.inject({ method: 'GET', url: '/eval-dashboard' });
    expect(all.statusCode).toBe(200);
    const card = all.json().cards.find((c: { agent_id: string }) => c.agent_id === agent.id);
    expect(card.latest.batch_id).toBe(two.json().batch_id);
    expect(card.cases_total).toBe(1);

    const cmp = await app.inject({
      method: 'GET',
      url: `/eval-batches/compare?a=${one.json().batch_id}&b=${two.json().batch_id}`,
    });
    expect(cmp.statusCode).toBe(200);
    const compared = cmp.json();
    expect(compared.a.batch_id).toBe(one.json().batch_id);
    expect(compared.b.batch_id).toBe(two.json().batch_id);
    expect(compared.like_for_like).toBe(true);
    expect(compared.prompt.changed).toBe(true);
    expect(compared.prompt.changed_lines).toEqual([2]);
    expect(compared.prompt.b_text).toContain('Also report style nits.');
    await app.close();
  });

  // ---- a skill's own reciprocal view --------------------------------------

  it('GET /skills/:id/eval-cases — a case whose last run had the skill active, with its agent name', async () => {
    const llm = new MockLLMProvider('openai', { structured: HIT });
    const app = await appWith({ llm });
    const agent = await makeAgent(workspaceId);
    const skill = await makeSkill(workspaceId);
    const other = await makeSkill(workspaceId);
    await bindSkill(agent.id, skill.id);
    const { finding } = await makeFinding(workspaceId, agent.id, 'accepted');
    const caseId = (
      await app.inject({ method: 'POST', url: `/findings/${finding.id}/eval-case` })
    ).json().case.id;
    await app.inject({ method: 'POST', url: `/eval-cases/${caseId}/run` });

    const res = await app.inject({ method: 'GET', url: `/skills/${skill.id}/eval-cases` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(1);
    expect(body.passing).toBe(1);
    expect(body.cases[0].id).toBe(caseId);
    expect(body.cases[0].agent_name).toBe(agent.name);
    expect(body.cases[0].owner_id).toBe(agent.id);
    expect(body.cases[0].last_run.pass).toBe(true);
    expect(body.cases[0].last_run.skills).toEqual([{ id: skill.id, name: skill.name }]);

    // The skill nobody bound has nothing to show — not a 404, an empty set.
    const empty = await app.inject({ method: 'GET', url: `/skills/${other.id}/eval-cases` });
    expect(empty.statusCode).toBe(200);
    expect(empty.json()).toEqual({ cases: [], passing: 0, total: 0 });
    await app.close();
  });

  it('GET /skills/:id/eval-cases — a case whose CURRENT latest run dropped the skill is absent, even though an older run had it', async () => {
    const llm = new MockLLMProvider('openai', { structured: HIT });
    const app = await appWith({ llm });
    const agent = await makeAgent(workspaceId);
    const skill = await makeSkill(workspaceId);
    await bindSkill(agent.id, skill.id);
    const { finding } = await makeFinding(workspaceId, agent.id, 'accepted');
    const caseId = (
      await app.inject({ method: 'POST', url: `/findings/${finding.id}/eval-case` })
    ).json().case.id;
    // First run: the skill is bound, so it lands in that run's envelope.
    await app.inject({ method: 'POST', url: `/eval-cases/${caseId}/run` });
    // Unbind, then re-run. The case's TRUE latest run now carries no skills —
    // picking "the newest run where this skill fired" instead of "this case's
    // newest run" would still surface the case here, off a run that is no
    // longer what the case's row shows anywhere else in the product.
    await pg.handle.db
      .delete(t.agentSkills)
      .where(and(eq(t.agentSkills.agentId, agent.id), eq(t.agentSkills.skillId, skill.id)));
    await app.inject({ method: 'POST', url: `/eval-cases/${caseId}/run` });

    const res = await app.inject({ method: 'GET', url: `/skills/${skill.id}/eval-cases` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ cases: [], passing: 0, total: 0 });
    await app.close();
  });

  it('GET /skills/:id/eval-cases — a skill in another workspace 404s', async () => {
    const app = await appWith();
    const foreignSkill = await makeSkill(otherWorkspaceId);

    const res = await app.inject({ method: 'GET', url: `/skills/${foreignSkill.id}/eval-cases` });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
