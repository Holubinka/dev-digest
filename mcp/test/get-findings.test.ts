import { describe, expect, it } from 'vitest';
import { ApiClient, type FetchLike } from '../src/api/client.js';
import { Resolver } from '../src/api/resolve.js';
import { ToolError, type ToolTextResult } from '../src/errors.js';
import { getFindings } from '../src/tools/get-findings.js';

const BASE = 'http://127.0.0.1:3001';
const REPO = 'acme/payments-api';
const PULL_ID = 'p105';

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

type Handler = () => Response | Promise<Response>;

function stub(handlers: Record<string, Handler>) {
  const calls: string[] = [];
  const fetchImpl: FetchLike = async (input) => {
    const url = String(input);
    calls.push(new URL(url).pathname);
    const handler = handlers[new URL(url).pathname];
    if (!handler) throw new Error(`unexpected request: ${url}`);
    return handler();
  };
  return { fetchImpl, calls };
}

const REPOS = [{ id: 'r1', full_name: REPO }];
const PULLS = [{ id: PULL_ID, number: 105 }];

const runRow = (over: Record<string, unknown> = {}) => ({
  run_id: 'run-done',
  agent_id: 'a1',
  agent_name: 'Security Reviewer',
  provider: 'openai',
  model: 'gpt-4o',
  status: 'done',
  error: null,
  duration_ms: 31_000,
  tokens_in: 1000,
  tokens_out: 200,
  cost_usd: 0.01,
  findings_count: 2,
  grounding: 'ok',
  ran_at: '2026-08-08T10:00:00.000Z',
  score: 72,
  blockers: 1,
  ...over,
});

const findingRow = (over: Record<string, unknown> = {}) => ({
  id: 'f-uuid',
  severity: 'WARNING',
  category: 'bug',
  title: 'A title',
  file: 'src/a.ts',
  start_line: 10,
  end_line: 10,
  rationale: 'because it is wrong',
  suggestion: null,
  confidence: 0.5,
  kind: 'finding',
  trifecta_components: null,
  evidence: null,
  review_id: 'rev-uuid',
  accepted_at: null,
  dismissed_at: null,
  ...over,
});

const reviewRow = (over: Record<string, unknown> = {}) => ({
  id: 'rev-uuid',
  pr_id: PULL_ID,
  agent_id: 'a1',
  run_id: 'run-done',
  agent_name: 'Security Reviewer',
  kind: 'review',
  verdict: 'request_changes',
  summary: 'Two problems worth fixing.',
  score: 72,
  model: 'gpt-4o',
  created_at: '2026-08-08T10:00:31.000Z',
  findings: [findingRow(), findingRow({ severity: 'CRITICAL', title: 'Boom', file: 'src/b.ts' })],
  ...over,
});

/** The tool answers with one JSON object as text; this is how a caller reads it. */
function payload(result: ToolTextResult): Record<string, unknown> {
  return JSON.parse(result.content[0]!.text) as Record<string, unknown>;
}

function deps(handlers: Record<string, Handler>, now = () => Date.parse('2026-08-08T10:02:25.000Z')) {
  const { fetchImpl, calls } = stub({
    '/repos': () => json(REPOS),
    '/repos/r1/pulls': () => json(PULLS),
    ...handlers,
  });
  const client = new ApiClient({ baseUrl: BASE, fetchImpl });
  return { deps: { client, resolver: new Resolver(client), now }, calls };
}

