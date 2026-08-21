/**
 * A NUL in model output must not destroy a completed review.
 *
 * This is an integration test on purpose. The unit test beside it exercises
 * `stripNul`, which is the *classifier* — and a passing classifier test says
 * nothing about whether the guard is wired into the write. `server/INSIGHTS.md`
 * records that exact shape ("Testing a guard by calling its classifier directly
 * can pass while the guard is wide open"), and this session produced it once
 * already, so the assertion that matters is a real INSERT against real
 * Postgres.
 *
 * What it reproduces: run `ce536de2` on PR #11 reviewed 109 files, returned two
 * findings and passed citation grounding, then threw
 * `invalid byte sequence for encoding "UTF8": 0x00` at `insertReview`. The run
 * was recorded `failed` with `tokens_in: 0`, and ~167k paid input tokens bought
 * nothing.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { ReviewRepository } from '../src/modules/reviews/repository.js';
import type { RunTrace } from '@devdigest/shared';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import type { Finding } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

/** Built, never written literally — a raw NUL is invisible in a diff. */
const NUL = String.fromCharCode(0);

const finding = (over: Partial<Finding> = {}): Finding =>
  ({
    id: 'f-1',
    severity: 'warning',
    category: 'correctness',
    title: 'Unbounded read',
    file: 'server/src/a.ts',
    start_line: 10,
    end_line: 12,
    rationale: 'The allocation happens before the cap.',
    suggestion: null,
    confidence: 0.8,
    ...over,
  }) as Finding;

d('a NUL in model output does not lose the review', () => {
  let pg: PgFixture;
  let repo: ReviewRepository;
  let workspaceId: string;
  let prId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
    const [pr] = await pg.handle.db.select().from(t.pullRequests);
    prId = pr!.id;
    repo = new ReviewRepository(pg.handle.db);
  }, 120_000);

  afterAll(async () => pg?.stop());

  it('stores a summary that arrived with a NUL in it', async () => {
    const review = await repo.insertReview({
      workspaceId,
      prId,
      agentId: null,
      runId: null,
      headSha: null,
      kind: 'review',
      verdict: 'comment',
      summary: `Two issues${NUL} worth fixing.`,
      score: 60,
      model: 'deepseek/deepseek-v4-flash',
    });

    expect(review.summary).toBe('Two issues worth fixing.');
  });

  it('stores every free-text field of a finding that arrived with a NUL', async () => {
    const review = await repo.insertReview({
      workspaceId,
      prId,
      agentId: null,
      runId: null,
      headSha: null,
      kind: 'review',
      verdict: 'comment',
      summary: 'ok',
      score: 60,
      model: 'm',
    });

    const rows = await repo.insertFindings(review.id, [
      finding({
        file: `server/src${NUL}/a.ts`,
        title: `Unbounded${NUL} read`,
        rationale: `Allocation${NUL} precedes the cap.`,
        suggestion: `Cap${NUL} it first.`,
      }),
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      file: 'server/src/a.ts',
      title: 'Unbounded read',
      rationale: 'Allocation precedes the cap.',
      suggestion: 'Cap it first.',
    });
  });


  /**
   * `model` is not server-controlled: `agents.model` is `z.string().min(1)`
   * from POST/PUT /agents. The comment at this insert used to claim otherwise.
   */
  it('stores a model slug that arrived with a NUL in it', async () => {
    const review = await repo.insertReview({
      workspaceId,
      prId,
      agentId: null,
      runId: null,
      headSha: null,
      kind: 'review',
      verdict: 'comment',
      summary: 'ok',
      score: 60,
      model: `deepseek${NUL}/v4`,
    });

    expect(review.model).toBe('deepseek/v4');
  });

  /**
   * `jsonb` refuses U+0000 too, so the trace is the second place the same byte
   * lands — and it gets there through `log[].msg`, which no one would think of
   * as a model field.
   */
  it('stores a run trace whose log line carries a NUL', async () => {
    // The seed creates no runs, and run_traces has a FK to agent_runs.
    const [run] = await pg.handle.db
      .insert(t.agentRuns)
      .values({ workspaceId, prId, status: 'running' })
      .returning();
    const trace = {
      config: { agent: 'a', version: '1', provider: 'openrouter', model: 'm', pr: 1, source: 'local' },
      stats: { duration_ms: 1, tokens_in: 1, tokens_out: 1, cost_usd: null, findings: 0, grounding: '0/0 passed' },
      prompt_assembly: { system: 's', skills: null, memory: null, specs: null, user: 'u' },
      tool_calls: [],
      raw_output: '',
      memory_pulled: [],
      specs_read: [],
      // `t` is a STRING in `RunLogLine`. It was written as `0` here and the
      // `as unknown as RunTrace` cast hid it; `getRunTrace` now parses what it
      // reads, so a fixture that does not satisfy the contract fails the read
      // rather than being carried out of the database unchecked.
      log: [{ t: '00.31', kind: 'result', msg: `grounding dropped "x${NUL}y": not in diff` }],
    } as unknown as RunTrace;

    await repo.saveRunTrace(run!.id, trace);
    const stored = await repo.getRunTrace(run!.id);

    expect(stored?.log?.[0]?.msg).toBe('grounding dropped "xy": not in diff');
  });

  /**
   * A line number is an int4 column bounded only by `z.number().int()`, and
   * grounding skips the line check entirely for four `kind` values the model
   * itself chooses — so an absurd number reaches the insert.
   */
  it('stores a finding whose line number does not fit an int4', async () => {
    const review = await repo.insertReview({
      workspaceId, prId, agentId: null, runId: null, headSha: null, kind: 'review',
      verdict: 'comment', summary: 'ok', score: 60, model: 'm',
    });

    const rows = await repo.insertFindings(review.id, [
      finding({ start_line: 9_999_999_999, end_line: 9_999_999_999 }),
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]!.startLine).toBe(2_147_483_647);
  });

  /**
   * The measurement that decided the sanitiser's width. Everything except the
   * NUL survives a round trip, so stripping more would rewrite real output —
   * a rationale quoting a diff has tabs in it.
   */
  it('leaves every other awkward character alone', async () => {
    const SOH = String.fromCharCode(1);
    const text = `tab\there${SOH}astral \u{1F9EA} lone \uD800 end`;
    const review = await repo.insertReview({
      workspaceId,
      prId,
      agentId: null,
      runId: null,
      headSha: null,
      kind: 'review',
      verdict: 'comment',
      summary: text,
      score: 60,
      model: 'm',
    });

    expect(review.summary).toContain('tab\there');
    expect(review.summary).toContain(SOH);
    expect(review.summary).toContain('\u{1F9EA}');
  });
});
