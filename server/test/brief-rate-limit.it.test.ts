/**
 * P2 step 8 — the rate limit on the PAID route (R32 / AC-32).
 *
 * TWO THINGS MAKE THIS FILE WHAT IT IS, and both are traps the plan named.
 *
 * 1. **`NODE_ENV: 'development'`, not `'test'`.** `app.ts:105-107` skips
 *    registering `@fastify/rate-limit` entirely under `NODE_ENV=test`, so a
 *    route-level `config.rateLimit` has no effect in the ordinary test config
 *    and a limit test written there passes VACUOUSLY — asserting a 200 for
 *    every request and calling it "under the limit". `LOG_LEVEL: 'silent'` goes
 *    with it so the development branch does not reach for a pretty-print
 *    transport.
 * 2. **The model-call count, not the status code.** Asserting the 429 alone
 *    would still pass with the limiter wired AFTER the compute path — the
 *    request would spend the money and then be told it was over the limit. The
 *    number of calls to the provider, before and after the 429, is what proves
 *    the limiter sits in front of the spend.
 *
 * DB-backed because the route resolves tenancy from Postgres and the
 * `keyGenerator` reads the workspace off the same context.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockGitClient, MockLLMProvider, MockSecretsProvider } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import type { AuthProvider, RiskBrief } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

/** The route's own `config.rateLimit.max`. Kept as a literal so a change here is deliberate. */
const LIMIT = 20;

const ANSWER: RiskBrief = {
  what: 'Adds a per-state risk brief.',
  why: 'Reviewers open a PR cold.',
  risk_level: 'low',
  risks: [],
  review_focus: [],
};

let pg: PgFixture;
let repoSeq = 0;

async function setupPr(workspaceId: string) {
  const name = `limited-${repoSeq++}`;
  const [repo] = await pg.handle.db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning();
  const [pr] = await pg.handle.db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId: repo!.id,
      number: 1,
      title: 'A change',
      author: 'someone',
      branch: 'feat/x',
      base: 'main',
      headSha: `sha-${repoSeq}`,
      status: 'needs_review',
      body: null,
    })
    .returning();
  return pr!;
}

function structuredCalls(llm: MockLLMProvider): number {
  return llm.calls.filter((call) => call.method === 'completeStructured').length;
}

