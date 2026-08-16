/**
 * P2 steps 1, 5 and 8 — the state-keyed table, against real Postgres and the
 * real migrations.
 *
 * The unit suite fakes the repository, so it can prove what the service does
 * with a row but not that the row behaves: the composite `(pr_id, head_sha)`
 * primary key, the `onConflictDoUpdate` that rests on it, the eviction walk and
 * the cascade are all properties of SQL, and a fake cannot have them wrong in
 * the same way Postgres can. That is what this file is for.
 *
 * `MockSecretsProvider({})` is not decoration: with no keys, any provider this
 * suite failed to override throws `ConfigError` instead of reaching the network.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, asc, eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockGitClient, MockLLMProvider, MockSecretsProvider } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import { BriefRepository } from '../src/modules/brief/repository.js';
import { BRIEF_MAX_STATES } from '../src/modules/brief/constants.js';
import type { BriefValues } from '../src/modules/brief/types.js';
import type { RiskBrief } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const PATCH = '@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "sk_live_xxx",\n   redisUrl: x,';

const ANSWER: RiskBrief = {
  what: 'Adds a per-state risk brief to the PR overview.',
  why: 'A reviewer opens a pull request without knowing what it changes.',
  risk_level: 'medium',
  risks: [
    {
      kind: 'public API',
      title: 'A new paid route',
      explanation: 'POST /pulls/:id/brief spends money on every call.',
      severity: 'medium',
      file_refs: ['server/src/config.ts'],
    },
    {
      kind: 'invented',
      title: 'A risk about a file that was never in the input',
      explanation: 'The model made this path up.',
      severity: 'high',
      file_refs: ['server/src/never/printed.ts'],
    },
  ],
  review_focus: [
    { ref: 'server/src/config.ts', kind: 'file', reason: 'the new configuration' },
    { ref: 'src/also/invented.ts', kind: 'file', reason: 'not in the input either' },
  ],
};

/** `risk_brief` defaults to openai/gpt-4.1, so the mock is registered under `openai`. */
function appWith(structured: unknown = ANSWER) {
  const llm = new MockLLMProvider('openai', { structuredBySchema: { RiskBrief: structured } });
  return buildApp({
    config: config(),
    db: pg.handle.db,
    overrides: {
      secrets: new MockSecretsProvider({}),
      git: new MockGitClient({ files: {} }),
      llm: { openai: llm },
    },
  }).then((app) => ({ app, llm }));
}

let pg: PgFixture;
let repoSeq = 0;

async function setupPr(workspaceId: string, headSha = 'a1b2c3d4') {
  const name = `payments-api-${repoSeq++}`;
  const [repo] = await pg.handle.db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning();
  const [pr] = await pg.handle.db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId: repo!.id,
      number: 482,
      title: 'Add rate limiting',
      author: 'marisa.koch',
      branch: 'feat/rl',
      base: 'main',
      headSha,
      status: 'needs_review',
      body: 'Rate-limit the public API.',
    })
    .returning();
  await pg.handle.db
    .insert(t.prFiles)
    .values({ prId: pr!.id, path: 'server/src/config.ts', additions: 4, deletions: 0, patch: PATCH });
  return { repo: repo!, pr: pr! };
}

/** The column values one write carries, with only what a case cares about overridden. */
function values(over: Partial<BriefValues> = {}): BriefValues {
  return {
    what: 'what',
    why: 'why',
    riskLevel: 'low',
    risks: [],
    reviewFocus: [],
    inputs: [],
    droppedRefs: [],
    droppedRisks: 0,
    intentComputedAt: null,
    intentFreshness: 'unknown',
    blastStatus: 'degraded',
    linkSha: null,
    indexMatchesHead: false,
    budget: 8000,
    inputTokensCounted: 100,
    tokenizer: 'cl100k_base',
    attempts: 1,
    tokensIn: 10,
    provider: 'openai',
    model: 'gpt-4.1',
    costUsd: 0.001,
    ...over,
  };
}

