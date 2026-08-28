/**
 * A pre-work failure fails every run of the fan-out (SPEC-05 § AC-38).
 *
 * The criterion is only interesting because of WHEN the rows are written: a
 * multi-run creates all of its `agent_runs` in one transaction, `queued`, before
 * `executeRuns` is called (`multi-run.repo.ts` `createMultiRun`). Anything that
 * throws between that transaction and the pool therefore leaves rows nobody will
 * ever move — the results page shows columns that never progress, and only a
 * restart's reaper closes them. `MultiRunService.launch`'s `.catch` cannot help:
 * it logs.
 *
 * So what is pinned here is the GUARD, not one step's error handling. The diff
 * load was guarded on its own and the intent deriver answers `{ok:false}` rather
 * than throwing, which made the criterion hold by accident of which steps
 * existed; the second case below is a step that throws from inside the region
 * and is not the diff.
 *
 * No Postgres and no model: the repository, the container and git are stubs.
 */
import { describe, it, expect } from 'vitest';
import type { Container } from '../src/platform/container.js';
import { ReviewRunExecutor } from '../src/modules/reviews/run-executor.js';
import type { ReviewRepository } from '../src/modules/reviews/repository.js';
import type { ReviewAgent, ReviewPull, ReviewRepo } from '../src/modules/reviews/types.js';
import { MockGitClient } from '../src/adapters/mocks.js';
import { runBus } from '../src/platform/sse.js';

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

const agent = (id: string): ReviewAgent => ({
  id,
  name: `agent-${id}`,
  version: 1,
  provider: 'openai',
  model: 'gpt-4.1',
  systemPrompt: 'You review.',
  strategy: 'single-pass',
  ciFailOn: 'critical',
  repoIntel: false,
});

interface Recorded {
  completed: { runId: string; row: Record<string, unknown> }[];
  started: string[];
  traced: string[];
}

/**
 * `opts.failIntent` throws from a pre-work step that is NOT the diff — the class
 * of failure the guard exists for. `opts.failDiff` breaks both routes into the
 * diff (git and the persisted `pr_files` fallback), which is the only way
 * `loadDiff` rejects at all.
 */
function harness(opts: { failDiff?: boolean; failIntent?: boolean; failClaim?: string } = {}) {
  const recorded: Recorded = { completed: [], started: [], traced: [] };

  const container = {
    git: opts.failDiff
      ? ({ diff: async () => { throw new Error('git is gone'); } } as unknown as MockGitClient)
      : new MockGitClient(),
    repoIntel: {
      getCallerSignatures: async () => [],
      getRepoMap: async () => ({ text: '', tokens: 0, cached: false, degraded: true }),
      getFileRank: async () => [],
    },
    tokenizer: { count: (s: string) => s.length },
    config: { promptLogVerbose: false },
    runBus,
    llm: async () => {
      throw new Error('no agent may reach the model on a failed pre-work');
    },
    intentService: {
      derive: async () => {
        if (opts.failIntent) throw new Error('intent store unreachable');
        return { ok: false as const, reason: 'not under test' };
      },
    },
  } as unknown as Container;

  const repo = {
    getPrFiles: async () => {
      if (opts.failDiff) throw new Error('pr_files unreadable');
      return [];
    },
    startAgentRun: async (runId: string) => {
      if (runId === opts.failClaim) throw new Error('deadlock detected');
      recorded.started.push(runId);
      return true;
    },
    completeAgentRun: async (runId: string, row: Record<string, unknown>) => {
      recorded.completed.push({ runId, row });
    },
    saveRunTrace: async (runId: string) => {
      recorded.traced.push(runId);
    },
  } as unknown as ReviewRepository;

  const agents = { linkedSkills: async () => [] } as unknown as Container['agentsRepo'];
  return { recorded, executor: new ReviewRunExecutor(container, repo, agents) };
}

const JOBS = [
  { agent: agent('a'), runId: 'run-a' },
  { agent: agent('b'), runId: 'run-b' },
  { agent: agent('c'), runId: 'run-c' },
];

describe('a pre-work failure fails every queued run of the fan-out', () => {
  it('marks all three failed with ONE reason when a step other than the diff throws', async () => {
    const { recorded, executor } = harness({ failIntent: true });

    await executor.executeRuns('ws-1', PULL, REPO, JOBS, undefined, { concurrency: 3 });

    expect(recorded.completed.map((c) => c.runId)).toEqual(['run-a', 'run-b', 'run-c']);
    const reasons = new Set(recorded.completed.map((c) => String(c.row.error)));
    expect(reasons.size).toBe(1);
    expect([...reasons][0]).toContain('intent store unreachable');
    for (const { row } of recorded.completed) expect(row.status).toBe('failed');
    // AC-38 is about the ROWS, but the trace is what the drawer reads after a
    // reload, and a failed run with no trace shows an empty drawer.
    expect(recorded.traced).toEqual(['run-a', 'run-b', 'run-c']);
  });

  it('never starts — or bills — a single agent when pre-work failed', async () => {
    const { recorded, executor } = harness({ failIntent: true });

    await executor.executeRuns('ws-1', PULL, REPO, JOBS, undefined, { concurrency: 3 });

    // `startAgentRun` is the claim every job makes before it spends anything,
    // and `container.llm` throws in this harness: reaching either would mean the
    // pool ran behind a guard that was supposed to have returned.
    expect(recorded.started).toEqual([]);
  });

  /**
   * The same orphan one layer in. `startAgentRun` is the only step of a job that
   * persists nothing of its own — everything after it fails through
   * `runOneAgent`, which writes the row — so a throwing claim used to leave that
   * one row `queued` while `runWithConcurrency` swallowed the rejection and the
   * pool moved on. The other two runs still have to finish (AC-36).
   */
  it('fails the one run whose claim threw, and lets the other two run', async () => {
    const { recorded, executor } = harness({ failClaim: 'run-b' });

    await executor.executeRuns('ws-1', PULL, REPO, JOBS, undefined, { concurrency: 1 });

    const claimFailure = recorded.completed.find((c) => c.runId === 'run-b');
    expect(String(claimFailure?.row.error)).toContain('deadlock detected');
    expect(claimFailure?.row.status).toBe('failed');
    // The pool drained past it, and no row was left without a terminal write.
    expect(recorded.started).toEqual(['run-a', 'run-c']);
    expect(recorded.completed.map((c) => c.runId).sort()).toEqual(['run-a', 'run-b', 'run-c']);
  });

  it('still names the diff when the diff is what failed', async () => {
    const { recorded, executor } = harness({ failDiff: true });

    await executor.executeRuns('ws-1', PULL, REPO, JOBS, undefined, { concurrency: 3 });

    expect(recorded.completed).toHaveLength(3);
    expect(String(recorded.completed[0]!.row.error)).toContain('Failed to load PR diff');
    expect(recorded.started).toEqual([]);
  });
});
