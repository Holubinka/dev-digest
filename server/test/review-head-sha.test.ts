/**
 * P3 — which state of a PR a review describes.
 *
 * `reviews.head_sha` answers one question the schema could not answer before:
 * "is there a completed review for the head I am looking at?".
 * `pull_requests.last_reviewed_sha` cannot, because it speaks only for the
 * NEWEST completed run; every older review is silent about its own state.
 *
 * Two properties, and neither is visible to a typecheck:
 *
 *  1. `reviewToDto` puts the column on the wire. Without it the field exists in
 *     the contract, in the table and in the client's types, and the browser still
 *     sees `undefined` — `client/src/lib/api.ts` validates nothing at runtime, so
 *     nothing on the way would have complained.
 *  2. The executor persists the head it reviewed. The value is right only because
 *     it comes from the same `pull.headSha` that `markReviewed` gets a few lines
 *     later; taking it from anywhere else would still typecheck and still pass
 *     every other test here.
 *
 * Hermetic: no Postgres. The row is a literal, the repository is a spy, and the
 * engine runs against `MockLLMProvider`.
 */
import { describe, it, expect } from 'vitest';
import type { Container } from '../src/platform/container.js';
import { ReviewRunExecutor } from '../src/modules/reviews/run-executor.js';
import type { ReviewRepository, ReviewRow } from '../src/modules/reviews/repository.js';
import type { ReviewAgent, ReviewPull, ReviewRepo } from '../src/modules/reviews/types.js';
import { reviewToDto } from '../src/modules/reviews/helpers.js';
import { MockGitClient, MockLLMProvider } from '../src/adapters/mocks.js';
import { runBus } from '../src/platform/sse.js';

const HEAD = 'a1b2c3d4e5f6';

function reviewRow(over: Partial<ReviewRow> = {}): ReviewRow {
  return {
    id: 'rev-1',
    workspaceId: 'ws-1',
    prId: 'pr-1',
    agentId: 'agent-1',
    runId: 'run-1',
    headSha: HEAD,
    kind: 'review',
    verdict: 'request_changes',
    summary: 'Two blockers before merge.',
    score: 61,
    model: 'gpt-4.1',
    createdAt: new Date('2026-08-16T09:00:00.000Z'),
    ...over,
  };
}

describe('reviewToDto carries the reviewed state to the wire', () => {
  it('puts head_sha on the DTO', () => {
    expect(reviewToDto(reviewRow(), [])).toMatchObject({ head_sha: HEAD });
  });

  /**
   * A row written before the column existed. `null` must arrive as `null` — not
   * as `undefined`, which JSON drops, and not as the PR's current head, which
   * would make every historical review a review of whatever is checked out now.
   */
  it('carries a null through as null, not as a missing key', () => {
    const dto = reviewToDto(reviewRow({ headSha: null }), []);
    expect(dto.head_sha).toBeNull();
    expect(Object.hasOwn(dto, 'head_sha')).toBe(true);
    expect(JSON.parse(JSON.stringify(dto))).toHaveProperty('head_sha', null);
  });
});

// ---------------------------------------------------------------------------

const REVIEW = { verdict: 'approve', summary: 'ok', score: 90, findings: [] };

const PULL: ReviewPull = {
  id: 'pr-1',
  repoId: 'repo-1',
  number: 482,
  title: 'Add rate limiting to public API endpoints',
  author: 'marisa.koch',
  body: null,
  base: 'main',
  headSha: HEAD,
};

const REPO: ReviewRepo = { owner: 'acme', name: 'payments-api' };

const AGENT: ReviewAgent = {
  id: 'agent-1',
  name: 'agent-1',
  version: 1,
  provider: 'openai',
  model: 'gpt-4.1',
  systemPrompt: 'You review.',
  strategy: 'single-pass',
  ciFailOn: 'critical',
  repoIntel: false,
};

/** Records what the executor hands the repository seam, in order. */
function harness() {
  const inserted: { headSha: string | null }[] = [];
  const marked: { prId: string; sha: string }[] = [];

  const container = {
    git: new MockGitClient(),
    repoIntel: {
      getCallerSignatures: async () => [],
      getRepoMap: async () => ({ text: '', tokens: 0, cached: false, degraded: true }),
      getFileRank: async () => [],
    },
    tokenizer: { count: (s: string) => s.length },
    config: { promptLogVerbose: false },
    runBus,
    llm: async () => new MockLLMProvider('openai', { structuredBySchema: { Review: REVIEW } }),
    intentService: { derive: async () => ({ ok: false, reason: 'not under test' }) },
  } as unknown as Container;

  const repo = {
    insertReview: async (values: { headSha: string | null }) => {
      inserted.push(values);
      return { id: 'rev-1' };
    },
    insertFindings: async () => [],
    markReviewed: async (prId: string, sha: string) => {
      marked.push({ prId, sha });
    },
    // The executor claims the run before it calls the engine, and a `false`
    // answer means the row is no longer in flight — the job is then skipped.
    // This row is in flight, so the claim succeeds.
    startAgentRun: async () => true,
    completeAgentRun: async () => undefined,
    saveRunTrace: async () => undefined,
    getPrFiles: async () => [],
  } as unknown as ReviewRepository;

  const agents = { linkedSkills: async () => [] } as unknown as Container['agentsRepo'];
  return { inserted, marked, executor: new ReviewRunExecutor(container, repo, agents) };
}

describe('a persisted review records the state it reviewed', () => {
  it("writes the pull's head to the repository seam", async () => {
    const { inserted, executor } = harness();

    await executor.executeRuns('ws-1', PULL, REPO, [{ agent: AGENT, runId: 'run-1' }]);

    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({ headSha: HEAD });
  });

  /**
   * The two writes are the same claim recorded in two places, so they are asserted
   * against each other rather than against the literal: a future edit that reads
   * the head from a second source fails here even if that source happens to agree
   * with the fixture.
   */
  it('records the same head the run marks the pull with', async () => {
    const { inserted, marked, executor } = harness();

    await executor.executeRuns('ws-1', PULL, REPO, [{ agent: AGENT, runId: 'run-1' }]);

    expect(marked).toHaveLength(1);
    expect(inserted[0]!.headSha).toBe(marked[0]!.sha);
  });
});
