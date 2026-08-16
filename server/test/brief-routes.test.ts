/**
 * P2 step 8 — the two routes, through the real Fastify stack with `app.inject`.
 *
 * WHAT THE STUB DB IS AND IS NOT. `briefRoutes` builds its own
 * `BriefRepository(container.db)`, so a route test with no Postgres needs a `Db`
 * that answers a `select … from … where` with canned rows. The stub below does
 * exactly that and nothing else: it proves NOTHING about the SQL — which is what
 * `brief.it.test.ts` runs against a real Postgres for — and everything about the
 * decisions the ROUTE makes on top of it: which status code, which error code,
 * and whether a provider is reached at all.
 *
 * That split is deliberate. The three properties below are the ones that must
 * hold on every push, and a unit lane that needs Docker is a unit lane that gets
 * skipped.
 */
import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { MockAuthProvider, MockLLMProvider, MockSecretsProvider } from '../src/adapters/mocks.js';
import { MockPromptTemplates } from '../src/adapters/mocks.js';
import type { Db } from '../src/db/client.js';
import * as t from '../src/db/schema.js';
import type { RiskBrief } from '@devdigest/shared';

const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const PR = '11111111-1111-4111-8111-111111111111';
const HEAD = 'de50d5c364fb';

const PULL_ROW = {
  id: PR,
  repoId: '22222222-2222-4222-8222-222222222222',
  headSha: HEAD,
  title: 'Add the Risk Brief',
  body: 'Briefs a reviewer.',
  linkedIssue: null,
};

const BRIEF_ROW = {
  prId: PR,
  headSha: HEAD,
  what: 'Adds a per-state risk brief.',
  why: 'Reviewers open a PR cold.',
  riskLevel: 'medium' as const,
  risks: [],
  reviewFocus: [],
  inputs: [],
  droppedRefs: [],
  droppedRisks: 0,
  intentComputedAt: null,
  intentFreshness: 'unknown' as const,
  blastStatus: 'degraded',
  linkSha: null,
  indexMatchesHead: false,
  budget: 8000,
  inputTokensCounted: 120,
  tokenizer: 'cl100k_base',
  attempts: 1,
  tokensIn: 100,
  provider: 'openai',
  model: 'gpt-4.1',
  costUsd: 0.001,
  computedAt: new Date('2026-08-16T12:00:00.000Z'),
  evictedCount: 0,
};

const REPO_ROW = { owner: 'Holubinka', name: 'dev-digest' };

const ANSWER: RiskBrief = {
  what: 'Adds a per-state risk brief.',
  why: 'Reviewers open a PR cold.',
  risk_level: 'low',
  risks: [],
  review_focus: [],
};

/** Which canned rows a `select … from <table>` answers with. Unlisted tables give `[]`. */
type Answers = Map<unknown, unknown[]>;

function stubDb(answers: Answers): Db {
  const node = (table: unknown) => {
    const self: Record<string, unknown> = {};
    const chain = () => self;
    self.from = chain;
    self.where = chain;
    self.orderBy = chain;
    self.limit = chain;
    self.innerJoin = chain;
    self.leftJoin = chain;
    self.then = (
      resolve: (rows: unknown[]) => unknown,
      reject: (err: unknown) => unknown,
    ) => Promise.resolve(answers.get(table) ?? []).then(resolve, reject);
    return self;
  };
  return {
    select: () => ({ from: (table: unknown) => node(table) }),
    transaction: () => {
      throw new Error('a route test must not reach a write transaction');
    },
  } as unknown as Db;
}

function app(answers: Answers, opts: { llm?: MockLLMProvider; noKeys?: boolean } = {}) {
  return buildApp({
    config,
    db: stubDb(answers),
    overrides: {
      auth: new MockAuthProvider(),
      prompts: new MockPromptTemplates(),
      // No secrets at all: a provider that is not injected throws ConfigError
      // instead of reaching `~/.devdigest/secrets.json` and the network.
      secrets: new MockSecretsProvider({}),
      ...(opts.noKeys ? {} : { llm: { openai: opts.llm ?? new MockLLMProvider('openai') } }),
    },
  });
}

