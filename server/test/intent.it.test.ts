import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockGitClient, MockLLMProvider, MockSecretsProvider } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import type { Intent } from '@devdigest/shared';
import { bandConfidence } from '../src/modules/intent/helpers.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;
const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const INTENT_FIXTURE: Intent = {
  intent: 'Rate-limits the public API so one client cannot exhaust the shared quota.',
  in_scope: ['public API endpoints', 'the limiter middleware'],
  out_of_scope: ['billing', 'the admin API'],
  risk_areas: ['performance', 'public API'],
};

const PLAN_FILE = 'specs/rate-limit.md';
const PLAN_TEXT = '# Rate limiting\n\n## Out of scope\n- billing\n- the admin API\n';

/**
 * `review_intent` defaults to openrouter/z-ai/glm-4.7-flash, so the mock is
 * registered under the `openrouter` KEY. `MockLLMProvider`'s own `id` union is
 * ('openai' | 'anthropic'); the key is what `container.llm` resolves on, and
 * `MockSecretsProvider({})` guarantees that an unmocked provider throws
 * ConfigError instead of reaching for ~/.devdigest/secrets.json and the network.
 */
function appWith(opts: { structured?: unknown; files?: Record<string, string> } = {}) {
  return buildApp({
    config: config(),
    db: pg.handle.db,
    overrides: {
      secrets: new MockSecretsProvider({}),
      git: new MockGitClient({ files: opts.files ?? {} }),
      llm: {
        openrouter: new MockLLMProvider('openai', {
          structuredBySchema: { Intent: opts.structured ?? INTENT_FIXTURE },
        }),
      },
    },
  });
}

let pg: PgFixture;
let repoSeq = 0;

interface PrOptions {
  workspaceId: string;
  body?: string | null;
  linkedIssue?: { number: number; title: string; body: string | null; state: string } | null;
  withCommitsAndFiles?: boolean;
}

