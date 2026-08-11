/**
 * `POST /reviews/diff` — the route the `devdigest review` CLI calls, against
 * real Postgres, real migrations and the real `ReviewService`.
 *
 * Two things are pinned here and nowhere else.
 *
 * 1. **The 422 guards.** `assertReviewable` (`modules/reviews/diff-review.ts`)
 *    refuses a body that parsed into nothing the citation gate can anchor to.
 *    `groundFindings` builds its line index from `diff.files[].hunks`
 *    (`reviewer-core/src/grounding.ts:24-39`), so a `git diff --name-only`-shaped
 *    body reaches the model, costs money, and comes back as a confident
 *    `0 findings` with `grounding: "0/0 passed"` (root `INSIGHTS.md`
 *    §"A diff with no @@ hunks makes the grounding gate drop every finding").
 *    Every guard case therefore asserts the provider was NOT reached, not just
 *    the status code: a 422 raised after a paid call would still be a bug.
 *
 * 2. **That nothing is persisted.** `reviews.pr_id` is NOT NULL
 *    (`db/schema/reviews.ts:14-16`), so a working-tree diff has no row to hang a
 *    review or a finding on, and this path writes none. That claim is structural
 *    — `diff-review.ts` imports no repository — but "structural" is not
 *    "checked", and a row written from `service.ts` would satisfy every other
 *    assertion in this file.
 *
 * `seed()` is deliberately NOT called, unlike `intent.it.test.ts` and
 * `blast.it.test.ts`: it inserts a demo review plus two findings
 * (`db/seed.ts:139-175`), which would turn the load-bearing assertion below into
 * arithmetic over a moving baseline instead of a flat zero. Tenancy comes from a
 * `MockAuthProvider` pointed at a workspace this file creates per test, which is
 * also what makes "zero enabled agents" expressible without disabling anyone
 * else's.
 *
 * `MockSecretsProvider({})` is not decoration: with no keys, any provider this
 * suite failed to override throws `ConfigError` instead of reaching the network.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import {
  MockAuthProvider,
  MockLLMProvider,
  MockSecretsProvider,
} from '../src/adapters/mocks.js';
import { parseUnifiedDiff } from '../src/adapters/git/diff-parser.js';
import { MAX_DIFF_CHARS } from '../src/modules/reviews/diff-review.js';
import * as t from '../src/db/schema.js';
import type { Review } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;
const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

/** A real `git diff` fragment: one file, one hunk, new-side lines 10-12. */
const HUNKED_DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,`;

/** Prose. No `diff --git`, no `+++` — `parseUnifiedDiff` finds zero files. */
const NOT_A_DIFF =
  'Please review my changes: I renamed the config loader and added a small cache in front of it.';

/**
 * The `--name-only` / `--stat` shape: genuine file headers, zero `@@` hunks.
 * This is the body that was verified against the live API on 2026-08-09 to reach
 * the model and come back empty.
 */
const NAME_ONLY_DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
diff --git a/src/app.ts b/src/app.ts
--- a/src/app.ts
+++ b/src/app.ts`;

/**
 * A hunk header with nothing under it: the range is declared, no line is
 * covered. NOTE the absence of a trailing newline — a `\n` after the `@@` line
 * parses as one context line and would cover line 10, which is the opposite
 * fixture. The precondition is asserted in the test rather than trusted.
 *
 * The declared range is small on purpose. `buildLineIndex` falls back to
 * `newStart … newStart + newLines` when a hunk covers no lines
 * (`reviewer-core/src/grounding.ts:29-34`), so the same shape with
 * `@@ -1,1 +1,900000000 @@` allocates a Set of a billion numbers instead of
 * failing an assertion — a regression must be red, not an out-of-memory runner.
 */
