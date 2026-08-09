import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClient, type FetchLike } from '../src/api/client.js';
import { Resolver } from '../src/api/resolve.js';
import { DEFAULT_RUN_TIMEOUT_MS } from '../src/config.js';
import { ToolError, type ToolTextResult } from '../src/errors.js';
import { runAgentOnPr, type RunProgressReporter } from '../src/tools/run-agent.js';

const BASE = 'http://127.0.0.1:3001';
const REPO = 'acme/payments-api';
const AGENT = 'Security Reviewer';

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const REPOS = [{ id: 'r1', full_name: REPO }];
const PULLS = [{ id: 'p105', number: 105 }];
const AGENTS = [
  { id: 'a1', name: AGENT, description: 'sec', model: 'gpt-4o', enabled: true },
  { id: 'a2', name: 'Perf', description: 'perf', model: 'gpt-4o-mini', enabled: true },
];

const runRow = (status: string) => ({
  run_id: 'run-9',
  agent_id: 'a1',
  agent_name: AGENT,
  status,
  error: null,
  ran_at: '2026-08-08T10:00:00.000Z',
});

const review = {
  run_id: 'run-9',
  agent_id: 'a1',
  agent_name: AGENT,
  verdict: 'approve',
  summary: 'Looks fine.',
  score: 90,
  created_at: '2026-08-08T10:00:31.000Z',
  findings: [
    {
      severity: 'SUGGESTION',
      category: 'style',
      title: 'Rename this',
      file: 'src/a.ts',
      start_line: 3,
      end_line: 3,
      rationale: 'clarity',
      suggestion: null,
      confidence: 0.4,
    },
  ],
};

const payload = (result: ToolTextResult) =>
  JSON.parse(result.content[0]!.text) as Record<string, unknown>;

/**
 * `statuses` is walked one entry per poll, repeating the last forever — which is
 * how a review that never finishes is expressed.
 */
function harness(statuses: string[]) {
  const posts: { url: string; body: unknown }[] = [];
  let polls = 0;

  const fetchImpl: FetchLike = async (input, init) => {
    const { pathname } = new URL(String(input));
    if (init?.method === 'POST') {
      posts.push({ url: pathname, body: JSON.parse(String(init.body)) });
      return json({ pr_id: 'p105', runs: [{ run_id: 'run-9', agent_id: 'a1' }], reviews: [] });
    }
    if (pathname === '/repos') return json(REPOS);
    if (pathname === '/repos/r1/pulls') return json(PULLS);
    if (pathname === '/agents') return json(AGENTS);
    if (pathname === '/pulls/p105/runs') {
      const status = statuses[Math.min(polls, statuses.length - 1)]!;
      polls += 1;
      return json([runRow(status)]);
    }
    if (pathname === '/pulls/p105/reviews') return json([review]);
    throw new Error(`unexpected request: ${pathname}`);
  };

  const client = new ApiClient({ baseUrl: BASE, fetchImpl });
  return {
    deps: { client, resolver: new Resolver(client), runTimeoutMs: DEFAULT_RUN_TIMEOUT_MS },
    posts,
    get polls() {
      return polls;
    },
  };
}