describe('get_findings — the step-8 handoff', () => {
  it('reports a run that is still running as a result, not an error', async () => {
    const { deps: d } = deps({
      '/pulls/p105/runs': () => json([runRow({ run_id: 'run-live', status: 'running' })]),
    });

    const result = await getFindings(d, { repo: REPO, pr: 105, run_id: 'run-live' });
    expect(result.isError).toBe(false);

    const body = payload(result);
    expect(body).toMatchObject({
      status: 'running',
      run_id: 'run-live',
      repo: REPO,
      pr: 105,
      agent: 'Security Reviewer',
      elapsed_s: 145,
    });
    // The two sentences that stop the model starting a second billed run.
    expect(body.next_step).toContain('get_findings with the same run_id');
    expect(body.next_step).toContain('Do not call run_agent_on_pr again');
    expect(body).not.toHaveProperty('findings');
  });

  it('never asks for reviews while the run is unfinished', async () => {
    const { deps: d, calls } = deps({
      '/pulls/p105/runs': () => json([runRow({ run_id: 'run-live', status: 'running' })]),
    });
    await getFindings(d, { repo: REPO, pr: 105, run_id: 'run-live' });
    expect(calls).not.toContain('/pulls/p105/reviews');
  });

  it('returns the projection for that same run_id once it is done', async () => {
    const { deps: d } = deps({
      '/pulls/p105/runs': () => json([runRow()]),
      '/pulls/p105/reviews': () => json([reviewRow()]),
    });

    const result = await getFindings(d, { repo: REPO, pr: 105, run_id: 'run-done' });
    expect(result.isError).toBe(false);

    const body = payload(result);
    expect(body).toMatchObject({
      repo: REPO,
      pr: 105,
      agent: 'Security Reviewer',
      run_id: 'run-done',
      status: 'done',
      verdict: 'request_changes',
      score: 72,
      summary: 'Two problems worth fixing.',
      counts: { critical: 1, warning: 1, suggestion: 0 },
    });
    expect((body.findings as unknown[]).length).toBe(2);
    // Most severe first, and no UUID other than run_id anywhere in the payload.
    expect((body.findings as { severity: string }[])[0]!.severity).toBe('CRITICAL');
    expect(JSON.stringify(body)).not.toContain('f-uuid');
    expect(JSON.stringify(body)).not.toContain('rev-uuid');
  });

  it('picks the newest done run when no run_id is given', async () => {
    const { deps: d } = deps({
      '/pulls/p105/runs': () =>
        json([
          runRow({ run_id: 'run-old', ran_at: '2026-08-01T09:00:00.000Z' }),
          runRow({ run_id: 'run-done', ran_at: '2026-08-08T10:00:00.000Z' }),
        ]),
      '/pulls/p105/reviews': () => json([reviewRow()]),
    });

    const body = payload(await getFindings(d, { repo: REPO, pr: 105 }));
    expect(body.run_id).toBe('run-done');
  });

  it('falls back to the in-flight run when nothing has completed yet', async () => {
    const { deps: d } = deps({
      '/pulls/p105/runs': () => json([runRow({ run_id: 'run-live', status: 'running' })]),
    });
    const body = payload(await getFindings(d, { repo: REPO, pr: 105 }));
    expect(body).toMatchObject({ status: 'running', run_id: 'run-live' });
  });

  it('filters by severity and says how many were left out', async () => {
    const { deps: d } = deps({
      '/pulls/p105/runs': () => json([runRow()]),
      '/pulls/p105/reviews': () => json([reviewRow()]),
    });

    const body = payload(
      await getFindings(d, { repo: REPO, pr: 105, run_id: 'run-done', severity: 'CRITICAL' }),
    );
    expect((body.findings as { severity: string }[]).map((f) => f.severity)).toEqual(['CRITICAL']);
    // counts stay over the WHOLE review, so a filtered answer still shows its size.
    expect(body.counts).toEqual({ critical: 1, warning: 1, suggestion: 0 });
  });

  it('honours limit and explains the trim', async () => {
    const findings = Array.from({ length: 5 }, (_, i) =>
      findingRow({ file: `src/${i}.ts`, title: `t${i}` }),
    );
    const { deps: d } = deps({
      '/pulls/p105/runs': () => json([runRow()]),
      '/pulls/p105/reviews': () => json([reviewRow({ findings })]),
    });

    const body = payload(await getFindings(d, { repo: REPO, pr: 105, limit: 2 }));
    expect((body.findings as unknown[]).length).toBe(2);
    expect(body.note).toBe('showing 2 of 5 — call get_findings with severity="CRITICAL" or a higher limit');
  });

  it('narrows to one agent by name, and names who did run when it matches nobody', async () => {
    const { deps: d } = deps({
      '/pulls/p105/runs': () => json([runRow()]),
      '/pulls/p105/reviews': () => json([reviewRow()]),
    });
    const hit = payload(await getFindings(d, { repo: REPO, pr: 105, agent: 'security reviewer' }));
    expect(hit.run_id).toBe('run-done');

    const err = await getFindings(d, { repo: REPO, pr: 105, agent: 'Perf' }).catch((e) => e);
    expect(err).toBeInstanceOf(ToolError);
    expect(err.message).toContain('Security Reviewer');
    expect(err.message).toContain('run_agent_on_pr');
  });

  it('reports a failed run with its own error text', async () => {
    const { deps: d } = deps({
      '/pulls/p105/runs': () =>
        json([runRow({ status: 'failed', error: 'provider returned 429' })]),
    });

    const err = await getFindings(d, { repo: REPO, pr: 105 }).catch((e) => e);
    expect(err).toBeInstanceOf(ToolError);
    expect(err.kind).toBe('run_failed');
    expect(err.message).toContain('provider returned 429');
    expect(err.message).toContain('Check the run trace in the DevDigest UI.');
  });

  it('says no review has run rather than returning an empty findings list', async () => {
    const { deps: d } = deps({ '/pulls/p105/runs': () => json([]) });

    const result = await getFindings(d, { repo: REPO, pr: 105 });
    expect(result.isError).toBe(false);
    const body = payload(result);
    // An empty `findings` array would read as "this PR is clean". There is no
    // findings key at all, and the next step is named.
    expect(body).not.toHaveProperty('findings');
    expect(body.status).toBe('no_runs');
    expect(body.next_step).toContain('run_agent_on_pr');
  });

  it('rejects a run_id that is not on this PR, listing the ones that are', async () => {
    const { deps: d } = deps({ '/pulls/p105/runs': () => json([runRow()]) });

    const err = await getFindings(d, { repo: REPO, pr: 105, run_id: 'run-nope' }).catch((e) => e);
    expect(err).toBeInstanceOf(ToolError);
    expect(err.message).toContain('run-done');
    expect(err.message).toContain('without run_id');
  });

  it('validates repo and pr before touching the API', async () => {
    const { deps: d, calls } = deps({});
    await expect(getFindings(d, { repo: 'not-a-slug', pr: 105 })).rejects.toBeInstanceOf(ToolError);
    await expect(getFindings(d, { repo: REPO, pr: 0 })).rejects.toBeInstanceOf(ToolError);
    expect(calls).toEqual([]);
  });
});
