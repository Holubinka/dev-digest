/**
 * The two refusals `POST /reviews/diff` makes BEFORE it spends anything.
 *
 * Hermetic and at the function seam, not through `app.inject()`: both guards are
 * about what must NOT happen — no provider resolved, no model call, no
 * `buildLineIndex` — and the cheapest way to assert "not" is to count the
 * `container.llm` calls, which the route-level suite cannot see. The engine still
 * runs for real against `MockLLMProvider` in the passing case, so the happy path
 * proves the guards let an ordinary diff through rather than that they are
 * absent.
 *
 * Both cases were reproduced against the real functions before the guards
 * existed: the 49-byte body reached the provider and then spent 1345 ms and
 * 478 MB inside `buildLineIndex`, and an all-disabled workspace answered 200 with
 * `reviews: []`, which `devdigest review` reports as exit 0 — "nothing blocking".
 */
import { describe, it, expect } from 'vitest';
import type { Container } from '../src/platform/container.js';
import { runDiffReview } from '../src/modules/reviews/diff-review.js';
import type { ReviewAgent } from '../src/modules/reviews/types.js';
import { MockLLMProvider } from '../src/adapters/mocks.js';

const REVIEW = { verdict: 'approve', summary: 'ok', score: 90, findings: [] };

const AGENT: ReviewAgent = {
  id: 'agent-1',
  name: 'Security',
  version: 1,
  provider: 'openai',
  model: 'gpt-4.1',
  systemPrompt: 'You review.',
  strategy: 'single-pass',
  ciFailOn: 'critical',
  repoIntel: false,
};

/** A three-line hunk with one added line — the shape everything else is measured against. */
const REAL_DIFF = [
  'diff --git a/src/x.ts b/src/x.ts',
  '--- a/src/x.ts',
  '+++ b/src/x.ts',
  '@@ -1,2 +1,3 @@',
  ' const a = 1;',
  '+const b = 2;',
  ' const c = 3;',
  '',
].join('\n');

/**
 * The crafted body from the finding, byte for byte. No trailing newline, so no
 * line follows the `@@` header and the hunk covers nothing while declaring
 * sixteen million lines.
 */
const OVERCLAIMING = 'diff --git a/x b/x\n+++ b/x\n@@ -1,1 +1,16000000 @@';

/** The same attack with one honest file in front of it, which is what defeats a
 *  guard that sums covered lines across the whole diff instead of per hunk. */
const OVERCLAIMING_AFTER_A_REAL_FILE =
  'diff --git a/a b/a\n+++ b/a\n@@ -1,1 +1,1 @@\n+x\n' +
  'diff --git a/b b/b\n+++ b/b\n@@ -1,1 +1,16000000 @@';

/**
 * A file emptied with no context lines: every hunk removes and adds nothing.
 *
 * No trailing newline, and that is load-bearing rather than tidy.
 * `parseUnifiedDiff` treats anything that is not `+`/`-` as a context line
 * (`adapters/git/diff-parser.ts:70-74`), so the empty string `'x\n'.split('\n')`
 * leaves behind counts as one covered line — which is also why the crafted body
 * above has to end at the `@@` header to reach the declared-range fallback.
 */
const DELETION_ONLY = [
  'diff --git a/x b/x',
  '--- a/x',
  '+++ b/x',
  '@@ -1,3 +0,0 @@',
  '-const a = 1;',
  '-const b = 2;',
  '-const c = 3;',
].join('\n');

function harness() {
  const providers: string[] = [];
  const container = {
    llm: async (id: string) => {
      providers.push(id);
      return new MockLLMProvider('openai', { structuredBySchema: { Review: REVIEW } });
    },
  } as unknown as Container;
  return { container, providers };
}

describe('runDiffReview — the diff must be groundable', () => {
  it('refuses a hunk that declares new-side lines it does not carry, before any provider', async () => {
    const { container, providers } = harness();

    await expect(runDiffReview(container, [AGENT], OVERCLAIMING)).rejects.toMatchObject({
      code: 'invalid_diff',
      statusCode: 422,
    });
    // The point of the whole guard: the refusal happens before the paid call,
    // and before `buildLineIndex` materialises the declared range.
    expect(providers).toEqual([]);
  });

  it('refuses that hunk even when an honest file precedes it', async () => {
    const { container, providers } = harness();

    await expect(
      runDiffReview(container, [AGENT], OVERCLAIMING_AFTER_A_REAL_FILE),
    ).rejects.toMatchObject({ code: 'invalid_diff', statusCode: 422 });
    expect(providers).toEqual([]);
  });

  it('refuses a diff whose every hunk covers no new-side line', async () => {
    const { container, providers } = harness();

    await expect(runDiffReview(container, [AGENT], DELETION_ONLY)).rejects.toMatchObject({
      code: 'invalid_diff',
      statusCode: 422,
    });
    expect(providers).toEqual([]);
  });

  it('still refuses a body that is not a diff, and a --name-only summary', async () => {
    const { container } = harness();

    await expect(runDiffReview(container, [AGENT], 'just some text')).rejects.toMatchObject({
      code: 'invalid_diff',
      statusCode: 422,
    });
    await expect(
      runDiffReview(container, [AGENT], 'diff --git a/x b/x\n+++ b/x\n'),
    ).rejects.toMatchObject({ code: 'invalid_diff', statusCode: 422 });
  });

  it('lets an ordinary diff through and reviews it', async () => {
    const { container, providers } = harness();

    const out = await runDiffReview(container, [AGENT], REAL_DIFF);

    expect(out.files).toBe(1);
    expect(out.reviews).toHaveLength(1);
    expect(out.reviews[0]?.agent_name).toBe('Security');
    expect(providers).toEqual(['openai']);
  });
});

describe('runDiffReview — there must be something to review with', () => {
  it('refuses an empty agent list instead of answering an empty, clean-looking result', async () => {
    const { container, providers } = harness();

    // `resolveTargets` with `all: true` returns `[]` — with no error — when every
    // agent in the workspace is disabled. A 200 here makes the CLI exit 0.
    await expect(runDiffReview(container, [], REAL_DIFF)).rejects.toMatchObject({
      code: 'no_enabled_agents',
      statusCode: 409,
    });
    expect(providers).toEqual([]);
  });

  it('says what to do about it', async () => {
    const { container } = harness();

    await expect(runDiffReview(container, [], REAL_DIFF)).rejects.toThrow(/Enable at least one/i);
  });
});
