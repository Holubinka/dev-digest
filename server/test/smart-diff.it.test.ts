/**
 * GET /pulls/:id/smart-diff — the reviewer-ordered file list.
 *
 * DB-backed because the whole point of the route is joining `pr_files` to the
 * findings of a PR's reviews; the classifier itself is covered hermetically in
 * `smart-diff.test.ts`.
 *
 * The last test is the machine-checkable form of an acceptance criterion:
 * viewing a Smart Diff must not cost a model call. `agent_runs` gets a row
 * before any LLM request is issued (`reviews/repository/run.repo.ts`), so a run
 * count that does not move is proof no review was started.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import type { SmartDiff } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

let repoSeq = 0;

async function setupPr(
  db: PgFixture['handle']['db'],
  workspaceId: string,
  files: Array<{ path: string; additions: number; deletions: number }>,
) {
  const name = `smartdiff-${repoSeq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning();
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId: repo!.id,
      number: 1,
      title: 'Add rate limiting',
      author: 'marisa.koch',
      branch: 'feat/rl',
      base: 'main',
      headSha: 'deadbeef',
      additions: files.reduce((n, f) => n + f.additions, 0),
      deletions: files.reduce((n, f) => n + f.deletions, 0),
      filesCount: files.length,
      status: 'open',
    })
    .returning();
  if (files.length > 0) {
    await db.insert(t.prFiles).values(files.map((f) => ({ prId: pr!.id, ...f })));
  }
  return pr!;
}

async function addFinding(
  db: PgFixture['handle']['db'],
  workspaceId: string,
  prId: string,
  finding: { file: string; startLine: number; endLine: number; dismissed?: boolean },
) {
  const [review] = await db
    .insert(t.reviews)
    .values({ workspaceId, prId, kind: 'review', verdict: 'request_changes', score: 50 })
    .returning();
  await db.insert(t.findings).values({
    reviewId: review!.id,
    file: finding.file,
    startLine: finding.startLine,
    endLine: finding.endLine,
    severity: 'CRITICAL',
    category: 'security',
    title: 'Hardcoded credential',
    rationale: 'A live key in source.',
    confidence: 0.9,
    ...(finding.dismissed === true ? { dismissedAt: new Date() } : {}),
  });
}

const FILES = [
  { path: 'package-lock.json', additions: 92, deletions: 24 },
  { path: 'src/middleware/ratelimit.ts', additions: 84, deletions: 0 },
  { path: 'src/config.ts', additions: 4, deletions: 0 },
];

d('GET /pulls/:id/smart-diff (Testcontainers pg)', () => {
  let pg: PgFixture;
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

  it('groups files core → wiring → boilerplate', async () => {
    const app = await buildApp({ config: config(), db: pg.handle.db });
    const pr = await setupPr(pg.handle.db, workspaceId, FILES);

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/smart-diff` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as SmartDiff;

    expect(body.groups.map((g) => g.role)).toEqual(['core', 'wiring', 'boilerplate']);
    expect(body.groups[0]!.files.map((f) => f.path)).toEqual(['src/middleware/ratelimit.ts']);
    expect(body.groups[1]!.files.map((f) => f.path)).toEqual(['src/config.ts']);
    expect(body.groups[2]!.files.map((f) => f.path)).toEqual(['package-lock.json']);
    expect(body.split_suggestion.total_lines).toBe(204);
  });

  it('carries no finding_lines until a review has run', async () => {
    const app = await buildApp({ config: config(), db: pg.handle.db });
    const pr = await setupPr(pg.handle.db, workspaceId, FILES);

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/smart-diff` });
    const body = res.json() as SmartDiff;
    expect(body.groups.flatMap((g) => g.files).every((f) => f.finding_lines.length === 0)).toBe(
      true,
    );
  });

  it('overlays the findings of a review, excluding dismissed ones', async () => {
    const app = await buildApp({ config: config(), db: pg.handle.db });
    const pr = await setupPr(pg.handle.db, workspaceId, FILES);
    await addFinding(pg.handle.db, workspaceId, pr.id, {
      file: 'src/config.ts',
      startLine: 12,
      endLine: 12,
    });
    await addFinding(pg.handle.db, workspaceId, pr.id, {
      file: 'src/middleware/ratelimit.ts',
      startLine: 28,
      endLine: 30,
    });
    await addFinding(pg.handle.db, workspaceId, pr.id, {
      file: 'src/config.ts',
      startLine: 99,
      endLine: 99,
      dismissed: true,
    });

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/smart-diff` });
    const body = res.json() as SmartDiff;
    const byPath = new Map(body.groups.flatMap((g) => g.files).map((f) => [f.path, f]));

    expect(byPath.get('src/config.ts')!.finding_lines).toEqual([12]);
    expect(byPath.get('src/middleware/ratelimit.ts')!.finding_lines).toEqual([28, 29, 30]);
    expect(byPath.get('package-lock.json')!.finding_lines).toEqual([]);
  });

  it('answers a PR whose files were never fetched with empty groups', async () => {
    const app = await buildApp({ config: config(), db: pg.handle.db });
    const pr = await setupPr(pg.handle.db, workspaceId, []);

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/smart-diff` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      groups: [],
      split_suggestion: { too_big: false, total_lines: 0, proposed_splits: [] },
    });
  });

  it("404s on another workspace's PR rather than answering for it", async () => {
    const app = await buildApp({ config: config(), db: pg.handle.db });
    const [other] = await pg.handle.db
      .insert(t.workspaces)
      .values({ name: 'other-tenant' })
      .returning();
    const pr = await setupPr(pg.handle.db, other!.id, FILES);

    // The request resolves to the DEFAULT workspace, so this id exists but is
    // not ours — the answer must not distinguish it from an id that does not.
    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/smart-diff` });
    expect(res.statusCode).toBe(404);
  });

  it('starts no agent run — viewing a Smart Diff makes no model call', async () => {
    const app = await buildApp({ config: config(), db: pg.handle.db });
    const pr = await setupPr(pg.handle.db, workspaceId, FILES);
    const before = await pg.handle.db.select({ id: t.agentRuns.id }).from(t.agentRuns);

    for (let i = 0; i < 3; i += 1) {
      const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/smart-diff` });
      expect(res.statusCode).toBe(200);
    }

    const after = await pg.handle.db.select({ id: t.agentRuns.id }).from(t.agentRuns);
    expect(after.length).toBe(before.length);
  });
});