const EMPTY_HUNK_DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@`;

/**
 * A valid diff padded past `MAX_DIFF_CHARS`, so the only thing that can refuse
 * it is the `DiffReviewBody` cap — the diff itself is reviewable. Well under the
 * route's 512 KiB `bodyLimit`, which would answer 413 instead.
 */
const PAD_LINE = ' unchanged context line\n';
const OVER_CAP_DIFF =
  HUNKED_DIFF + '\n' + PAD_LINE.repeat(Math.ceil(MAX_DIFF_CHARS / PAD_LINE.length) + 1);

/** One finding on a covered line (11), one on a line no hunk covers (999). */
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

let pg: PgFixture;
let seq = 0;

/** A workspace of its own per test — parallel-safe, and no shared agent list. */
async function newWorkspace(): Promise<string> {
  const [ws] = await pg.handle.db
    .insert(t.workspaces)
    .values({ name: `diff-review-${seq++}` })
    .returning();
  return ws!.id;
}

/** One enabled agent on `openai`, so a single override covers the whole run. */
async function addAgent(workspaceId: string, enabled = true): Promise<string> {
  const [agent] = await pg.handle.db
    .insert(t.agents)
    .values({
      workspaceId,
      name: 'diff-reviewer',
      provider: 'openai',
      model: 'gpt-4.1',
      systemPrompt: 'You are a code reviewer.',
      strategy: 'single-pass',
      ciFailOn: 'critical',
      enabled,
    })
    .returning();
  return agent!.id;
}

async function appFor(workspaceId: string) {
  const llm = new MockLLMProvider('openai', {
    structuredBySchema: { Review: REVIEW_FIXTURE },
  });
  const app = await buildApp({
    config: config(),
    db: pg.handle.db,
    overrides: {
      secrets: new MockSecretsProvider({}),
      auth: new MockAuthProvider(
        { id: '00000000-0000-4000-8000-000000000001', email: 'you@local', name: 'You' },
        { id: workspaceId, name: `ws-${workspaceId}` },
      ),
      llm: { openai: llm },
    },
  });
  return { app, llm };
}

/** Every table this route is documented to leave alone. */
async function persistedCounts() {
  const db = pg.handle.db;
  const [runs, reviews, findings, traces] = await Promise.all([
    db.select().from(t.agentRuns),
    db.select().from(t.reviews),
    db.select().from(t.findings),
    db.select().from(t.runTraces),
  ]);
  return {
    agent_runs: runs.length,
    reviews: reviews.length,
    findings: findings.length,
    run_traces: traces.length,
  };
}

d('07 POST /reviews/diff (Testcontainers pg)', () => {
  beforeAll(async () => {
    pg = await startPg();
  });
  afterAll(async () => {
    await pg?.stop();
  });

  it('422s a body that is not a unified diff at all', async () => {
    const workspaceId = await newWorkspace();
    await addAgent(workspaceId);
    const { app, llm } = await appFor(workspaceId);

    const res = await app.inject({
      method: 'POST',
      url: '/reviews/diff',
      payload: { diff: NOT_A_DIFF, all: true },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('invalid_diff');
    // Which branch refused it, not just that one did: every branch answers 422
    // with the same code, so deleting this one would otherwise fall through to
    // the next and change nothing observable.
    expect(res.json().error.message).toMatch(/not a unified diff/i);
    expect(llm.calls).toEqual([]);

    await app.close();
  });

  it('422s a --name-only-shaped diff before the provider is reached', async () => {
    const workspaceId = await newWorkspace();
    await addAgent(workspaceId);
    const { app, llm } = await appFor(workspaceId);

    // The precondition the guard exists for: real files, no anchorable line.
    const parsed = parseUnifiedDiff(NAME_ONLY_DIFF);
    expect(parsed.files).toHaveLength(2);
    expect(parsed.files.reduce((n, f) => n + f.hunks.length, 0)).toBe(0);

    const res = await app.inject({
      method: 'POST',
      url: '/reviews/diff',
      payload: { diff: NAME_ONLY_DIFF, all: true },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('invalid_diff');
    expect(res.json().error.message).toMatch(/no @@ hunks/i);
    // The whole point of the guard: an empty review that cost money is worse
    // than an error.
    expect(llm.calls).toEqual([]);

    await app.close();
  });

  it('422s a diff whose hunks declare a range but cover no line', async () => {
    const workspaceId = await newWorkspace();
    await addAgent(workspaceId);
    const { app, llm } = await appFor(workspaceId);

    // `hunks.length > 0` is satisfied — the count guard alone lets this through.
    const parsed = parseUnifiedDiff(EMPTY_HUNK_DIFF);
    expect(parsed.files.reduce((n, f) => n + f.hunks.length, 0)).toBe(1);
    expect(parsed.files[0]!.hunks[0]!.newLineNumbers).toEqual([]);

    const res = await app.inject({
      method: 'POST',
      url: '/reviews/diff',
      payload: { diff: EMPTY_HUNK_DIFF, all: true },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('invalid_diff');
    // The offending hunk's own numbers: `@@ -10,3 +10,4 @@` claims 4 new-side
    // lines from line 10 and carries none. A message that cannot name them is
    // the "no hunks at all" branch answering for a different fault.
    expect(res.json().error.message).toMatch(/declares 4 new-side line/i);
    expect(llm.calls).toEqual([]);

    await app.close();
  });

  it('422s a diff over MAX_DIFF_CHARS from the schema, not from the handler', async () => {
    const workspaceId = await newWorkspace();
    await addAgent(workspaceId);
    const { app, llm } = await appFor(workspaceId);

    expect(OVER_CAP_DIFF.length).toBeGreaterThan(MAX_DIFF_CHARS);

    const res = await app.inject({
      method: 'POST',
      url: '/reviews/diff',
      payload: { diff: OVER_CAP_DIFF, all: true },
    });

    expect(res.statusCode).toBe(422);
    // `validation_error`, not `invalid_diff`: the body never reached the
    // handler. The padded diff is reviewable, so the cap is the only refusal.
    expect(res.json().error.code).toBe('validation_error');
    expect(llm.calls).toEqual([]);

    await app.close();
  });

  it('400s when the body names neither agentId nor all', async () => {
    const workspaceId = await newWorkspace();
    await addAgent(workspaceId);
    const { app, llm } = await appFor(workspaceId);

    const res = await app.inject({
      method: 'POST',
      url: '/reviews/diff',
      payload: { diff: HUNKED_DIFF },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('invalid_run_request');
    expect(llm.calls).toEqual([]);

    await app.close();
  });

  /**
   * Fail-open is the defect: `{all: true}` in a workspace with no enabled agent
   * resolves to an empty target list, and an empty `reviews` array is a 200 the
   * CLI reads as "the review ran and found nothing blocking" — exit 0 on a diff
   * nothing looked at (`mcp/src/cli/args.ts` HELP §Exit codes, `run.ts:100-121`).
   *
   * The assertion is on the class of the answer rather than an exact code
   * because no contract fixes one: the exit-code contract only distinguishes
   * "could not be run at all", and `ApiClient` turns any non-2xx into the exit 2
   * that means it.
   */
  it('refuses a request that resolves to zero enabled agents', async () => {
    const workspaceId = await newWorkspace();
    await addAgent(workspaceId, false);
    const { app, llm } = await appFor(workspaceId);

    const res = await app.inject({
      method: 'POST',
      url: '/reviews/diff',
      payload: { diff: HUNKED_DIFF, all: true },
    });

    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.json()).not.toHaveProperty('reviews');
    expect(typeof res.json().error?.code).toBe('string');
    expect(llm.calls).toEqual([]);

    await app.close();
  });

  it('reviews a real hunked diff and returns grounded, structured findings', async () => {
    const workspaceId = await newWorkspace();
    await addAgent(workspaceId);
    const { app, llm } = await appFor(workspaceId);

    const res = await app.inject({
      method: 'POST',
      url: '/reviews/diff',
      payload: { diff: HUNKED_DIFF, all: true },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    // The shape `mcp/src/cli/schema.ts` `DiffReviewPayload` parses.
    expect(Object.keys(body).sort()).toEqual(['files', 'reviews']);
    expect(body.files).toBe(1);
    expect(body.reviews).toHaveLength(1);
    expect(body.reviews[0]).toMatchObject({
      agent_name: 'diff-reviewer',
      provider: 'openai',
      model: 'gpt-4.1',
      verdict: 'request_changes',
      summary: 'Hardcoded Stripe secret introduced.',
      // 100 − 35 for the one CRITICAL that survived grounding
      // (`reviewer-core/src/review/reduce.ts:12-17`). `server/README.md:136`:
      // the score is recomputed from the kept findings — never the model's own.
      score: 65,
      // countBlockers over the KEPT findings at ci_fail_on='critical' — the
      // number the CLI's exit code is derived from, not the model's verdict.
      blockers: 1,
      grounding: '1/2 passed',
      dropped: 1,
    });
    expect(body.reviews[0].score).not.toBe(REVIEW_FIXTURE.score);
    // The line-999 finding is off every hunk and does not survive the gate.
    expect(body.reviews[0].findings).toHaveLength(1);
    expect(body.reviews[0].findings[0]).toMatchObject({
      id: 'f-valid',
      severity: 'CRITICAL',
      file: 'src/config.ts',
      start_line: 11,
      end_line: 11,
    });
    expect(llm.calls.map((c) => c.method)).toEqual(['completeStructured']);

    await app.close();
  });

  /**
   * The design claim of the whole route, asserted against the database rather
   * than against the absence of an import.
   */
  it('persists nothing: no agent_runs, no reviews, no findings, no trace', async () => {
    const workspaceId = await newWorkspace();
    await addAgent(workspaceId);
    const { app } = await appFor(workspaceId);

    const before = await persistedCounts();

    const res = await app.inject({
      method: 'POST',
      url: '/reviews/diff',
      payload: { diff: HUNKED_DIFF, all: true },
    });
    expect(res.statusCode).toBe(200);
    // A review that really ran — otherwise "wrote nothing" is trivially true.
    expect(res.json().reviews[0].findings).toHaveLength(1);

    const after = await persistedCounts();
    expect(after).toEqual(before);
    // `seed()` is not called by this file, so the tables are empty in absolute
    // terms and the equality above cannot be satisfied by a matching delete.
    expect(after).toEqual({ agent_runs: 0, reviews: 0, findings: 0, run_traces: 0 });

    await app.close();
  });
});
