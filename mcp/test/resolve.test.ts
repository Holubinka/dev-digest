import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClient, type FetchLike } from '../src/api/client.js';
import { PULL_ID_TTL_MS, Resolver, assertPrNumber, assertRepoSlug } from '../src/api/resolve.js';
import { ToolError } from '../src/errors.js';

const BASE = 'http://127.0.0.1:3001';

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

type Handler = () => Response | Promise<Response>;

function stub(handlers: Record<string, Handler>) {
  const calls: string[] = [];
  const fetchImpl: FetchLike = async (input) => {
    const url = String(input);
    calls.push(url);
    const { pathname } = new URL(url);
    const handler = handlers[pathname];
    if (!handler) throw new Error(`unexpected request: ${url}`);
    return handler();
  };
  return { fetchImpl, calls };
}

const REPOS = [
  { id: 'r1', full_name: 'acme/payments-api', owner: 'acme', name: 'payments-api' },
  { id: 'r2', full_name: 'acme/Web', owner: 'acme', name: 'Web' },
];

const PULLS = [
  { id: 'p105', number: 105, title: 'Smart diff' },
  { id: 'p106', number: 106, title: 'Another' },
];

const AGENTS = [
  { id: 'a1', name: 'Security Reviewer', description: 'sec', model: 'gpt-4o', enabled: true },
  { id: 'a2', name: 'Perf', description: 'perf', model: 'claude-3-5', enabled: false },
];

const client = (fetchImpl: FetchLike, timeoutMs?: number) =>
  new ApiClient({ baseUrl: BASE, fetchImpl, ...(timeoutMs !== undefined ? { timeoutMs } : {}) });

describe('repoId', () => {
  it('matches full_name case-insensitively', async () => {
    const { fetchImpl } = stub({ '/repos': () => json(REPOS) });
    await expect(new Resolver(client(fetchImpl)).repoId('ACME/Payments-API')).resolves.toBe('r1');
  });

  it('is cached for the process lifetime — one GET /repos for many lookups', async () => {
    const { fetchImpl, calls } = stub({ '/repos': () => json(REPOS) });
    const resolver = new Resolver(client(fetchImpl));
    await resolver.repoId('acme/payments-api');
    await resolver.repoId('acme/payments-api');
    await resolver.repoId('acme/web');
    expect(calls).toEqual([`${BASE}/repos`]);
  });

  it('names the repos that WERE imported when the one asked for was not', async () => {
    const { fetchImpl } = stub({ '/repos': () => json(REPOS) });
    const err = await new Resolver(client(fetchImpl)).repoId('acme/missing').catch((e) => e);
    expect(err).toBeInstanceOf(ToolError);
    expect(err.kind).toBe('repo_not_imported');
    expect(err.message).toContain('acme/payments-api');
    expect(err.message).toContain('acme/Web');
    expect(err.message).toContain('this server cannot import repos');
  });

  it('never puts the caller-supplied slug into a URL path', async () => {
    // The slug is only ever compared against API output. `..` segments pass the
    // plan's regex, so the protection is the lookup, not the pattern — pin it.
    const { fetchImpl, calls } = stub({ '/repos': () => json(REPOS) });
    await expect(new Resolver(client(fetchImpl)).repoId('../..')).rejects.toBeInstanceOf(ToolError);
    expect(calls).toEqual([`${BASE}/repos`]);
  });
});

describe('pullId', () => {
  const handlers = { '/repos': () => json(REPOS), '/repos/r1/pulls': () => json(PULLS) };

  it('resolves owner/name + number to the pull id', async () => {
    const { fetchImpl } = stub(handlers);
    await expect(new Resolver(client(fetchImpl)).pullId('acme/payments-api', 105)).resolves.toBe(
      'p105',
    );
  });

  it('is cached for 5 minutes, because GET /repos/:id/pulls writes', async () => {
    let now = 1_000_000;
    const { fetchImpl, calls } = stub(handlers);
    const resolver = new Resolver(client(fetchImpl), { now: () => now });

    await resolver.pullId('acme/payments-api', 105);
    await resolver.pullId('acme/payments-api', 105);
    expect(calls.filter((c) => c.endsWith('/pulls'))).toHaveLength(1);

    now += PULL_ID_TTL_MS - 1;
    await resolver.pullId('acme/payments-api', 105);
    expect(calls.filter((c) => c.endsWith('/pulls'))).toHaveLength(1);

    now += 2;
    await resolver.pullId('acme/payments-api', 105);
    expect(calls.filter((c) => c.endsWith('/pulls'))).toHaveLength(2);
  });

  it('names the PR numbers that exist when the one asked for does not', async () => {
    const { fetchImpl } = stub(handlers);
    const err = await new Resolver(client(fetchImpl))
      .pullId('acme/payments-api', 999)
      .catch((e) => e);
    expect(err.kind).toBe('pr_not_found');
    expect(err.message).toContain('PR #999 not found in acme/payments-api');
    expect(err.message).toContain('105, 106');
  });

  it('treats a nullish PrMeta.id as not-imported rather than crashing', async () => {
    const { fetchImpl } = stub({
      '/repos': () => json(REPOS),
      '/repos/r1/pulls': () => json([{ id: null, number: 105 }]),
    });
    const err = await new Resolver(client(fetchImpl))
      .pullId('acme/payments-api', 105)
      .catch((e) => e);
    expect(err.kind).toBe('pr_not_imported');
  });
});

