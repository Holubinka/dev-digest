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
