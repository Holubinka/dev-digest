/**
 * Steps 8-10 — `GET /pulls/:id/blast` and `POST /pulls/:id/blast/summary`
 * against real Postgres, real migrations and the real repo-intel facade.
 *
 * The unit suite fakes `RepoIntel`, so it can prove what the blast slice does
 * with an answer but not that the answer arrives: the persistent path is four
 * joins over `symbols` / `references` / `file_rank` / `file_facts`, and an
 * INNER JOIN that silently matches nothing looks exactly like "this PR has no
 * callers". That is what this file is for — the 21-caller fixture below is
 * seeded as ROWS, so `truncated: true` here is produced by the same SQL and the
 * same cap a request runs, not by a hand-built list.
 *
 * `MockSecretsProvider({})` is not decoration: with no keys, any provider this
 * suite failed to override throws `ConfigError` instead of reaching the network.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockGitClient, MockLLMProvider, MockSecretsProvider } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import type { BlastRadiusView } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

/**
 * `repoIntelEnabled` is pinned rather than inherited: `getBlastRadius` and
 * `getDownstream` both return early when the flag is off, so a developer with
 * `REPO_INTEL_ENABLED=false` in their shell would otherwise get a green run
 * asserting nothing.
 */
const config = () => ({
  ...loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv),
  repoIntelEnabled: true,
});

const DECL = 'server/src/modules/reviews/service.ts';
const HUB = 'server/src/app.ts';
const CALLER_COUNT = 21;
const callerFile = (i: number) => `server/src/callers/caller-${String(i).padStart(2, '0')}.ts`;

/** `risk_brief` defaults to openai/gpt-4.1, so the mock is registered under `openai`. */
async function appWith() {
  const llm = new MockLLMProvider('openai', {
    completionText: 'ReviewService is called from 21 places, two of which serve HTTP routes.',
  });
  const app = await buildApp({
    config: config(),
    db: pg.handle.db,
    overrides: {
      secrets: new MockSecretsProvider({}),
      git: new MockGitClient({ files: {} }),
      llm: { openai: llm },
    },
  });
  return { app, llm };
}

let pg: PgFixture;
let repoSeq = 0;

async function insertRepoAndPr(workspaceId: string, files: string[]) {
  const name = `dev-digest-${repoSeq++}`;
  const [repo] = await pg.handle.db
    .insert(t.repos)
    .values({ workspaceId, owner: 'Holubinka', name, fullName: `Holubinka/${name}` })
    .returning();
  const [pr] = await pg.handle.db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId: repo!.id,
      number: 12,
      title: 'Blast radius',
      author: 'Holubinka',
      branch: 'feat/blast',
      base: 'main',
      headSha: 'deadbeefcafe',
      status: 'needs_review',
    })
    .returning();
  if (files.length > 0) {
    await pg.handle.db.insert(t.prFiles).values(files.map((path) => ({ prId: pr!.id, path })));
  }
  return { repo: repo!, pr: pr! };
}

/**
 * A repo the indexer has already been over.
 *
 * `ReviewService` gets 21 resolved callers — one over the per-symbol cap, which
 * is the only way `truncated` can be observed as true against real rows.
 * `reapStaleRuns` gets 2, so the cap is visibly per symbol and not global.
 *
 * Every caller file needs THREE rows, not one: `references` for the call site,
 * `file_rank` because `getResolvedCallers` INNER JOINs it (no rank row = the
 * caller silently disappears), and `symbols` so the caller can be labelled with
 * its enclosing function instead of its filename.
 */
