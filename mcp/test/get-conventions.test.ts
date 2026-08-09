import { describe, expect, it } from 'vitest';
import { ApiClient, type FetchLike } from '../src/api/client.js';
import { Resolver } from '../src/api/resolve.js';
import { ToolError, type ToolTextResult } from '../src/errors.js';
import { getConventions } from '../src/tools/get-conventions.js';

const BASE = 'http://127.0.0.1:3001';
const REPO = 'acme/payments-api';

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const REPOS = [{ id: 'r1', full_name: REPO }];

const SCAN = {
  id: 's1',
  repo_id: 'r1',
  head_sha: 'deadbeef',
  model: 'gpt-4o-mini',
  sample_files: 12,
  candidates_returned: 9,
  candidates_kept: 5,
  created_at: '2026-08-07T09:00:00.000Z',
};

const candidate = (over: Record<string, unknown> = {}) => ({
  id: 'c-uuid',
  repo_id: 'r1',
  scan_id: 's1',
  category: 'testing',
  rule: 'Server tests that touch Postgres are named *.it.test.ts',
  evidence_path: 'TESTING.md',
  evidence_snippet: 'a snippet nobody needs',
  evidence_line: 42,
  evidence_end_line: 44,
  extra_evidence: [{ path: 'x.ts', line: 1, end_line: 2, snippet: 'y' }],
  head_sha: 'deadbeef',
  confidence: 0.9,
  status: 'accepted',
  created_at: '2026-08-07T09:00:00.000Z',
  ...over,
});

function tool(body: unknown) {
  const calls: string[] = [];
  const fetchImpl: FetchLike = async (input) => {
    const { pathname } = new URL(String(input));
    calls.push(pathname);
    if (pathname === '/repos') return json(REPOS);
    if (pathname === '/repos/r1/conventions') return json(body);
    throw new Error(`unexpected request: ${pathname}`);
  };
  const client = new ApiClient({ baseUrl: BASE, fetchImpl });
  return { client, resolver: new Resolver(client), calls };
}

const payload = (result: ToolTextResult) =>
  JSON.parse(result.content[0]!.text) as Record<string, unknown>;

describe('get_conventions', () => {
  it('returns accepted rules by default, with one line of provenance', async () => {
    const t = tool({
      scan: SCAN,
      candidates: [candidate(), candidate({ status: 'pending', rule: 'not this one' })],
    });

    const body = payload(await getConventions(t.client, t.resolver, { repo: REPO }));
    expect(body).toMatchObject({
      repo: REPO,
      status: 'accepted',
      scan: 'extracted 2026-08-07T09:00:00.000Z by gpt-4o-mini',
    });
    expect(body.conventions).toEqual([
      {
        category: 'testing',
        rule: 'Server tests that touch Postgres are named *.it.test.ts',
        evidence: 'TESTING.md:42',
        confidence: 0.9,
      },
    ]);
    expect(JSON.stringify(body)).not.toContain('a snippet nobody needs');
    expect(JSON.stringify(body)).not.toContain('c-uuid');
  });

  it('counts the pending candidates when nothing is accepted yet', async () => {
    const t = tool({
      scan: SCAN,
      candidates: [
        candidate({ status: 'pending' }),
        candidate({ status: 'pending', rule: 'b' }),
        candidate({ status: 'rejected', rule: 'c' }),
      ],
    });

    const result = await getConventions(t.client, t.resolver, { repo: REPO });
    // An empty answer is not an error — it is an answer with a next step.
    expect(result.isError).toBe(false);
    const body = payload(result);
    expect(body.conventions).toEqual([]);
    expect(body.note).toBe(
      `No accepted conventions for ${REPO}. 2 candidates are pending — call get_conventions ` +
        `with status="pending", or accept them in the DevDigest UI.`,
    );
  });

  it('tells the user to run the extraction when nothing has ever been extracted', async () => {
    const t = tool({ scan: null, candidates: [] });

    const body = payload(await getConventions(t.client, t.resolver, { repo: REPO }));
    expect(body.scan).toBeNull();
    expect(body.note).toContain('has not extracted conventions');
    expect(body.note).toContain('paid model call');
  });

  it('returns pending candidates when asked for them', async () => {
    const t = tool({ scan: SCAN, candidates: [candidate({ status: 'pending', rule: 'p' })] });

    const body = payload(
      await getConventions(t.client, t.resolver, { repo: REPO, status: 'pending' }),
    );
    expect(body.status).toBe('pending');
    expect((body.conventions as { rule: string }[]).map((c) => c.rule)).toEqual(['p']);
    expect(body).not.toHaveProperty('note');
  });

  it('trims to the limit and says so', async () => {
    const many = Array.from({ length: 4 }, (_, i) => candidate({ rule: `rule ${i}` }));
    const t = tool({ scan: SCAN, candidates: many });

    const body = payload(await getConventions(t.client, t.resolver, { repo: REPO, limit: 2 }));
    expect((body.conventions as unknown[]).length).toBe(2);
    expect(body.note).toBe('showing 2 of 4 — call get_conventions with a higher limit');
  });

  it('never calls the extraction endpoint — that is a paid model call', async () => {
    const t = tool({ scan: SCAN, candidates: [candidate()] });
    await getConventions(t.client, t.resolver, { repo: REPO });
    expect(t.calls).toEqual(['/repos', '/repos/r1/conventions']);
    expect(t.calls.some((c) => c.includes('extract'))).toBe(false);
  });

  it('rejects a malformed repo before touching the API', async () => {
    const t = tool({ scan: null, candidates: [] });
    await expect(
      getConventions(t.client, t.resolver, { repo: 'not-a-slug' }),
    ).rejects.toBeInstanceOf(ToolError);
    expect(t.calls).toEqual([]);
  });
});
