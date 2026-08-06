/**
 * Repo-intel enrichment is resolved once per batch, not once per agent.
 *
 * The three parts — callers, repo map, file rank — are keyed on `(repoId,
 * diff)`, and no agent is an input to any of them. They used to be resolved
 * inside `runOneAgent`, so a PR queued against N agents made 3N identical index
 * queries; worse, two agents could see different callers if the indexer wrote
 * between their runs, which is precisely why the diff is loaded once.
 *
 * This pins the call count, because nothing else can: the property lives in
 * WHERE the call site sits — `executeRuns` before the loop rather than
 * `gatherPromptContext` inside it — and moving it back would still typecheck,
 * still pass every other test, and still produce the same prompts.
 *
 * No Postgres: the repository, the container and the index facade are stubs,
 * and the review engine runs for real against `MockLLMProvider`.
 */
import { describe, it, expect } from 'vitest';
import type { Container } from '../src/platform/container.js';
import { ReviewRunExecutor } from '../src/modules/reviews/run-executor.js';
import type { ReviewRepository } from '../src/modules/reviews/repository.js';
import type { ReviewAgent, ReviewPull, ReviewRepo } from '../src/modules/reviews/types.js';
import { MockGitClient, MockLLMProvider } from '../src/adapters/mocks.js';
import { runBus } from '../src/platform/sse.js';

const REVIEW = { verdict: 'approve', summary: 'ok', score: 90, findings: [] };

/** Counts every index query the executor makes. */
function repoIntelSpy() {
  const calls: string[] = [];
  return {
    calls,
    facade: {
      getCallerSignatures: async () => {
        calls.push('getCallerSignatures');
        return [{ file: 'src/limiter.ts', symbol: 'limit', signature: 'function limit()' }];
      },
      getRepoMap: async () => {
        calls.push('getRepoMap');
        return { text: '', tokens: 0, cached: false, degraded: true };
      },
      getFileRank: async () => {
        calls.push('getFileRank');
        return [];
      },
    },
  };
}

const agent = (id: string, repoIntel = true): ReviewAgent => ({
  id,
  name: `agent-${id}`,
  version: 1,
  provider: 'openai',
  model: 'gpt-4.1',
  systemPrompt: 'You review.',
  strategy: 'single-pass',
  ciFailOn: 'critical',
  repoIntel,
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

function harness(spy: ReturnType<typeof repoIntelSpy>) {
  const container = {
    git: new MockGitClient(),
    repoIntel: spy.facade,
    tokenizer: { count: (s: string) => s.length },
    config: { promptLogVerbose: false },
    runBus,
    llm: async () =>
      new MockLLMProvider('openai', { structuredBySchema: { Review: REVIEW } }),
    intentService: { derive: async () => ({ ok: false, reason: 'not under test' }) },
  } as unknown as Container;

  const repo = {
    insertReview: async () => ({ id: 'rev-1' }),
    insertFindings: async () => [],
    markReviewed: async () => undefined,
    completeAgentRun: async () => undefined,
    saveRunTrace: async () => undefined,
    getPrFiles: async () => [],
  } as unknown as ReviewRepository;

  const agents = { linkedSkills: async () => [] } as unknown as Container['agentsRepo'];
  return new ReviewRunExecutor(container, repo, agents);
}

/**
 * No cast: `executeRuns` names `ReviewPull` / `ReviewRepo` / `ReviewAgent`, so
 * the fixtures above ARE its arguments. It used to take three database rows,
 * and the cast this replaces was the visible cost of that.
 */
const run = (executor: ReviewRunExecutor, jobs: { agent: ReviewAgent; runId: string }[]) =>
  executor.executeRuns('ws-1', PULL, REPO, jobs);

describe('repo-intel enrichment is batch pre-work', () => {
  it('queries the index three times for three agents, not nine', async () => {
    const spy = repoIntelSpy();
    await run(harness(spy), [
      { agent: agent('a'), runId: 'run-a' },
      { agent: agent('b'), runId: 'run-b' },
      { agent: agent('c'), runId: 'run-c' },
    ]);

    expect(spy.calls.sort()).toEqual(['getCallerSignatures', 'getFileRank', 'getRepoMap']);
  });

  /**
   * One agent asking is enough. The opted-out agent still gets nothing in its
   * prompt — it selects `NO_REPO_INTEL` — but it must not cause a second round
   * of queries, and it must not suppress the round the other agent needs.
   */
  it('queries once when only one of two agents wants enrichment', async () => {
    const spy = repoIntelSpy();
    await run(harness(spy), [
      { agent: agent('on', true), runId: 'run-on' },
      { agent: agent('off', false), runId: 'run-off' },
    ]);

    expect(spy.calls).toHaveLength(3);
  });

  it('does not touch the index at all when every agent opted out', async () => {
    const spy = repoIntelSpy();
    await run(harness(spy), [
      { agent: agent('off-1', false), runId: 'run-1' },
      { agent: agent('off-2', false), runId: 'run-2' },
    ]);

    expect(spy.calls).toEqual([]);
  });
});

/**
 * The batch logger fans out to every queued run. Anything emitted while
 * enrichment is being resolved therefore lands in EVERY run's SSE buffer and
 * persisted trace — including a run that opted out and received none of it.
 */
describe('the enrichment report reaches only the runs that used it', () => {
  const linesFor = (runId: string) =>
    runBus.buffer(runId).map((e) => e.msg);

  it('tells the opted-in run what was attached and the opted-out run that it was not', async () => {
    const spy = repoIntelSpy();
    await run(harness(spy), [
      { agent: agent('on', true), runId: 'log-on' },
      { agent: agent('off', false), runId: 'log-off' },
    ]);

    const on = linesFor('log-on');
    const off = linesFor('log-off');

    expect(on.some((m) => m.includes('caller signature(s) attached'))).toBe(true);
    // The claim is about a prompt, and this agent's prompt has no callers in it.
    expect(off.some((m) => m.includes('caller signature(s) attached'))).toBe(false);
    expect(off.some((m) => m.includes('Repo intel disabled for this agent'))).toBe(true);
  });

  /** The shared pre-work that really was shared still fans out — diff and intent. */
  it('still fans the batch pre-work out to both runs', async () => {
    const spy = repoIntelSpy();
    await run(harness(spy), [
      { agent: agent('a', true), runId: 'fan-a' },
      { agent: agent('b', false), runId: 'fan-b' },
    ]);

    for (const runId of ['fan-a', 'fan-b']) {
      expect(linesFor(runId).some((m) => m.startsWith('Diff ready'))).toBe(true);
    }
  });
});