async function seedIndexedRepo(workspaceId: string) {
  const { repo, pr } = await insertRepoAndPr(workspaceId, [DECL]);
  const db = pg.handle.db;
  const repoId = repo.id;

  await db.insert(t.repoIndexState).values({
    repoId,
    lastIndexedSha: 'deadbeefcafe',
    indexerVersion: 2,
    status: 'full',
    filesIndexed: 24,
    filesSkipped: 0,
    stats: { durationMs: 1200 },
  });

  const symbolRows = [
    { repoId, path: DECL, name: 'ReviewService', kind: 'class', line: 41, endLine: 220, exported: true, signature: 'class ReviewService' },
    { repoId, path: DECL, name: 'reapStaleRuns', kind: 'method', line: 118, endLine: 130, exported: false, signature: 'reapStaleRuns(): Promise<number>' },
  ];
  const rankRows = [] as { repoId: string; filePath: string; pagerank: number; hotness: number; rank: number; percentile: number }[];
  const refRows = [] as { repoId: string; fromPath: string; toSymbol: string; line: number; declFile: string }[];

  for (let i = 0; i < CALLER_COUNT; i += 1) {
    const path = callerFile(i);
    symbolRows.push({
      repoId, path, name: `handler${i}`, kind: 'function', line: 1, endLine: 40,
      exported: true, signature: `function handler${i}()`,
    });
    // rank descending with i, so the request's rank-DESC ordering is observable.
    rankRows.push({ repoId, filePath: path, pagerank: 0.1, hotness: 0, rank: 100 - i, percentile: 99 - i });
    refRows.push({ repoId, fromPath: path, toSymbol: 'ReviewService', line: 10 + i, declFile: DECL });
  }
  // Two callers of the SECOND symbol, reusing the first two caller files.
  refRows.push({ repoId, fromPath: callerFile(0), toSymbol: 'reapStaleRuns', line: 200, declFile: DECL });
  refRows.push({ repoId, fromPath: callerFile(1), toSymbol: 'reapStaleRuns', line: 201, declFile: DECL });

  await db.insert(t.symbols).values(symbolRows);
  await db.insert(t.fileRank).values(rankRows);
  await db.insert(t.references).values(refRows);

  await db.insert(t.fileFacts).values([
    { repoId, filePath: callerFile(0), endpoints: ['GET /pulls/:id/blast'], crons: [] },
    // Two hops out: nothing calls a changed symbol here, but it imports a file
    // that does, so it belongs in the totals and in no symbol's own list.
    { repoId, filePath: HUB, endpoints: ['POST /pulls/:id/review'], crons: ['0 3 * * *'] },
  ]);
  await db.insert(t.fileEdges).values([
    { repoId, fromFile: callerFile(0), toFile: DECL }, // depth 1
    { repoId, fromFile: callerFile(1), toFile: DECL }, // depth 1
    { repoId, fromFile: HUB, toFile: callerFile(0) }, // depth 2
  ]);

  return { repo, pr };
}