describe('brief routes — tenancy (R31)', () => {
  /**
   * A PR in another workspace and a PR that does not exist must be
   * INDISTINGUISHABLE. Both resolve through the workspace-scoped `getPull`, so
   * both come back as no rows, and both answer 404 — never 403, and never an
   * empty 200 that confirms the id exists somewhere else.
   */
  it('GET answers the same 404 for a foreign PR as for a missing one', async () => {
    const server = await app(new Map());
    const res = await server.inject({ method: 'GET', url: `/pulls/${PR}/brief` });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('not_found');
    expect(res.json().error.message).toBe('Pull request not found');
    await server.close();
  });

  it('POST answers 404 too, and resolves NO provider before it does', async () => {
    const llm = new MockLLMProvider('openai', { structured: ANSWER });
    const server = await app(new Map(), { llm });
    const res = await server.inject({ method: 'POST', url: `/pulls/${PR}/brief` });

    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('not_found');
    // Tenancy before spend: not one call, not even a `listModels`.
    expect(llm.calls).toHaveLength(0);
    await server.close();
  });

  it('an id that is not a uuid is a 422 at the edge, not a 500 downstream', async () => {
    const server = await app(new Map());
    const res = await server.inject({ method: 'GET', url: '/pulls/not-a-uuid/brief' });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('validation_error');
    await server.close();
  });
});

describe('brief routes — the read (R28)', () => {
  it('GET with no record answers 200 and null', async () => {
    const server = await app(new Map([[t.pullRequests, [PULL_ROW]]]));
    const res = await server.inject({ method: 'GET', url: `/pulls/${PR}/brief` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toBeNull();
    await server.close();
  });

  it('GET with a stored record makes ZERO model calls, however many times it is read', async () => {
    const llm = new MockLLMProvider('openai', { structured: ANSWER });
    const server = await app(
      new Map([
        [t.pullRequests, [PULL_ROW]],
        [t.prBrief, [BRIEF_ROW]],
      ]),
      { llm },
    );

    for (let i = 0; i < 3; i += 1) {
      const res = await server.inject({ method: 'GET', url: `/pulls/${PR}/brief` });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ what: BRIEF_ROW.what, head_sha: HEAD, budget: 8000 });
    }
    expect(llm.calls).toHaveLength(0);
    await server.close();
  });
});

describe('brief routes — failure codes the client branches on (R42)', () => {
  /**
   * `risk_brief` defaults to `openai/gpt-4.1` and a fresh install has no OpenAI
   * key, so this is the OUT-OF-THE-BOX state of this feature, not an edge case.
   * The card's copy for it — "the model for this feature is not configured",
   * with a link to Settings — hangs on the code being `config_error` and not
   * `external_service_error`.
   */
  it('a missing provider key surfaces as config_error, not external_service_error', async () => {
    const server = await app(
      new Map([
        [t.pullRequests, [PULL_ROW]],
        [t.repos, [REPO_ROW]],
      ]),
      { noKeys: true },
    );
    const res = await server.inject({ method: 'POST', url: `/pulls/${PR}/brief` });

    expect(res.statusCode).toBe(500);
    expect(res.json().error.code).toBe('config_error');
    expect(res.json().error.message).toMatch(/OPENAI_API_KEY/);
    await server.close();
  });

  it('a model that fails its schema is external_service_error, with the reason', async () => {
    const llm = new MockLLMProvider('openai', { structured: { nonsense: true } });
    const server = await app(
      new Map([
        [t.pullRequests, [PULL_ROW]],
        [t.repos, [REPO_ROW]],
      ]),
      { llm },
    );
    const res = await server.inject({ method: 'POST', url: `/pulls/${PR}/brief` });

    expect(res.statusCode).toBe(502);
    expect(res.json().error.code).toBe('external_service_error');
    expect(res.json().error.message).toMatch(/fixture failed schema/i);
    await server.close();
  });
});