describe('run_agent_on_pr', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse('2026-08-08T10:00:00.000Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts one named agent and NEVER fans out to all of them', async () => {
    const h = harness(['running', 'done']);
    const promise = runAgentOnPr(h.deps, { repo: REPO, pr: 105, agent: AGENT });
    await vi.advanceTimersByTimeAsync(30_000);
    await promise;

    expect(h.posts).toEqual([{ url: '/pulls/p105/review', body: { agentId: 'a1' } }]);
    // `{all:true}` would multiply the provider bill without being asked.
    expect(JSON.stringify(h.posts)).not.toContain('all');
  });

  it('waits for the run and returns the findings in one call', async () => {
    const h = harness(['running', 'running', 'done']);
    const promise = runAgentOnPr(h.deps, { repo: REPO, pr: 105, agent: AGENT });
    await vi.advanceTimersByTimeAsync(30_000);
    const result = await promise;

    expect(result.isError).toBe(false);
    const body = payload(result);
    expect(body).toMatchObject({
      repo: REPO,
      pr: 105,
      agent: AGENT,
      run_id: 'run-9',
      status: 'done',
      verdict: 'approve',
      score: 90,
      counts: { critical: 0, warning: 0, suggestion: 1 },
    });
    expect((body.findings as unknown[]).length).toBe(1);
  });

  it('returns still_running at the 120s ceiling — not an error, and not a cancellation', async () => {
    const h = harness(['running']);
    const promise = runAgentOnPr(h.deps, { repo: REPO, pr: 105, agent: AGENT });
    await vi.advanceTimersByTimeAsync(DEFAULT_RUN_TIMEOUT_MS + 60_000);
    const result = await promise;

    expect(result.isError).toBe(false);
    const body = payload(result);
    expect(body).toMatchObject({
      status: 'still_running',
      run_id: 'run-9',
      repo: REPO,
      pr: 105,
      agent: AGENT,
      elapsed_s: DEFAULT_RUN_TIMEOUT_MS / 1000,
    });
    expect(body.next_step).toBe(
      'The review is still running. Call get_findings with run_id="run-9" in a minute.',
    );
    // No cancel call was made, and the run keeps going.
    expect(h.posts.map((p) => p.url)).toEqual(['/pulls/p105/review']);
  });

  it('reports a failed run with the run error verbatim', async () => {
    const h = harness(['failed']);
    // The handler is attached BEFORE the clock moves: the rejection happens
    // inside `advanceTimersByTimeAsync`, and a late `.catch` is an unhandled one.
    const settled = runAgentOnPr(h.deps, { repo: REPO, pr: 105, agent: AGENT }).catch(
      (e: unknown) => e,
    );
    await vi.advanceTimersByTimeAsync(10_000);
    const err = await settled;

    expect(err).toBeInstanceOf(ToolError);
    expect((err as ToolError).kind).toBe('run_failed');
  });

  it('emits progress when a reporter is given, and none when it is not', async () => {
    const updates: { elapsedMs: number }[] = [];
    const onProgress: RunProgressReporter = (u) => {
      updates.push({ elapsedMs: u.elapsedMs });
    };

    const withToken = harness(['running']);
    const p1 = runAgentOnPr(
      { ...withToken.deps, onProgress },
      { repo: REPO, pr: 105, agent: AGENT },
    );
    await vi.advanceTimersByTimeAsync(DEFAULT_RUN_TIMEOUT_MS);
    await p1;
    expect(updates.length).toBeGreaterThanOrEqual(6);

    const without = harness(['running']);
    const before = updates.length;
    const p2 = runAgentOnPr(without.deps, { repo: REPO, pr: 105, agent: AGENT });
    await vi.advanceTimersByTimeAsync(DEFAULT_RUN_TIMEOUT_MS);
    await p2;
    expect(updates.length).toBe(before);
  });

  it('names the run id when polling itself fails, so no second run is started', async () => {
    let polls = 0;
    const fetchImpl: FetchLike = async (input, init) => {
      const { pathname } = new URL(String(input));
      if (init?.method === 'POST') {
        return json({ pr_id: 'p105', runs: [{ run_id: 'run-9', agent_id: 'a1' }], reviews: [] });
      }
      if (pathname === '/repos') return json(REPOS);
      if (pathname === '/repos/r1/pulls') return json(PULLS);
      if (pathname === '/agents') return json(AGENTS);
      if (pathname === '/pulls/p105/runs') {
        polls += 1;
        if (polls > 1) throw new Error('connection reset');
        return json([runRow('running')]);
      }
      throw new Error(`unexpected request: ${pathname}`);
    };
    const client = new ApiClient({ baseUrl: BASE, fetchImpl });
    const deps = { client, resolver: new Resolver(client), runTimeoutMs: DEFAULT_RUN_TIMEOUT_MS };

    const settled = runAgentOnPr(deps, { repo: REPO, pr: 105, agent: AGENT }).catch(
      (e: unknown) => e,
    );
    await vi.advanceTimersByTimeAsync(30_000);
    const err = await settled;

    expect(err).toBeInstanceOf(ToolError);
    expect((err as ToolError).message).toContain('run-9');
    expect((err as ToolError).message).toContain('would start a second billed run');
  });
});