async function setupPr(opts: PrOptions) {
  const name = `payments-api-${repoSeq++}`;
  const [repo] = await pg.handle.db
    .insert(t.repos)
    .values({ workspaceId: opts.workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning();
  const [pr] = await pg.handle.db
    .insert(t.pullRequests)
    .values({
      workspaceId: opts.workspaceId,
      repoId: repo!.id,
      number: 482,
      title: 'Add rate limiting',
      author: 'marisa.koch',
      branch: 'feat/rl',
      base: 'main',
      headSha: 'a1b2c3d4',
      status: 'needs_review',
      body: opts.body === undefined ? `Rate-limit the public API. Plan: \`${PLAN_FILE}\`` : opts.body,
      linkedIssue: opts.linkedIssue ?? null,
    })
    .returning();
  if (opts.withCommitsAndFiles !== false) {
    await pg.handle.db.insert(t.prCommits).values({
      prId: pr!.id,
      sha: 'a1b2c3d4',
      message: 'Add limiter\n\nlonger body that must not reach the prompt',
      author: 'marisa.koch',
    });
    await pg.handle.db.insert(t.prFiles).values({ prId: pr!.id, path: 'src/config.ts' });
  }
  return { repo: repo!, pr: pr! };
}

d('05 intent routes (Testcontainers pg)', () => {
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

  it('GET returns 200 with null before anything has been computed', async () => {
    const app = await appWith();
    const { pr } = await setupPr({ workspaceId });

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/intent` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toBeNull();

    await app.close();
  });

  it('POST persists the record, and a later GET returns exactly the same object', async () => {
    const app = await appWith({ files: { [PLAN_FILE]: PLAN_TEXT } });
    const { pr } = await setupPr({
      workspaceId,
      linkedIssue: { number: 471, title: 'Unmetered API', body: 'Anyone can flood it.', state: 'open' },
    });

    const post = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/intent` });
    expect(post.statusCode).toBe(200);
    const record = post.json();
    expect(record.intent).toBe(INTENT_FIXTURE.intent);
    expect(record.in_scope).toEqual(INTENT_FIXTURE.in_scope);
    expect(record.risk_areas).toEqual(INTENT_FIXTURE.risk_areas);
    expect(record.provider).toBe('openrouter');
    expect(record.model).toBe('z-ai/glm-4.7-flash');

    const get = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/intent` });
    expect(get.json()).toEqual(record);

    await app.close();
  });

  it('bands the confidence from the evidence that was actually present', async () => {
    const app = await appWith({ files: { [PLAN_FILE]: PLAN_TEXT } });
    const { pr } = await setupPr({
      workspaceId,
      linkedIssue: { number: 471, title: 'Unmetered API', body: null, state: 'open' },
    });

    const record = (await app.inject({ method: 'POST', url: `/pulls/${pr.id}/intent` })).json();

    // Body + linked issue + a plan file that really read: all three documentary
    // sources, so the band is `high` — and it is what bandConfidence says, not a
    // number the model reported.
    expect(record.evidence).toEqual([
      'title',
      'body',
      'linked_issue',
      'plan_spec',
      'commits_files',
    ]);
    expect(record.confidence).toBe(bandConfidence(record.evidence));
    expect(record.confidence).toBe('high');
    expect(record.plan_refs).toEqual([PLAN_FILE]);

    // The commit SUBJECT is the evidence; the rest of the message is not.
    const [row] = await pg.handle.db.select().from(t.prIntent).where(eq(t.prIntent.prId, pr.id));
    expect(row!.tokensIn).toBeGreaterThan(0);
    expect(row!.costUsd).toBeGreaterThan(0);

    await app.close();
  });

  it('degrades when the linked spec is not in the clone: no plan_spec, lower band', async () => {
    // Same app, but the clone holds no files at all.
    const app = await appWith();
    const { pr } = await setupPr({
      workspaceId,
      body: 'Rate-limit the public API. Plan: `specs/does-not-exist.md`',
    });

    const post = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/intent` });
    expect(post.statusCode).toBe(200);
    const record = post.json();

    expect(record.evidence).not.toContain('plan_spec');
    expect(record.plan_refs).toEqual([]);
    // body only ⇒ one documentary source ⇒ medium, not high.
    expect(record.confidence).toBe('medium');

    await app.close();
  });

  it('404s for a PR in another workspace instead of leaking it', async () => {
    const app = await appWith();
    const [other] = await pg.handle.db
      .insert(t.workspaces)
      .values({ name: `other-${repoSeq}` })
      .returning();
    const { pr } = await setupPr({ workspaceId: other!.id });

    const get = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/intent` });
    expect(get.statusCode).toBe(404);
    expect(get.json().error.code).toBe('not_found');

    const post = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/intent` });
    expect(post.statusCode).toBe(404);

    await app.close();
  });

  /**
   * The acceptance criterion for Settings → Models: *"choosing another model
   * there and hitting Recompute writes that model into `pr_intent.model`"*. The
   * default is covered above; this is the other half of the walk, and it is the
   * only assertion that would catch `derive` resolving the registry constant
   * instead of calling `resolveFeatureModel`.
   */
  it('PUT /settings then Recompute writes the OVERRIDDEN model, not the registry default', async () => {
    const app = await appWith();
    const { pr } = await setupPr({ workspaceId });

    try {
      const put = await app.inject({
        method: 'PUT',
        url: '/settings',
        payload: {
          feature_models: {
            review_intent: { provider: 'openrouter', model: 'minimax/minimax-m2.5' },
          },
        },
      });
      expect(put.statusCode).toBe(200);

      const post = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/intent` });
      expect(post.statusCode).toBe(200);
      expect(post.json().model).toBe('minimax/minimax-m2.5');

      const [row] = await pg.handle.db.select().from(t.prIntent).where(eq(t.prIntent.prId, pr.id));
      expect(row!.model).toBe('minimax/minimax-m2.5');
      expect(row!.model).not.toBe('z-ai/glm-4.7-flash');
      expect(row!.provider).toBe('openrouter');
    } finally {
      // The override is a workspace row every later case in this file shares.
      await app.inject({ method: 'PUT', url: '/settings', payload: { feature_models: {} } });
      await app.close();
    }
  });

  it('answers 502 with a reason and writes NO row when the classifier fails', async () => {
    // A fixture that does not satisfy `Intent` makes MockLLMProvider throw at
    // mocks.ts:95-97 — the same shape as an exhausted schema repair.
    const app = await appWith({ structured: { nonsense: true } });
    const { pr } = await setupPr({ workspaceId });

    const post = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/intent` });
    expect(post.statusCode).toBe(502);
    expect(post.json().error.code).toBe('external_service_error');
    expect(post.json().error.message).toMatch(/fixture failed schema/i);

    const rows = await pg.handle.db.select().from(t.prIntent).where(eq(t.prIntent.prId, pr.id));
    expect(rows).toHaveLength(0);
    // And the cached read still reports "nothing computed", not an error.
    expect((await app.inject({ method: 'GET', url: `/pulls/${pr.id}/intent` })).json()).toBeNull();

    await app.close();
  });
});