d('10 risk brief — the rate limit is in front of the spend (Testcontainers pg)', () => {
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  /**
   * The guard on this whole file. If `app.ts` ever stops registering the limiter
   * for `development` too, every assertion below would silently become "20 of 20
   * requests succeeded" — which is what a passing limit test looks like when
   * there is no limiter at all.
   */
  it('the limiter really IS registered in this configuration', async () => {
    const app = await buildApp({
      config: loadConfig({
        ...process.env,
        NODE_ENV: 'development',
        LOG_LEVEL: 'silent',
      } as NodeJS.ProcessEnv),
      db: pg.handle.db,
      overrides: { secrets: new MockSecretsProvider({}), git: new MockGitClient({}) },
    });
    const res = await app.inject({ method: 'GET', url: '/workspace' });
    // `x-ratelimit-limit` is set by @fastify/rate-limit on every reply it sees.
    expect(res.headers['x-ratelimit-limit']).toBeDefined();
    await app.close();

    const testEnvApp = await buildApp({
      config: loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv),
      db: pg.handle.db,
      overrides: { secrets: new MockSecretsProvider({}), git: new MockGitClient({}) },
    });
    const off = await testEnvApp.inject({ method: 'GET', url: '/workspace' });
    // The trap, stated as an assertion: under NODE_ENV=test there is no limiter,
    // so a limit test written in that config asserts nothing.
    expect(off.headers['x-ratelimit-limit']).toBeUndefined();
    await testEnvApp.close();
  });

  it(`the ${LIMIT + 1}th POST in a minute is 429, and the model is NOT called for it (R32)`, async () => {
    const llm = new MockLLMProvider('openai', { structuredBySchema: { RiskBrief: ANSWER } });
    const app = await buildApp({
      config: loadConfig({
        ...process.env,
        NODE_ENV: 'development',
        LOG_LEVEL: 'silent',
      } as NodeJS.ProcessEnv),
      db: pg.handle.db,
      overrides: {
        secrets: new MockSecretsProvider({}),
        git: new MockGitClient({}),
        llm: { openai: llm },
      },
    });

    try {
      // One PR per request so the single-flight lock cannot collapse them: the
      // limit is per WORKSPACE, and every one of these PRs is in the same one.
      const prs = await Promise.all(
        Array.from({ length: LIMIT + 1 }, () => setupPr(workspaceId)),
      );

      const statuses: number[] = [];
      for (const pr of prs.slice(0, LIMIT)) {
        statuses.push(
          (await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` })).statusCode,
        );
      }
      expect(statuses.every((status) => status === 200)).toBe(true);
      const callsBefore = structuredCalls(llm);
      expect(callsBefore).toBe(LIMIT);

      const refused = await app.inject({
        method: 'POST',
        url: `/pulls/${prs[LIMIT]!.id}/brief`,
      });
      expect(refused.statusCode).toBe(429);

      // THE assertion. The call count is identical before and after the refused
      // request, so the limiter ran ahead of the spend rather than behind it.
      expect(structuredCalls(llm)).toBe(callsBefore);
      // And nothing was written for the PR that was refused.
      expect(
        (await app.inject({ method: 'GET', url: `/pulls/${prs[LIMIT]!.id}/brief` })).json(),
      ).toBeNull();
    } finally {
      await app.close();
    }
  });

  /**
   * AC-32 says per WORKSPACE, and `@fastify/rate-limit` keys by IP by default.
   * Under `app.inject` every request comes from the same address, so a
   * default-keyed limiter and a workspace-keyed one are INDISTINGUISHABLE on the
   * case above — this is the case that tells them apart.
   *
   * Two workspaces, one app, one limiter store, one address. Exhausting the
   * first must leave the second's allowance untouched: with the default IP key
   * the second workspace would already be refused, which is the guarantee AC-32
   * says we do not have.
   */
  it('the bucket is the WORKSPACE, not the address', async () => {
    const [second] = await pg.handle.db
      .insert(t.workspaces)
      .values({ name: `second-${repoSeq}` })
      .returning();

    /** Resolves the workspace from a header, so one app can act for two tenants. */
    const headerAuth: AuthProvider = {
      currentUser: async () => ({ id: 'u1', email: 'you@local', name: 'You' }),
      currentWorkspace: async (req) => ({
        id: (req?.headers['x-workspace'] as string | undefined) ?? workspaceId,
        name: 'w',
      }),
    };

    const llm = new MockLLMProvider('openai', { structuredBySchema: { RiskBrief: ANSWER } });
    const app = await buildApp({
      config: loadConfig({
        ...process.env,
        NODE_ENV: 'development',
        LOG_LEVEL: 'silent',
      } as NodeJS.ProcessEnv),
      db: pg.handle.db,
      overrides: {
        secrets: new MockSecretsProvider({}),
        git: new MockGitClient({}),
        auth: headerAuth,
        llm: { openai: llm },
      },
    });

    try {
      const first = await Promise.all(Array.from({ length: LIMIT }, () => setupPr(workspaceId)));
      for (const pr of first) {
        await app.inject({
          method: 'POST',
          url: `/pulls/${pr.id}/brief`,
          headers: { 'x-workspace': workspaceId },
        });
      }
      const exhausted = await app.inject({
        method: 'POST',
        url: `/pulls/${(await setupPr(workspaceId)).id}/brief`,
        headers: { 'x-workspace': workspaceId },
      });
      expect(exhausted.statusCode).toBe(429);

      // Same address, same app, same limiter store — a different tenant.
      const otherPr = await setupPr(second!.id);
      const allowed = await app.inject({
        method: 'POST',
        url: `/pulls/${otherPr.id}/brief`,
        headers: { 'x-workspace': second!.id },
      });
      expect(allowed.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });
});
