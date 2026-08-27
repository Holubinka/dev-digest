/**
 * A run cancelled WHILE IT WAITED must not be resurrected by the worker that
 * eventually picks it up.
 *
 * `startAgentRun` is the pool's claim on a job: it moves the row to `running`
 * only while the row is still in flight, and answers whether it got it. A
 * cancelled row is not in flight, so the claim fails — and that answer is the
 * only durable signal the worker has. It cannot ask the bus: `cancelRun` calls
 * `runBus.complete(runId)`, and `RunBus.complete` DELETES the cancelled flag
 * (`platform/sse.ts:78`), so by the time a slot opens there is nothing in memory
 * left to read.
 *
 * Ignoring the answer is what this file catches, and the cost of ignoring it is
 * money: the whole point of cancelling the seven agents still waiting in a
 * 10-agent multi-run is that they never reach the engine.
 *
 * No Postgres: the container, the repository and the index facade are stubs, the
 * shape `reviews-repo-intel-once.test.ts` established. The stub answers
 * `startAgentRun` exactly as the guarded UPDATE does — false when the row has
 * left the in-flight set.
 */
import { describe, it, expect } from 'vitest';
import type { Container } from '../src/platform/container.js';
import { ReviewRunExecutor } from '../src/modules/reviews/run-executor.js';
import type { ReviewRepository } from '../src/modules/reviews/repository.js';
import type { ReviewAgent, ReviewPull, ReviewRepo } from '../src/modules/reviews/types.js';
import { MockGitClient, MockLLMProvider } from '../src/adapters/mocks.js';
import { runBus } from '../src/platform/sse.js';
import type { LLMProvider, StructuredRequest } from '@devdigest/shared';

const REVIEW = { verdict: 'approve', summary: 'ok', score: 90, findings: [] };

const agent = (model: string): ReviewAgent => ({
  id: `id-${model}`,
  name: `agent-${model}`,
  version: 1,
  provider: 'openai',
  model,
  systemPrompt: 'You review.',
  strategy: 'single-pass',
  ciFailOn: 'critical',
  repoIntel: false,
});

const PULL: ReviewPull = {
  id: 'pr-1',
  repoId: 'repo-1',
  number: 482,
  title: 'Rate-limit the pricing API',
  author: 'octocat',
  body: null,
  base: 'main',
  headSha: 'abc123',
};

const REPO: ReviewRepo = { owner: 'acme', name: 'payments-api' };

/** Records every model that reaches the engine, then answers from the fixture. */
function countingProvider() {
  const inner = new MockLLMProvider('openai', { structuredBySchema: { Review: REVIEW } });
  const models: string[] = [];
  const llm: LLMProvider = {
    id: 'openai',
    listModels: () => inner.listModels(),
    complete: (req) => inner.complete(req),
    embed: (texts) => inner.embed(texts),
    completeStructured: <T>(req: StructuredRequest<T>) => {
      models.push(req.model);
      return inner.completeStructured(req);
    },
  };
  return { llm, models };
}

function harness(llm: LLMProvider, notInFlight: Set<string>) {
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
    llm: async () => llm,
    intentService: { derive: async () => ({ ok: false, reason: 'not under test' }) },
  } as unknown as Container;

  const completed: string[] = [];
  const traced: string[] = [];
  const repo = {
    insertReview: async () => ({ id: 'rev-1' }),
    insertFindings: async () => [],
    markReviewed: async () => undefined,
    // The guarded UPDATE: it claims the row only while the row is in flight.
    startAgentRun: async (runId: string) => !notInFlight.has(runId),
    completeAgentRun: async (runId: string) => {
      completed.push(runId);
    },
    saveRunTrace: async (runId: string) => {
      traced.push(runId);
    },
    getPrFiles: async () => [],
  } as unknown as ReviewRepository;

  const agents = { linkedSkills: async () => [] } as unknown as Container['agentsRepo'];
  return { executor: new ReviewRunExecutor(container, repo, agents), completed, traced };
}

describe('a run cancelled while queued is not started by the pool', () => {
  it('spends nothing on it and leaves its row alone, while the rest of the pool drains', async () => {
    const provider = countingProvider();
    // `run-cancelled` was cancelled while it waited: its row is no longer
    // `queued`, so the claim below finds nothing to move.
    const { executor, completed, traced } = harness(provider.llm, new Set(['run-cancelled']));

    await executor.executeRuns('ws-1', PULL, REPO, [
      { agent: agent('cancelled-model'), runId: 'run-cancelled' },
      { agent: agent('live-model'), runId: 'run-live' },
    ]);

    // THE POINT: the cancelled agent never reached the engine, so it cost $0.
    expect(provider.models).toEqual(['live-model']);
    // And nothing overwrote its row — `cancelled` is still what the PR page reads.
    expect(completed).toEqual(['run-live']);
    expect(traced).toEqual(['run-live']);
  });
});