describe('agentId', () => {
  it('matches the name case-insensitively', async () => {
    const { fetchImpl } = stub({ '/agents': () => json(AGENTS) });
    await expect(new Resolver(client(fetchImpl)).agentId('security reviewer')).resolves.toEqual({
      id: 'a1',
      name: 'Security Reviewer',
    });
  });

  it('reports an unknown name by pointing at list_agents', async () => {
    const { fetchImpl } = stub({ '/agents': () => json(AGENTS) });
    const err = await new Resolver(client(fetchImpl)).agentId('nope').catch((e) => e);
    expect(err.kind).toBe('agent_not_found');
    expect(err.message).toContain('list_agents');
  });

  it('reports ambiguity with the candidates rather than picking one', async () => {
    const { fetchImpl } = stub({
      '/agents': () =>
        json([
          { id: 'a1', name: 'Sec', description: '', model: 'gpt-4o', enabled: true },
          { id: 'a2', name: 'SEC', description: '', model: 'claude-3-5', enabled: true },
        ]),
    });
    const err = await new Resolver(client(fetchImpl)).agentId('sec').catch((e) => e);
    expect(err.kind).toBe('agent_ambiguous');
    expect(err.message).toContain('gpt-4o');
    expect(err.message).toContain('claude-3-5');
  });
});

describe('argument validation', () => {
  it('accepts an owner/name slug', () => {
    expect(assertRepoSlug('acme/payments-api')).toBe('acme/payments-api');
    expect(assertRepoSlug('a.b_c/d-e.f')).toBe('a.b_c/d-e.f');
  });

  it.each(['acme', 'acme/', '/name', 'acme/name/extra', 'acme name/x', 'a/b?c', '', 'a/b%2Fc'])(
    'rejects %j',
    (bad) => {
      const err = (() => {
        try {
          assertRepoSlug(bad);
          return null;
        } catch (e) {
          return e as ToolError;
        }
      })();
      expect(err).toBeInstanceOf(ToolError);
      expect(err!.kind).toBe('invalid_argument');
    },
  );

  it('requires pr to be a positive integer', () => {
    expect(assertPrNumber(105)).toBe(105);
    for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => assertPrNumber(bad)).toThrow(ToolError);
    }
  });
});

describe('the HTTP client behind the resolvers', () => {
  beforeEach(() => vi.useRealTimers());

  it('turns a dead API into the "start it with ./scripts/dev.sh" error', async () => {
    const dead: FetchLike = async () => {
      throw new TypeError('fetch failed');
    };
    const err = await new Resolver(client(dead)).repoId('acme/payments-api').catch((e) => e);
    expect(err.kind).toBe('api_unreachable');
    expect(err.message).toContain('./scripts/dev.sh');
    expect(err.message).toContain(BASE);
  });

  it('aborts a hanging request at the per-request timeout', async () => {
    const hang: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    const err = await new Resolver(client(hang, 5)).repoId('acme/payments-api').catch((e) => e);
    expect(err.kind).toBe('api_unreachable');
  });

  it('turns a moved contract into a loud, self-describing error naming the path', async () => {
    const { fetchImpl } = stub({ '/repos': () => json([{ id: 'r1', slug: 'acme/payments-api' }]) });
    const err = await new Resolver(client(fetchImpl)).repoId('acme/payments-api').catch((e) => e);
    expect(err.kind).toBe('contract_mismatch');
    expect(err.message).toContain('GET /repos');
    expect(err.message).toContain('full_name');
    expect(err.message).toContain('Do not retry');
  });

  it('decodes the {error:{code,message}} envelope from a non-2xx response', async () => {
    const { fetchImpl } = stub({
      '/repos': () => json({ error: { code: 'internal_error', message: 'boom' } }, 500),
    });
    const err = await new Resolver(client(fetchImpl)).repoId('acme/payments-api').catch((e) => e);
    expect(err.kind).toBe('api_error');
    expect(err.message).toContain('internal_error');
    expect(err.message).toContain('boom');
  });

  it('survives a non-JSON body on a non-2xx response', async () => {
    const { fetchImpl } = stub({
      '/repos': () => new Response('<html>502 Bad Gateway</html>', { status: 502 }),
    });
    const err = await new Resolver(client(fetchImpl)).repoId('acme/payments-api').catch((e) => e);
    expect(err.kind).toBe('api_error');
    expect(err.message).toContain('502');
  });
});
