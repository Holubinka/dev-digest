/**
 * `executeRuns` fans out ONE AGENT AT A TIME unless a caller asks otherwise.
 *
 * The default is `opts.concurrency ?? 1` in `run-executor.ts`, and it is the
 * single line standing between SPEC-05 and a behaviour change on two paths that
 * § AC-35 says must not change at all: the PR page's review button and
 * `POST /reviews/diff`. Neither passes a sixth argument, so a default of 3 would
 * silently triple their simultaneous model calls and reorder their events with
 * every other test in this package still green — the reviews are the same
 * reviews, only their timing differs, and nothing else here looks at timing.
 *
 * So this file observes the timing directly. Each agent's engine call is held on
 * a deferred promise, which is what makes "in flight" a question that can be
 * asked at all: without a gate every call settles inside one microtask, a pool
 * of three and a loop of one produce the same trace, and the test proves nothing.
 *
 * The gate is keyed on `req.model`, not on the order providers get resolved in.
 * `container.llm(provider)` does not take the agent as an argument, so an
 * order-keyed gate would be asserting that the executor resolves providers in
 * job order — a different property, and one that stops holding the moment the
 * calls overlap, which is exactly the case under test.
 *
 * No Postgres: the container, the repository and the index facade are stubs, the
 * shape `reviews-repo-intel-once.test.ts` established.
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

/** One agent per model string — the model is the key the gate below runs on. */
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

/** A provider whose structured completion blocks until the test releases it. */
function gatedProvider() {
  const inner = new MockLLMProvider('openai', { structuredBySchema: { Review: REVIEW } });
  const started: string[] = [];
  const settled: string[] = [];
  const gates = new Map<string, () => void>();
  const failing = new Set<string>();

  const llm: LLMProvider = {
    id: 'openai',
    listModels: () => inner.listModels(),
    complete: (req) => inner.complete(req),
    embed: (texts) => inner.embed(texts),
    completeStructured: async <T>(req: StructuredRequest<T>) => {
      started.push(req.model);
      await new Promise<void>((resolve) => gates.set(req.model, resolve));
      settled.push(req.model);
      if (failing.has(req.model)) throw new Error(`engine exploded for ${req.model}`);
      return inner.completeStructured(req);
    },
  };

  return {
    llm,
    started,
    settled,
    failing,
    /** Started and not yet released. */
    inFlight: () => started.length - settled.length,
    release: (model: string) => {
      const gate = gates.get(model);
      if (!gate) throw new Error(`${model} has not reached the engine`);
      gates.delete(model);
      gate();
    },
    /** Let the executor run until `predicate` holds, or fail loudly. */
    until: async (predicate: () => boolean, label: string) => {
      for (let i = 0; i < 400; i++) {
        if (predicate()) return;
        await new Promise((r) => setTimeout(r, 2));
      }
      throw new Error(`timed out waiting for ${label} — started: [${started.join(', ')}]`);
    },
  };
}

function harness(gated: ReturnType<typeof gatedProvider>) {
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
    llm: async () => gated.llm,
    intentService: { derive: async () => ({ ok: false, reason: 'not under test' }) },
  } as unknown as Container;

  const repo = {
    insertReview: async () => ({ id: 'rev-1' }),
    insertFindings: async () => [],
    markReviewed: async () => undefined,
    // The pool's claim succeeds — these rows are in flight. Answering `false`
    // would mean "cancelled while it waited", and the job would be skipped.
    startAgentRun: async () => true,
    completeAgentRun: async () => undefined,
    saveRunTrace: async () => undefined,
    getPrFiles: async () => [],
  } as unknown as ReviewRepository;

  const agents = { linkedSkills: async () => [] } as unknown as Container['agentsRepo'];
  return new ReviewRunExecutor(container, repo, agents);
}

describe('executeRuns runs one agent at a time by default', () => {
  /**
   * THE CASE THAT MUST FAIL IF ANYBODY CHANGES `opts.concurrency ?? 1`.
   *
   * Two claims, and they are not the same claim: at most one engine call is ever
   * open — so the PR page still makes one paid call at a time — and agents settle
   * in `jobs` order, so a client sees the events it has always seen, in the order
   * it has always seen them.
   */
  it('starts agent N+1 only after N has settled, in jobs order', async () => {
    const gated = gatedProvider();
    const models = ['seq-1', 'seq-2', 'seq-3'];

    const done = harness(gated).executeRuns(
      'ws-1',
      PULL,
      REPO,
      models.map((m) => ({ agent: agent(m), runId: `run-${m}` })),
    );

    for (const [i, model] of models.entries()) {
      await gated.until(() => gated.started.includes(model), `${model} to start`);
      // The whole property in one line: nothing else may be open beside it.
      expect(gated.inFlight()).toBe(1);
      // And nothing later may have been touched yet, even without being open.
      expect(gated.started).toEqual(models.slice(0, i + 1));
      gated.release(model);
    }

    await done;
    expect(gated.settled).toEqual(models);
  });

  /**
   * The other half of the default's meaning: an explicit ceiling really does
   * overlap runs, and one job rejecting does not stop the pool (AC-36). Without
   * this case the first one is satisfiable by an executor that ignores `opts`.
   */
  it('runs three at once with { concurrency: 3 } and drains the rest after one fails', async () => {
    const gated = gatedProvider();
    const models = ['pool-1', 'pool-2', 'pool-3', 'pool-4', 'pool-5'];
    gated.failing.add('pool-2');

    const done = harness(gated).executeRuns(
      'ws-1',
      PULL,
      REPO,
      models.map((m) => ({ agent: agent(m), runId: `run-${m}` })),
      undefined,
      { concurrency: 3 },
    );

    await gated.until(() => gated.started.length === 3, 'three agents to start');
    expect(gated.inFlight()).toBe(3);
    // The ceiling holds: the fourth is untouched while three are open.
    expect(gated.started).toEqual(['pool-1', 'pool-2', 'pool-3']);

    for (const model of models) {
      await gated.until(() => gated.started.includes(model), `${model} to start`);
      expect(gated.inFlight()).toBeLessThanOrEqual(3);
      gated.release(model);
    }

    await done;
    // pool-2 threw; the other four still reached the engine and settled.
    expect([...gated.settled].sort()).toEqual([...models].sort());
  });
});
