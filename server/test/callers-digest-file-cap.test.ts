/**
 * `buildCallersDigest` is built ONCE for the whole diff and reused unchanged on
 * every map-reduce chunk (`reviews-repo-intel-once.test.ts` pins that sharing),
 * so its size is what EVERY chunk's prompt pays — not what reviewing one file
 * needs. `getCallerSignatures` only bounds callers PER symbol; nothing bounded
 * how many changed files it was asked about, and a 166-file PR sent a single
 * chunk 275558 tokens against a 200000-token model limit before this cap
 * existed (`server/INSIGHTS.md`, 2026-08-25).
 *
 * No Postgres: same stub harness as `reviews-repo-intel-once.test.ts`.
 */
import { describe, it, expect } from 'vitest';
import type { Container } from '../src/platform/container.js';
import { ReviewRunExecutor } from '../src/modules/reviews/run-executor.js';
import type { ReviewRepository } from '../src/modules/reviews/repository.js';
import type { ReviewAgent, ReviewPull, ReviewRepo } from '../src/modules/reviews/types.js';
import { MockGitClient, MockLLMProvider } from '../src/adapters/mocks.js';
import { runBus } from '../src/platform/sse.js';

const MAX_CALLERS_DIGEST_FILES = 40;
const REVIEW = { verdict: 'approve', summary: 'ok', score: 90, findings: [] };

/** A one-line-change diff touching `n` distinct files. */
function manyFileDiff(n: number): string {
  return Array.from({ length: n }, (_, i) => {
    const path = `src/module${i}.ts`;
    return (
      `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n` +
      `@@ -1,1 +1,2 @@\n export const a${i} = 1;\n+export const b${i} = 2;`
    );
  }).join('\n');
}

function repoIntelSpy() {
  const callerFileLists: string[][] = [];
  return {
    callerFileLists,
    facade: {
      getCallerSignatures: async (_repoId: string, changedFiles: string[]) => {
        callerFileLists.push(changedFiles);
        return [{ file: changedFiles[0]!, symbol: 'x', signature: 'function x()' }];
      },
      getRepoMap: async () => ({ text: '', tokens: 0, cached: false, degraded: true }),
      getFileRank: async () => [],
    },
  };
}

const agent: ReviewAgent = {
  id: 'a',
  name: 'agent-a',
  version: 1,
  provider: 'openai',
  model: 'gpt-4.1',
  systemPrompt: 'You review.',
  strategy: 'single-pass',
  ciFailOn: 'critical',
  repoIntel: true,
};

const PULL: ReviewPull = {
  id: 'pr-1',
  repoId: 'repo-1',
  number: 999,
  title: 'A very large PR',
  author: 'octocat',
  body: null,
  base: 'main',
  headSha: 'abc123',
};

const REPO: ReviewRepo = { owner: 'acme', name: 'payments-api' };

function harness(spy: ReturnType<typeof repoIntelSpy>, fileCount: number) {
  const container = {
    git: new MockGitClient({ diff: manyFileDiff(fileCount) }),
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

const linesFor = (runId: string) => runBus.buffer(runId).map((e) => e.msg);

describe('the callers digest caps how many changed files it queries', () => {
  it('passes at most MAX_CALLERS_DIGEST_FILES files to getCallerSignatures on a 166-file diff', async () => {
    const spy = repoIntelSpy();
    await harness(spy, 166).executeRuns('ws-1', PULL, REPO, [{ agent, runId: 'cap-1' }]);

    expect(spy.callerFileLists).toHaveLength(1);
    expect(spy.callerFileLists[0]).toHaveLength(MAX_CALLERS_DIGEST_FILES);
  });

  it('does not cap a diff already under the limit', async () => {
    const spy = repoIntelSpy();
    await harness(spy, 5).executeRuns('ws-1', PULL, REPO, [{ agent, runId: 'cap-2' }]);

    expect(spy.callerFileLists[0]).toHaveLength(5);
  });

  it('discloses the cut in the run log when files were omitted', async () => {
    const spy = repoIntelSpy();
    await harness(spy, 166).executeRuns('ws-1', PULL, REPO, [{ agent, runId: 'cap-3' }]);

    const lines = linesFor('cap-3');
    expect(
      lines.some((m) => m.includes('126 changed file(s)') && m.includes('40-file cap')),
    ).toBe(true);
  });

  it('says nothing about a cut when nothing was cut', async () => {
    const spy = repoIntelSpy();
    await harness(spy, 5).executeRuns('ws-1', PULL, REPO, [{ agent, runId: 'cap-4' }]);

    const lines = linesFor('cap-4');
    expect(lines.some((m) => m.includes('caller signature(s) attached'))).toBe(true);
    expect(lines.some((m) => m.includes('file cap'))).toBe(false);
  });
});