d('07 blast routes (Testcontainers pg)', () => {
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

  it('serves a full answer with real symbols, callers and endpoints', async () => {
    const { app, llm } = await appWith();
    const { pr, repo } = await seedIndexedRepo(workspaceId);

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/blast` });
    expect(res.statusCode).toBe(200);
    const view = res.json() as BlastRadiusView;

    expect(view.status).toBe('full');
    expect(view.reason).toBeNull();
    expect(view.repo_full_name).toBe(repo.fullName);
    expect(view.head_sha).toBe('deadbeefcafe');
    // The fixture indexes the head commit, so the links open the PR head.
    expect(view.link_sha).toBe('deadbeefcafe');
    expect(view.index_matches_head).toBe(true);
    expect(view.changed_files).toEqual([DECL]);
    expect(view.symbols.length).toBeGreaterThan(0);
    expect(view.summary).toBeNull();

    // Acceptance criterion 7: the read path is free.
    expect(llm.calls).toEqual([]);

    await app.close();
  });

  it('reports 21 real callers as 20 listed with truncated true', async () => {
    const { app } = await appWith();
    const { pr } = await seedIndexedRepo(workspaceId);

    const view = (await app.inject({ method: 'GET', url: `/pulls/${pr.id}/blast` })).json() as BlastRadiusView;
    const service = view.symbols.find((s) => s.name === 'ReviewService')!;
    const reap = view.symbols.find((s) => s.name === 'reapStaleRuns')!;

    expect(service.caller_count).toBe(21);
    expect(service.callers).toHaveLength(20);
    expect(service.truncated).toBe(true);
    // The cap is per symbol: the second symbol keeps both of its callers.
    expect(reap.caller_count).toBe(2);
    expect(reap.truncated).toBe(false);
    expect(view.totals.callers).toBe(23);

    await app.close();
  });

  it('orders callers by the real file_rank and labels them with the enclosing symbol', async () => {
    const { app } = await appWith();
    const { pr } = await seedIndexedRepo(workspaceId);

    const view = (await app.inject({ method: 'GET', url: `/pulls/${pr.id}/blast` })).json() as BlastRadiusView;
    const service = view.symbols.find((s) => s.name === 'ReviewService')!;

    expect(service.callers[0]).toEqual({
      file: callerFile(0),
      symbol: 'handler0',
      line: 10,
      rank: 100,
    });
    expect(service.callers.map((c) => c.rank)).toEqual([...service.callers.map((c) => c.rank)].sort((a, b) => b - a));
    // The 21st (lowest-ranked) caller is the one dropped, not an arbitrary one.
    expect(service.callers.map((c) => c.file)).not.toContain(callerFile(20));

    await app.close();
  });

  it('carries the declaration line and the endpoints out of the index', async () => {
    const { app } = await appWith();
    const { pr } = await seedIndexedRepo(workspaceId);

    const view = (await app.inject({ method: 'GET', url: `/pulls/${pr.id}/blast` })).json() as BlastRadiusView;
    const service = view.symbols.find((s) => s.name === 'ReviewService')!;

    // From `symbols.line` — a 0 here would make every `file:line` link wrong.
    expect(service).toMatchObject({ file: DECL, line: 41, kind: 'class' });
    expect(service.endpoints).toContainEqual({
      label: 'GET /pulls/:id/blast',
      file: callerFile(0),
      line: 0,
      depth: 1,
      kind: 'http',
    });
    // The depth-2 file is counted but attributed to no symbol.
    expect(view.totals.endpoints).toBe(2);
    expect(view.totals.crons).toBe(1);
    expect(service.endpoints.map((e) => e.file)).not.toContain(HUB);

    await app.close();
  });

  /**
   * The real-world case, reproduced as rows: the index is one commit behind the
   * PR head. Every `line` in the answer came out of `symbols` / `references`,
   * which the indexer wrote against `last_indexed_sha`, so the response must
   * link there and say the two differ. Against `Holubinka/dev-digest` PR #12
   * this exact gap put a reported call site on a comment.
   */
  it('links against the indexed sha, not the PR head, when the index is behind', async () => {
    const { app } = await appWith();
    const { pr, repo } = await seedIndexedRepo(workspaceId);
    await pg.handle.db
      .update(t.repoIndexState)
      .set({ lastIndexedSha: '66727c85ce06' })
      .where(eq(t.repoIndexState.repoId, repo.id));

    const view = (await app.inject({ method: 'GET', url: `/pulls/${pr.id}/blast` })).json() as BlastRadiusView;

    expect(view.status).toBe('full');
    expect(view.head_sha).toBe('deadbeefcafe');
    expect(view.link_sha).toBe('66727c85ce06');
    expect(view.index_matches_head).toBe(false);
    expect(view.symbols.length).toBeGreaterThan(0);

    await app.close();
  });

  it('answers 200 degraded with a reason for a repo that was never indexed', async () => {
    const { app } = await appWith();
    const { pr } = await insertRepoAndPr(workspaceId, [DECL]);

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/blast` });
    expect(res.statusCode).toBe(200);
    const view = res.json() as BlastRadiusView;

    expect(view.status).toBe('degraded');
    expect(view.reason).not.toBeNull();
    expect(view.reason).toMatch(/has not been indexed/i);
    expect(view.symbols).toEqual([]);
    expect(view.totals).toEqual({ symbols: 0, callers: 0, endpoints: 0, crons: 0 });
    // No index, so no commit the (absent) line numbers would be valid at.
    expect(view.link_sha).toBeNull();
    expect(view.index_matches_head).toBe(false);

    await app.close();
  });

  it('404s an unknown id and 422s a malformed one', async () => {
    const { app } = await appWith();

    const missing = await app.inject({
      method: 'GET',
      url: '/pulls/8a3d6f0e-0000-4000-8000-000000000000/blast',
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe('not_found');

    const malformed = await app.inject({ method: 'GET', url: '/pulls/not-a-uuid/blast' });
    expect(malformed.statusCode).toBe(422);

    await app.close();
  });

  it('404s a PR in another workspace instead of leaking it', async () => {
    const { app, llm } = await appWith();
    const [other] = await pg.handle.db
      .insert(t.workspaces)
      .values({ name: `other-${repoSeq}` })
      .returning();
    const { pr } = await seedIndexedRepo(other!.id);

    expect((await app.inject({ method: 'GET', url: `/pulls/${pr.id}/blast` })).statusCode).toBe(404);
    const summary = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/blast/summary` });
    expect(summary.statusCode).toBe(404);
    // Tenancy before spend: the 404 cost nothing.
    expect(llm.calls).toEqual([]);

    await app.close();
  });

  it('summarises with exactly one model call over the view’s own facts', async () => {
    const { app, llm } = await appWith();
    const { pr } = await seedIndexedRepo(workspaceId);

    const res = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/blast/summary` });
    expect(res.statusCode).toBe(200);
    expect(res.json().summary).toMatch(/ReviewService is called from 21 places/);

    expect(llm.calls).toHaveLength(1);
    const req = llm.calls[0]!.req as { model: string; messages: { content: string }[] };
    expect(llm.calls[0]!.method).toBe('complete');
    expect(req.model).toBe('gpt-4.1');
    expect(req.messages[1]!.content).toContain('ReviewService');
    expect(req.messages[1]!.content).toContain('21 caller(s)');

    await app.close();
  });
});
