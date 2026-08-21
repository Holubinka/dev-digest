/**
 * P1.10 — the rate limit on the PAID route (R10 / AC-61).
 *
 * TWO THINGS MAKE THIS FILE WHAT IT IS, and both are traps already paid for once
 * on the Risk Brief.
 *
 * 1. **`NODE_ENV: 'development'`, not `'test'`.** `app.ts` skips registering
 *    `@fastify/rate-limit` entirely under `NODE_ENV=test`, so a route-level
 *    `config.rateLimit` has no effect in the ordinary test config and a limit
 *    test written there passes VACUOUSLY — asserting a 200 for every request and
 *    calling it "under the limit". `LOG_LEVEL: 'silent'` goes with it so the
 *    development branch does not reach for a pretty-print transport.
 * 2. **The generator call count, not the status code.** Asserting the 429 alone
 *    would still pass with the limiter wired AFTER the generation — the request
 *    would spend the money and then be told it was over the limit. The number of
 *    calls before and after the 429 is what proves the limiter sits in front of
 *    the spend.
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
import { INDEXER_VERSION } from '../src/modules/repo-intel/constants.js';
import type { OnboardingGenerationResult } from '../src/modules/onboarding/generation-types.js';
import type { AuthProvider, OnboardingDraft } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

/** The route's own `config.rateLimit.max`. Kept as a literal so a change here is deliberate. */
const LIMIT = 6;

const DRAFT: OnboardingDraft = {
  sections: [],
  flows: [],
  reading_path: [],
  tasks: [],
  setup_commands: [],
  packages: [],
  env_vars: [],
  env_vars_truncated: false,
  package_scan: { depth: 3, excluded_dirs: [], found: 0, shown: 0, bounded: false },
  inputs: [],
  dropped: {
    unknown_path: 0,
    unknown_script: 0,
    manager_mismatch: 0,
    unknown_complexity: 0,
    unknown_section: 0,
  },
  sample_files: 0,
  sample_truncated: false,
  budget: 24000,
  input_tokens_counted: 100,
  tokenizer: 'cl100k_base',
  attempts: 1,
  tokens_in: 120,
  provider: 'openrouter',
  model: 'deepseek/deepseek-v4-flash',
  cost_usd: 0.0001,
};

const RESULT: OnboardingGenerationResult = {
  draft: DRAFT,
  audit: { ...DRAFT.dropped, off_chain: 0, unknown_env: 0, probes: 0, samples: [] },
};

let pg: PgFixture;
let repoSeq = 0;

async function setupRepo(workspaceId: string) {
  const name = `limited-${repoSeq++}`;
  const [repo] = await pg.handle.db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning();
  await pg.handle.db.insert(t.repoIndexState).values({
    repoId: repo!.id,
    lastIndexedSha: 'a1b2c3d4',
    indexerVersion: INDEXER_VERSION,
    status: 'full',
    filesIndexed: 100,
    filesSkipped: 0,
    stats: {},
  });
  return repo!;
}

/** `await buildApp` INSIDE the helper — returning `{ app: buildApp() }` surfaces much later. */
async function devApp(auth?: AuthProvider) {
  let runs = 0;
  const app = await buildApp({
    config: loadConfig({
      ...process.env,
      NODE_ENV: 'development',
      LOG_LEVEL: 'silent',
    } as NodeJS.ProcessEnv),
    db: pg.handle.db,
    overrides: {
      secrets: new MockSecretsProvider({}),
      git: new MockGitClient({ files: {} }),
      llmFallback: new MockLLMProvider('openai'),
      ...(auth ? { auth } : {}),
      onboardingGenerator: {
        run: async () => {
          runs += 1;
          return RESULT;
        },
      },
    },
  });
  return { app, runs: () => runs };
}

d('11 onboarding tour — the rate limit is in front of the spend (Testcontainers pg)', () => {
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
   * for `development` too, every assertion below would silently become "6 of 6
   * requests succeeded" — which is what a passing limit test looks like when
   * there is no limiter at all.
   */
  it('the limiter really IS registered in this configuration', async () => {
    const { app } = await devApp();
    const res = await app.inject({ method: 'GET', url: '/workspace' });
    expect(res.headers['x-ratelimit-limit']).toBeDefined();
    await app.close();
  });

  it(`the ${LIMIT + 1}th generation in a minute is 429, and the model is NOT called for it`, async () => {
    const { app, runs } = await devApp();

    try {
      // One repo per request so the single-flight lock cannot collapse them: the
      // limit is per WORKSPACE, and every one of these repos is in the same one.
      const repos = await Promise.all(
        Array.from({ length: LIMIT + 1 }, () => setupRepo(workspaceId)),
      );

      const statuses: number[] = [];
      for (const repo of repos.slice(0, LIMIT)) {
        statuses.push(
          (
            await app.inject({
              method: 'POST',
              url: `/repos/${repo.id}/onboarding/generate`,
            })
          ).statusCode,
        );
      }
      expect(statuses.every((status) => status === 200)).toBe(true);
      const before = runs();
      expect(before).toBe(LIMIT);

      const refused = await app.inject({
        method: 'POST',
        url: `/repos/${repos[LIMIT]!.id}/onboarding/generate`,
      });
      expect(refused.statusCode).toBe(429);

      // THE assertion. The call count is identical either side of the refused
      // request, so the limiter ran ahead of the spend rather than behind it.
      expect(runs()).toBe(before);
      // And nothing was written for the repo that was refused.
      const page = await app.inject({
        method: 'GET',
        url: `/repos/${repos[LIMIT]!.id}/onboarding`,
      });
      expect(page.json().tour).toBeNull();
    } finally {
      await app.close();
    }
  });

  /**
   * AC-61 says per WORKSPACE, and `@fastify/rate-limit` keys by IP by default.
   * Under `app.inject` every request comes from the same address, so a
   * default-keyed limiter and a workspace-keyed one are INDISTINGUISHABLE on the
   * case above — this is the case that tells them apart.
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
        id:
          ((req as { headers?: Record<string, string> } | undefined)?.headers?.['x-workspace'] ??
            workspaceId),
        name: 'w',
      }),
    };

    const { app } = await devApp(headerAuth);

    try {
      const mine = await Promise.all(Array.from({ length: LIMIT }, () => setupRepo(workspaceId)));
      for (const repo of mine) {
        await app.inject({
          method: 'POST',
          url: `/repos/${repo.id}/onboarding/generate`,
          headers: { 'x-workspace': workspaceId },
        });
      }
      const exhausted = await app.inject({
        method: 'POST',
        url: `/repos/${(await setupRepo(workspaceId)).id}/onboarding/generate`,
        headers: { 'x-workspace': workspaceId },
      });
      expect(exhausted.statusCode).toBe(429);

      // Same address, same app, same limiter store — a different tenant.
      const theirs = await setupRepo(second!.id);
      const allowed = await app.inject({
        method: 'POST',
        url: `/repos/${theirs.id}/onboarding/generate`,
        headers: { 'x-workspace': second!.id },
      });
      expect(allowed.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });
});