d('10 risk brief — the state-keyed table (Testcontainers pg)', () => {
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

  it('POST then GET: the record round-trips through Postgres unchanged', async () => {
    const { app } = await appWith();
    const { pr } = await setupPr(workspaceId);

    const post = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` });
    expect(post.statusCode).toBe(200);
    const record = post.json();
    expect(record.what).toBe(ANSWER.what);
    expect(record.head_sha).toBe(pr.headSha);
    expect(record.provider).toBe('openai');
    expect(record.model).toBe('gpt-4.1');

    const get = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/brief` });
    expect(get.json()).toEqual(record);
    await app.close();
  });

  /**
   * AC-17 at its strongest: `pr_files.patch` really holds a hunk in this
   * fixture, and the prompt the service actually sent is captured off the mock.
   * The repository's projection is what makes this true — `patch` is not in the
   * select list at all — so this fails the day someone adds it "for context".
   */
  it('the assembled prompt contains no hunk from pr_files.patch (R17)', async () => {
    const { app, llm } = await appWith();
    const { pr } = await setupPr(workspaceId);

    await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` });
    const call = llm.calls.find((c) => c.method === 'completeStructured');
    const user = (call!.req as { messages: { role: string; content: string }[] }).messages.find(
      (m) => m.role === 'user',
    )!.content;

    expect(user).toContain('server/src/config.ts');
    expect(user).not.toContain('sk_live_xxx');
    expect(user).not.toContain('@@ -10,3');
    expect(user.split('\n').filter((line) => /^[+-]/.test(line))).toEqual([]);
    await app.close();
  });

  it('grounds against the prompt and stores what it dropped (R13, R14)', async () => {
    const { app } = await appWith();
    const { pr } = await setupPr(workspaceId);

    const record = (await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` })).json();
    expect(record.risks.map((r: { title: string }) => r.title)).toEqual(['A new paid route']);
    expect(record.dropped_risks).toBe(1);
    expect(record.review_focus.map((f: { ref: string }) => f.ref)).toEqual([
      'server/src/config.ts',
    ]);
    expect(record.dropped_refs.sort()).toEqual([
      'server/src/never/printed.ts',
      'src/also/invented.ts',
    ]);

    const [row] = await pg.handle.db
      .select()
      .from(t.prBrief)
      .where(eq(t.prBrief.prId, pr.id));
    expect(row!.droppedRisks).toBe(1);
    expect(row!.droppedRefs).toContain('src/also/invented.ts');
    await app.close();
  });

  /**
   * R29. Two heads, two rows — and the older one is byte-identical afterwards.
   * The composite primary key is what makes that true by construction: the
   * second write is an INSERT against a different key, not an UPDATE.
   */
  it('a changed head_sha adds a row and leaves the previous state untouched (R29)', async () => {
    const { app } = await appWith();
    const { pr } = await setupPr(workspaceId, 'sha-one');

    await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` });
    const [first] = await pg.handle.db
      .select()
      .from(t.prBrief)
      .where(and(eq(t.prBrief.prId, pr.id), eq(t.prBrief.headSha, 'sha-one')));

    await pg.handle.db
      .update(t.pullRequests)
      .set({ headSha: 'sha-two' })
      .where(eq(t.pullRequests.id, pr.id));
    await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` });

    const rows = await pg.handle.db
      .select()
      .from(t.prBrief)
      .where(eq(t.prBrief.prId, pr.id))
      .orderBy(asc(t.prBrief.computedAt));
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.headSha).sort()).toEqual(['sha-one', 'sha-two']);
    expect(rows.find((row) => row.headSha === 'sha-one')).toEqual(first);

    // And the GET follows the PR's CURRENT head, not the newest row by accident.
    const get = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/brief` });
    expect(get.json().head_sha).toBe('sha-two');
    await app.close();
  });

  it('regenerating the same head replaces that row rather than adding one (R30)', async () => {
    const { app } = await appWith();
    const { pr } = await setupPr(workspaceId);

    await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` });
    const [before] = await pg.handle.db.select().from(t.prBrief).where(eq(t.prBrief.prId, pr.id));
    await new Promise((resolve) => setTimeout(resolve, 5));
    await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` });

    const rows = await pg.handle.db.select().from(t.prBrief).where(eq(t.prBrief.prId, pr.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.computedAt.getTime()).toBeGreaterThan(before!.computedAt.getTime());
    await app.close();
  });

  /**
   * R39, and the reason `evicted_count` is a column rather than a derivation.
   * A PR sitting at exactly the cap has evicted nothing, and telling its reader
   * that history was lost is a false disclosure — which is what
   * `entries.length >= max_states` would say.
   */
  it('at exactly the cap nothing is evicted and evicted_count stays 0 (R39)', async () => {
    const { pr } = await setupPr(workspaceId);
    const repo = new BriefRepository(pg.handle.db);

    for (let i = 0; i < BRIEF_MAX_STATES; i += 1) {
      await repo.upsertBrief(pr.id, `sha-${String(i).padStart(3, '0')}`, values(), BRIEF_MAX_STATES);
    }

    const rows = await pg.handle.db.select().from(t.prBrief).where(eq(t.prBrief.prId, pr.id));
    expect(rows).toHaveLength(BRIEF_MAX_STATES);
    expect(rows.every((row) => row.evictedCount === 0)).toBe(true);
  });

  it('the state past the cap evicts the OLDEST and stamps evicted_count on the newest (R39)', async () => {
    const { pr } = await setupPr(workspaceId);
    const repo = new BriefRepository(pg.handle.db);

    for (let i = 0; i < BRIEF_MAX_STATES; i += 1) {
      await repo.upsertBrief(pr.id, `sha-${String(i).padStart(3, '0')}`, values(), BRIEF_MAX_STATES);
    }
    const written = await repo.upsertBrief(pr.id, 'sha-new', values(), BRIEF_MAX_STATES);

    const rows = await pg.handle.db
      .select()
      .from(t.prBrief)
      .where(eq(t.prBrief.prId, pr.id))
      .orderBy(asc(t.prBrief.computedAt));
    expect(rows).toHaveLength(BRIEF_MAX_STATES);
    // The oldest went; the row just written is still here and carries the count.
    expect(rows.map((row) => row.headSha)).not.toContain('sha-000');
    expect(rows.map((row) => row.headSha)).toContain('sha-new');
    expect(written.headSha).toBe('sha-new');
    expect(written.evictedCount).toBe(1);
    expect(rows.at(-1)!.evictedCount).toBe(1);

    // The running total carries forward: a second eviction makes it 2.
    const second = await repo.upsertBrief(pr.id, 'sha-newer', values(), BRIEF_MAX_STATES);
    expect(second.evictedCount).toBe(2);
  });

  /**
   * "Never the row just written" is not covered by the case above, because the
   * new row is normally the newest and survives the `order by computed_at desc`
   * on its own. This is the case where it is NOT: twenty states stamped ahead of
   * the clock — an import, or a machine whose time moved — so the row this call
   * persisted sits outside the top twenty and only the explicit exclusion saves
   * it. Without it the method deletes what it just wrote and returns nothing.
   */
  it('never evicts the row it just wrote, even when every other state looks newer (R39)', async () => {
    const { pr } = await setupPr(workspaceId);
    const repo = new BriefRepository(pg.handle.db);
    const future = new Date(Date.now() + 60_000);
    for (let i = 0; i < BRIEF_MAX_STATES; i += 1) {
      await pg.handle.db
        .insert(t.prBrief)
        .values({ prId: pr.id, headSha: `future-${i}`, ...values(), computedAt: future });
    }

    const written = await repo.upsertBrief(pr.id, 'sha-now', values(), BRIEF_MAX_STATES);
    expect(written?.headSha).toBe('sha-now');

    const rows = await pg.handle.db.select().from(t.prBrief).where(eq(t.prBrief.prId, pr.id));
    // Exactly the cap, and the row this call wrote is the one that stayed: an
    // older-looking new row costs one of the future-stamped states, not itself.
    expect(rows).toHaveLength(BRIEF_MAX_STATES);
    expect(rows.map((row) => row.headSha)).toContain('sha-now');
    expect(written.evictedCount).toBe(1);
  });

  it('deleting the PR cascades every state away', async () => {
    const { app } = await appWith();
    const { pr } = await setupPr(workspaceId);
    await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` });
    expect(
      await pg.handle.db.select().from(t.prBrief).where(eq(t.prBrief.prId, pr.id)),
    ).toHaveLength(1);

    await pg.handle.db.delete(t.pullRequests).where(eq(t.pullRequests.id, pr.id));
    expect(
      await pg.handle.db.select().from(t.prBrief).where(eq(t.prBrief.prId, pr.id)),
    ).toHaveLength(0);
    await app.close();
  });

  it('404s for a PR in another workspace on both routes, and writes nothing', async () => {
    const { app, llm } = await appWith();
    const [other] = await pg.handle.db
      .insert(t.workspaces)
      .values({ name: `other-${repoSeq}` })
      .returning();
    const { pr } = await setupPr(other!.id);

    expect((await app.inject({ method: 'GET', url: `/pulls/${pr.id}/brief` })).statusCode).toBe(404);
    const post = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` });
    expect(post.statusCode).toBe(404);
    expect(post.json().error.code).toBe('not_found');
    expect(llm.calls).toHaveLength(0);
    expect(
      await pg.handle.db.select().from(t.prBrief).where(eq(t.prBrief.prId, pr.id)),
    ).toHaveLength(0);
    await app.close();
  });

  it('a schema failure answers 502 and leaves the table empty', async () => {
    const { app } = await appWith({ nonsense: true });
    const { pr } = await setupPr(workspaceId);

    const post = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` });
    expect(post.statusCode).toBe(502);
    expect(post.json().error.code).toBe('external_service_error');
    expect(
      await pg.handle.db.select().from(t.prBrief).where(eq(t.prBrief.prId, pr.id)),
    ).toHaveLength(0);
    expect((await app.inject({ method: 'GET', url: `/pulls/${pr.id}/brief` })).json()).toBeNull();
    await app.close();
  });

  it('two concurrent POSTs for one state make ONE model call and ONE row (R45)', async () => {
    const { app, llm } = await appWith();
    const { pr } = await setupPr(workspaceId);

    const [a, b] = await Promise.all([
      app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` }),
      app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` }),
    ]);
    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);
    expect(a.json()).toEqual(b.json());
    expect(llm.calls.filter((c) => c.method === 'completeStructured')).toHaveLength(1);
    expect(
      await pg.handle.db.select().from(t.prBrief).where(eq(t.prBrief.prId, pr.id)),
    ).toHaveLength(1);
    await app.close();
  });

  it('derives intent freshness from a real pr_commits row (R25)', async () => {
    const { app } = await appWith();
    const { pr } = await setupPr(workspaceId);
    await pg.handle.db.insert(t.prCommits).values({
      prId: pr.id,
      sha: pr.headSha,
      message: 'Add limiter',
      author: 'marisa.koch',
      committedAt: new Date('2026-08-16T10:00:00.000Z'),
    });
    await pg.handle.db.insert(t.prIntent).values({
      prId: pr.id,
      intent: 'Rate-limits the public API.',
      computedAt: new Date('2026-08-16T09:00:00.000Z'),
      provider: 'openrouter',
      model: 'z-ai/glm-4.7-flash',
    });

    const record = (await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` })).json();
    expect(record.intent_freshness).toBe('stale');
    expect(record.intent_computed_at).toBe('2026-08-16T09:00:00.000Z');
    await app.close();
  });
});
