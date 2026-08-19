/**
 * P1.10 — the two routes through the real Fastify stack, with no Postgres.
 *
 * The two assertions this file exists for are the two halves of one bug that
 * `pnpm arch` cannot see. `OnboardingService` carries the single-flight map that
 * makes AC-74 true, and a map on a second instance is not the same lock, so the
 * guarantee holds only while the composition root hands out ONE instance and the
 * route merely reads it. Until 2026-08-16 `brief/routes.ts` constructed its own,
 * and the lock therefore held "by registration count" — a second `app.register`,
 * or the first non-HTTP caller, would have had a fresh empty Map and nothing
 * would have said so (`server/INSIGHTS.md`).
 *
 * Everything the SQL does is `onboarding.it.test.ts`'s business; what is proved
 * here is what the route decides on top of it — which status code, which error
 * code, and whether a generator is reached at all.
 */
import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { MockAuthProvider, MockSecretsProvider } from '../src/adapters/mocks.js';
import type { Db } from '../src/db/client.js';
import type { OnboardingPage, OnboardingRecord } from '@devdigest/shared';
import type { OnboardingReader } from '../src/modules/onboarding/types.js';

const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const REPO = '22222222-2222-4222-8222-222222222222';

const EMPTY_PAGE: OnboardingPage = {
  tour: null,
  index: {
    status: 'degraded',
    last_indexed_sha: '',
    files_indexed: 0,
    files_skipped: 0,
    updated_at: '1970-01-01T00:00:00.000Z',
  },
  stale: false,
  generate_blocked: 'index_missing',
};

/** Answers every `select … from …` with no rows, and refuses any write. */
function stubDb(): Db {
  const node = () => {
    const self: Record<string, unknown> = {};
    const chain = () => self;
    self.from = chain;
    self.where = chain;
    self.orderBy = chain;
    self.limit = chain;
    self.then = (resolve: (rows: unknown[]) => unknown) => Promise.resolve([]).then(resolve);
    return self;
  };
  return {
    select: () => ({ from: node }),
    insert: () => {
      throw new Error('a route test must not reach a write');
    },
  } as unknown as Db;
}

function app(overrides: { onboarding?: OnboardingReader } = {}) {
  return buildApp({
    config,
    db: stubDb(),
    overrides: {
      auth: new MockAuthProvider(),
      // No secrets at all: any provider this test failed to override throws
      // ConfigError instead of reaching `~/.devdigest/secrets.json` and the network.
      secrets: new MockSecretsProvider({}),
      ...overrides,
    },
  });
}

describe('onboarding routes — the service comes from the composition root (R11)', () => {
  it('hands out ONE instance per app, which is what makes the single-flight map a lock', async () => {
    const server = await app();
    expect(server.container.onboardingService).toBe(server.container.onboardingService);
    await server.close();
  });

  /**
   * The other half. Identity alone would still pass if the route ignored the
   * container and built its own — so this asserts the route actually CONSULTS
   * the port: with no rows in the stub db the real service resolves no repo and
   * answers 404, so a 200 here can only have come from the override.
   */
  it('the route consults container.onboardingService, reaching no repository of its own', async () => {
    const server = await app({
      onboarding: {
        page: async () => EMPTY_PAGE,
        generate: async () => undefined,
      },
    });
    const res = await server.inject({ method: 'GET', url: `/repos/${REPO}/onboarding` });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(EMPTY_PAGE);
    await server.close();
  });

  it('the generator port is memoised too', async () => {
    const server = await app();
    expect(server.container.onboardingGenerator).toBe(server.container.onboardingGenerator);
    await server.close();
  });
});

describe('onboarding routes — tenancy (R2, AC-9)', () => {
  /**
   * A repo in another workspace and a repo that does not exist must be
   * INDISTINGUISHABLE. Both resolve through the workspace-scoped `getRepo`, both
   * come back as no rows, and both answer the same 404 — never 403, and never an
   * empty 200 that confirms the id exists somewhere else.
   */
  it('GET answers 404 for a repo this workspace cannot see', async () => {
    const server = await app();
    const res = await server.inject({ method: 'GET', url: `/repos/${REPO}/onboarding` });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('not_found');
    expect(res.json().error.message).toBe('Repo not found');
    await server.close();
  });

  it('POST answers the identical 404, and reaches no generator before it does', async () => {
    let runs = 0;
    const server = await buildApp({
      config,
      db: stubDb(),
      overrides: {
        auth: new MockAuthProvider(),
        secrets: new MockSecretsProvider({}),
        onboardingGenerator: {
          run: async () => {
            runs += 1;
            throw new Error('unreachable');
          },
        },
      },
    });
    const res = await server.inject({ method: 'POST', url: `/repos/${REPO}/onboarding/generate` });

    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('not_found');
    expect(res.json().error.message).toBe('Repo not found');
    // Tenancy before spend.
    expect(runs).toBe(0);
    await server.close();
  });

  it('an id that is not a uuid is a 422 at the edge, not a 500 downstream', async () => {
    const server = await app();
    const res = await server.inject({ method: 'GET', url: '/repos/not-a-uuid/onboarding' });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('validation_error');
    await server.close();
  });
});

describe('onboarding routes — the body-less POST', () => {
  /**
   * The POST carries NO body and declares no `schema.body`. `apiFetch` omits
   * `content-type` entirely for a body-less POST, and Fastify rejects a declared
   * JSON body as empty when it arrives that way — which would be a 400 on the
   * client's only way of calling this route. The record below is the proof that
   * the request gets through at all; what it contains is the integration test's
   * business.
   */
  it('accepts a POST with no content-type and no body', async () => {
    // Whole enough for the route's audit line, which reads `dropped`,
    // `package_scan` and `inputs` off the record it is about to return.
    const record = {
      generated_at: '2026-08-18T10:00:00.000Z',
      index_state: {
        last_indexed_sha: 'a1b2c3d4',
        files_indexed: 412,
        files_skipped: 3,
        status: 'full',
      },
      dropped: {
        unknown_path: 0,
        unknown_script: 0,
        manager_mismatch: 0,
        unknown_complexity: 0,
        unknown_section: 0,
      },
      package_scan: { depth: 3, excluded_dirs: [], found: 1, shown: 1, bounded: false },
      inputs: [{ id: 'repo_map', status: 'included', tokens: 900, detail: null }],
      attempts: 1,
      tokens_in: 18477,
      cost_usd: 0.0031,
    } as unknown as OnboardingRecord;
    const server = await app({
      onboarding: {
        page: async () => EMPTY_PAGE,
        generate: async () => record,
      },
    });
    const res = await server.inject({ method: 'POST', url: `/repos/${REPO}/onboarding/generate` });

    expect(res.statusCode).toBe(200);
    expect(res.json().generated_at).toBe(record.generated_at);
    await server.close();
  });
});
