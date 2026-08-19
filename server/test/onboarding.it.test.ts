/**
 * P1.10 — the two routes and the one-row table, against real Postgres and the
 * real migrations.
 *
 * The unit suite fakes the repository, so it can prove what the service does
 * with a row but not that the row behaves: `repo_id` as the primary key, the
 * `onConflictDoUpdate` that rests on it, the jsonb round trip and the cascade
 * are properties of SQL, and a fake cannot have them wrong in the same way
 * Postgres can. That is what this file is for.
 *
 * THE ISOLATION IS DELIBERATELY DOUBLED. `overrides.onboardingGenerator` already
 * keeps this suite off the network, and `MockSecretsProvider({})` plus
 * `llmFallback` are there anyway: a suite that thought it was isolated once made
 * live, paid OpenRouter calls because its isolation ran through the FAILURE path
 * — the missing key that was supposed to throw (`server/INSIGHTS.md`).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockGitClient, MockLLMProvider, MockSecretsProvider } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import { INDEXER_VERSION } from '../src/modules/repo-intel/constants.js';
import { TimeoutError } from '../src/platform/resilience.js';
import type { OnboardingGenerationResult } from '../src/modules/onboarding/generation-types.js';
import type { OnboardingDraft } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const INDEXED_SHA = 'a1b2c3d4e5f6';

/** A whole `OnboardingDraft`, with a body distinctive enough to see it replaced. */
function draft(body: string): OnboardingDraft {
  return {
    sections: [
      {
        kind: 'architecture',
        title: 'Architecture',
        body,
        links: [],
        verified_paths: ['src/app.ts'],
        state: 'ready',
        empty_reason: null,
      },
    ],
    flows: [],
    reading_path: [],
    tasks: [
      {
        title: 'Add a guard to the error handler',
        path: 'src/app.ts',
        why: 'One file, one branch.',
        complexity: 'low',
        steps: [
          { text: 'Open the handler', path: 'src/app.ts', command: null },
          { text: 'Run the tests', path: null, command: 'pnpm test' },
        ],
        impact: 'The error handler and its one test.',
        verification: 'The suite is green.',
      },
    ],
    setup_commands: [],
    packages: [],
    env_vars: [],
    env_vars_truncated: false,
    package_scan: { depth: 3, excluded_dirs: ['node_modules'], found: 1, shown: 1, bounded: false },
    inputs: [
      {
        id: 'repo_map',
        status: 'included',
        tokens: 900,
        detail: null,
        omitted: [],
        shortened: [],
      },
    ],
    dropped: {
      unknown_path: 3,
      unknown_script: 1,
      manager_mismatch: 0,
      unknown_complexity: 2,
      unknown_section: 0,
    },
    sample_files: 12,
    sample_truncated: true,
    chains_supplied: 20,
    longest_chain_files: 5,
    budget: 29_356,
    input_tokens_counted: 18200,
    system_tokens: 1_100,
    duration_ms: 96_412,
    tokenizer: 'cl100k_base',
    attempts: 2,
    tokens_in: 18477,
    provider: 'openrouter',
    model: 'deepseek/deepseek-v4-flash',
    cost_usd: 0.0031,
  };
}

const result = (body: string): OnboardingGenerationResult => ({
  draft: draft(body),
  audit: {
    ...draft(body).dropped,
    off_chain: 1,
    unknown_env: 0,
    probes: 44,
    samples: ['src/app.ts'],
  },
});

let pg: PgFixture;
let repoSeq = 0;

/**
 * A local `async` helper must `await buildApp(...)` INSIDE itself. Returning
 * `{ app: buildApp() }` costs a full testcontainers run to diagnose, because the
 * failure surfaces much later as `app.inject is not a function`
 * (`server/INSIGHTS.md`).
 */
async function appWith(
  bodies: string[] = ['The first tour.'],
  duringRun?: () => Promise<void>,
  /** The 1-based run that misses its clock instead of answering. */
  opts: { timeOutOnRun?: number } = {},
) {
  let runs = 0;
  const app = await buildApp({
    config: config(),
    db: pg.handle.db,
    overrides: {
      secrets: new MockSecretsProvider({}),
      git: new MockGitClient({ files: {} }),
      // Defence in depth: even a path that somehow reached a provider gets this
      // one rather than a real client built from a real key.
      llmFallback: new MockLLMProvider('openai'),
      onboardingGenerator: {
        run: async () => {
          const body = bodies[Math.min(runs, bodies.length - 1)]!;
          runs += 1;
          // The generation window, made observable: whatever `duringRun` does to
          // the database happens after the gate passed and before the draft
          // exists, which is exactly where a reindex lands.
          if (duringRun) await duringRun();
          // The executor throws the clock's own error and writes nothing; the
          // service turns it into a 502 without reaching the table.
          if (opts.timeOutOnRun === runs) throw new TimeoutError(219_360);
          return result(body);
        },
      },
    },
  });
  return { app, runs: () => runs };
}

async function setupRepo(
  workspaceId: string,
  index?: { sha: string; status: 'full' | 'partial' | 'failed'; filesIndexed: number },
) {
  const name = `toured-${repoSeq++}`;
  const [repo] = await pg.handle.db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning();
  if (index) {
    await pg.handle.db.insert(t.repoIndexState).values({
      repoId: repo!.id,
      lastIndexedSha: index.sha,
      indexerVersion: INDEXER_VERSION,
      status: index.status,
      filesIndexed: index.filesIndexed,
      filesSkipped: 3,
      stats: {},
    });
  }
  return repo!;
}

d('11 onboarding tour — routes and the one-row table (Testcontainers pg)', () => {
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
   * AC-9. The two answers must be BYTE-IDENTICAL: a different message, a
   * different code, even a different order of keys would be a side channel
   * confirming that an id exists in some workspace this caller cannot see.
   */
  it('a foreign repo and a missing one answer the identical 404 (R2)', async () => {
    const [other] = await pg.handle.db
      .insert(t.workspaces)
      .values({ name: `elsewhere-${repoSeq}` })
      .returning();
    const foreign = await setupRepo(other!.id);
    const { app } = await appWith();

    try {
      const missing = await app.inject({
        method: 'GET',
        url: '/repos/00000000-0000-4000-8000-000000000000/onboarding',
      });
      const elsewhere = await app.inject({ method: 'GET', url: `/repos/${foreign.id}/onboarding` });

      expect(missing.statusCode).toBe(404);
      expect(elsewhere.statusCode).toBe(404);
      expect(elsewhere.body).toBe(missing.body);

      // AC-53. The window SPEC-04 adds carries a task's steps, each with a path
      // and sometimes a command — the most specific description of somebody
      // else's repository this product holds. The 404 body names none of it,
      // and the assertion is on the WHOLE body rather than on a field, because
      // there is no field it would be acceptable in.
      for (const leak of ['task', 'steps', 'impact', 'verification', 'path', 'command']) {
        expect(elsewhere.body).not.toContain(leak);
      }
    } finally {
      await app.close();
    }
  });

  it('with nothing saved the read is explicit and the generator is untouched (R15)', async () => {
    const repo = await setupRepo(workspaceId, {
      sha: INDEXED_SHA,
      status: 'full',
      filesIndexed: 412,
    });
    const { app, runs } = await appWith();

    try {
      const res = await app.inject({ method: 'GET', url: `/repos/${repo.id}/onboarding` });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        tour: null,
        index: {
          last_indexed_sha: INDEXED_SHA,
          files_indexed: 412,
          files_skipped: 3,
          status: 'full',
          updated_at: expect.any(String),
        },
        stale: false,
        generate_blocked: null,
      });
      expect(runs()).toBe(0);
    } finally {
      await app.close();
    }
  });

  it('POST writes one row; the GET after it costs nothing (R1, R3, R12)', async () => {
    const repo = await setupRepo(workspaceId, {
      sha: INDEXED_SHA,
      status: 'full',
      filesIndexed: 412,
    });
    const { app, runs } = await appWith(['The first tour.']);

    try {
      const post = await app.inject({
        method: 'POST',
        url: `/repos/${repo.id}/onboarding/generate`,
      });
      expect(post.statusCode).toBe(200);
      expect(runs()).toBe(1);

      // R3: the record carries the index state it was built from.
      expect(post.json().index_state).toEqual({
        last_indexed_sha: INDEXED_SHA,
        files_indexed: 412,
        files_skipped: 3,
        status: 'full',
      });
      expect(Date.parse(post.json().generated_at)).not.toBeNaN();
      // R12: the five numbers are persisted exactly as the generator produced them.
      expect(post.json()).toMatchObject({
        attempts: 2,
        input_tokens_counted: 18200,
        tokenizer: 'cl100k_base',
        tokens_in: 18477,
        cost_usd: 0.0031,
      });
      // R13: the five grounding counters ride through untouched.
      expect(post.json().dropped).toEqual(draft('x').dropped);

      // The jsonb round trip: what comes back out of Postgres is what went in.
      const get = await app.inject({ method: 'GET', url: `/repos/${repo.id}/onboarding` });
      expect(get.json().tour).toEqual(post.json());
      expect(get.json().stale).toBe(false);
      // AC-46: reading a saved tour makes zero model calls, however often.
      await app.inject({ method: 'GET', url: `/repos/${repo.id}/onboarding` });
      expect(runs()).toBe(1);

      const counted = await pg.handle.db
        .select({ count: sql<number>`count(*)::int` })
        .from(t.onboarding)
        .where(eq(t.onboarding.repoId, repo.id));
      expect(counted[0]!.count).toBe(1);
    } finally {
      await app.close();
    }
  });

  /**
   * AC-57 / AC-59. One row per repository is what makes "no previous tour is
   * reachable anywhere afterwards" a property of the schema rather than of a
   * cleanup that has to run.
   */
  it('a second POST REPLACES the first — one row, and the old text is gone (R6)', async () => {
    const repo = await setupRepo(workspaceId, {
      sha: INDEXED_SHA,
      status: 'full',
      filesIndexed: 412,
    });
    const { app } = await appWith(['The first tour.', 'The second tour, entirely different.']);

    try {
      await app.inject({ method: 'POST', url: `/repos/${repo.id}/onboarding/generate` });
      const second = await app.inject({
        method: 'POST',
        url: `/repos/${repo.id}/onboarding/generate`,
      });
      expect(second.json().sections[0].body).toBe('The second tour, entirely different.');

      const rows = await pg.handle.db
        .select()
        .from(t.onboarding)
        .where(eq(t.onboarding.repoId, repo.id));
      expect(rows).toHaveLength(1);
      expect(JSON.stringify(rows[0]!.json)).not.toContain('The first tour.');
      // The column and the document agree, because one is derived from the other.
      expect(rows[0]!.generatedAt.toISOString()).toBe(second.json().generated_at);
    } finally {
      await app.close();
    }
  });

  /**
   * AC-56. Staleness is VISIBLE and starts nothing: `generate_blocked` stays
   * `null`, the tour is still served, and no generation happens on the read.
   */
  it('advancing the index flips stale, blocks nothing and spends nothing (R5)', async () => {
    const repo = await setupRepo(workspaceId, {
      sha: INDEXED_SHA,
      status: 'full',
      filesIndexed: 412,
    });
    const { app, runs } = await appWith();

    try {
      await app.inject({ method: 'POST', url: `/repos/${repo.id}/onboarding/generate` });
      await pg.handle.db
        .update(t.repoIndexState)
        .set({ lastIndexedSha: 'ffff000011112222' })
        .where(eq(t.repoIndexState.repoId, repo.id));

      const res = await app.inject({ method: 'GET', url: `/repos/${repo.id}/onboarding` });
      expect(res.json().stale).toBe(true);
      expect(res.json().generate_blocked).toBeNull();
      expect(res.json().tour).not.toBeNull();
      expect(runs()).toBe(1);
    } finally {
      await app.close();
    }
  });

  /**
   * AC-83, end to end and through real rows — the three refusals, each with the
   * code the client branches on, and none of them reaching the generator.
   *
   * The second case is the one P1.9 made reachable at all: before that step
   * nothing in the repository ever wrote `status: 'failed'` to
   * `repo_index_state`, so this branch was live on read and dead on write.
   */
  it('each of the three refusals is a 409 with its own code, and costs nothing (R8)', async () => {
    const noIndex = await setupRepo(workspaceId);
    const failed = await setupRepo(workspaceId, { sha: INDEXED_SHA, status: 'failed', filesIndexed: 412 });
    const noFiles = await setupRepo(workspaceId, { sha: INDEXED_SHA, status: 'partial', filesIndexed: 0 });
    const { app, runs } = await appWith();

    try {
      const cases: [string, string][] = [
        [noIndex.id, 'onboarding_index_missing'],
        [failed.id, 'onboarding_index_failed'],
        [noFiles.id, 'onboarding_language_unsupported'],
      ];
      for (const [id, code] of cases) {
        const res = await app.inject({ method: 'POST', url: `/repos/${id}/onboarding/generate` });
        expect(res.statusCode, code).toBe(409);
        expect(res.json().error.code).toBe(code);

        // The same reason is visible on the READ, so the button can be disabled
        // with the cause rather than by guessing from `index`.
        const page = await app.inject({ method: 'GET', url: `/repos/${id}/onboarding` });
        expect(page.statusCode).toBe(200);
        expect(page.json().generate_blocked).toBe(code.replace('onboarding_', ''));
      }
      // AC-63: refused before any model call — all three of them.
      expect(runs()).toBe(0);
    } finally {
      await app.close();
    }
  });

  /**
   * AC-60. Reading is never blocked: a repository whose index has since crashed
   * still serves the tour it has, and only the Generate button is refused.
   */
  it('a tour survives its index failing, and is still served (R7)', async () => {
    const repo = await setupRepo(workspaceId, {
      sha: INDEXED_SHA,
      status: 'full',
      filesIndexed: 412,
    });
    const { app } = await appWith();

    try {
      await app.inject({ method: 'POST', url: `/repos/${repo.id}/onboarding/generate` });
      await pg.handle.db
        .update(t.repoIndexState)
        .set({ status: 'failed', stats: { degradedReason: 'index_failed' } })
        .where(eq(t.repoIndexState.repoId, repo.id));

      const res = await app.inject({ method: 'GET', url: `/repos/${repo.id}/onboarding` });
      expect(res.statusCode).toBe(200);
      expect(res.json().tour.sections[0].body).toBe('The first tour.');
      expect(res.json().generate_blocked).toBe('index_failed');
    } finally {
      await app.close();
    }
  });

  /**
   * THE GENERATION WINDOW, closed by the second index read.
   *
   * The reindex here is the worst shape rather than the obvious one: the SAME
   * HEAD, so `last_indexed_sha` never moves and a sha comparison would see
   * nothing — while `deleteAllForRepo` has already emptied `symbols` and
   * `references` under the generation that is assembling its input
   * (`repo-intel/pipeline/full.ts`). Stamped with the state the gate approved,
   * the thin tour that comes out reads as fresh forever.
   *
   * The model call is paid for and thrown away, and that price was named and
   * accepted (human decision, 2026-08-18).
   */
  it('a reindex on the same HEAD mid-generation refuses the write with a 409', async () => {
    const repo = await setupRepo(workspaceId, {
      sha: INDEXED_SHA,
      status: 'full',
      filesIndexed: 412,
    });
    const { app, runs } = await appWith(['A tour built from an index being erased.'], async () => {
      await pg.handle.db
        .update(t.repoIndexState)
        // The sha stays. Only `updated_at` moves — a whole second, so the
        // assertion cannot flake on two writes landing in the same millisecond.
        .set({ updatedAt: new Date(Date.now() + 1000) })
        .where(eq(t.repoIndexState.repoId, repo.id));
    });

    try {
      const res = await app.inject({
        method: 'POST',
        url: `/repos/${repo.id}/onboarding/generate`,
      });

      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe('onboarding_index_changed');
      // This refusal is post-spend BY NATURE: the generator ran, and its answer
      // is what is being thrown away.
      expect(runs()).toBe(1);

      // And nothing reached the table — no row, and no replacement of one.
      const rows = await pg.handle.db
        .select()
        .from(t.onboarding)
        .where(eq(t.onboarding.repoId, repo.id));
      expect(rows).toHaveLength(0);
    } finally {
      await app.close();
    }
  });

  /**
   * AC-46 / R32, through the real column and the real parse.
   *
   * SPEC-04 added seven fields to a contract whose documents are already in a
   * `jsonb` column and are re-parsed on the way out. Without an empty
   * `.default()` on every one of them, the day this feature shipped every tour
   * generated before it would have stopped parsing — and the repository degrades
   * a failed parse to `null`, which reads as "nothing saved yet, press
   * Generate" about a tour that is whole in the database and was paid for once.
   *
   * The unit suite pins the same rule against the schema; this pins it against
   * Postgres, because the schema is not what a row went in as.
   */
  it('a tour written before SPEC-04 still reads, with the new fields empty', async () => {
    const repo = await setupRepo(workspaceId, {
      sha: INDEXED_SHA,
      status: 'full',
      filesIndexed: 412,
    });

    // Exactly the shape this feature stored yesterday: no step, no impact, no
    // verification, none of the four counters, and no `omitted`/`shortened` on
    // the input row.
    const {
      chains_supplied: _chains,
      longest_chain_files: _longest,
      system_tokens: _system,
      duration_ms: _duration,
      ...old
    } = draft('A tour from before the deepening.');
    await pg.handle.db.insert(t.onboarding).values({
      repoId: repo.id,
      json: {
        ...old,
        tasks: [{ title: 'Add a guard', path: 'src/app.ts', why: 'small', complexity: 'low' }],
        inputs: [{ id: 'repo_map', status: 'included', tokens: 900, detail: null }],
        index_state: {
          last_indexed_sha: INDEXED_SHA,
          files_indexed: 412,
          files_skipped: 3,
          status: 'full',
        },
        generated_at: new Date().toISOString(),
      },
    });
    const { app, runs } = await appWith();

    try {
      const res = await app.inject({ method: 'GET', url: `/repos/${repo.id}/onboarding` });
      expect(res.statusCode).toBe(200);

      const tour = res.json().tour;
      expect(tour).not.toBeNull();
      expect(tour.sections[0].body).toBe('A tour from before the deepening.');
      // The task is still there, and the fields it never had read as empty
      // rather than as missing.
      expect(tour.tasks[0]).toMatchObject({
        title: 'Add a guard',
        steps: [],
        impact: '',
        verification: '',
      });
      expect(tour).toMatchObject({
        chains_supplied: 0,
        longest_chain_files: 0,
        system_tokens: 0,
        duration_ms: 0,
      });
      expect(tour.inputs[0]).toMatchObject({ omitted: [], shortened: [] });
      // And nothing was regenerated to make that happen.
      expect(runs()).toBe(0);
    } finally {
      await app.close();
    }
  });

  /**
   * AC-45 / R26. A generation that misses its clock is a call already paid for;
   * what it must not also cost is the tour the repository already had. The row
   * is compared BYTE FOR BYTE, because "still there" and "unchanged" are
   * different claims and only the second one is the criterion.
   */
  it('a generation that misses its clock leaves the stored row byte-identical', async () => {
    const repo = await setupRepo(workspaceId, {
      sha: INDEXED_SHA,
      status: 'full',
      filesIndexed: 412,
    });
    const { app, runs } = await appWith(['The tour that survives.'], undefined, {
      timeOutOnRun: 2,
    });

    try {
      const first = await app.inject({
        method: 'POST',
        url: `/repos/${repo.id}/onboarding/generate`,
      });
      expect(first.statusCode).toBe(200);
      const [before] = await pg.handle.db
        .select()
        .from(t.onboarding)
        .where(eq(t.onboarding.repoId, repo.id));

      const failed = await app.inject({
        method: 'POST',
        url: `/repos/${repo.id}/onboarding/generate`,
      });
      expect(failed.statusCode).toBe(502);
      expect(runs()).toBe(2);

      const [after] = await pg.handle.db
        .select()
        .from(t.onboarding)
        .where(eq(t.onboarding.repoId, repo.id));
      expect(JSON.stringify(after!.json)).toBe(JSON.stringify(before!.json));
      expect(after!.generatedAt.toISOString()).toBe(before!.generatedAt.toISOString());

      // And the reader still gets it, undamaged, on the next open.
      const get = await app.inject({ method: 'GET', url: `/repos/${repo.id}/onboarding` });
      expect(get.json().tour.sections[0].body).toBe('The tour that survives.');
    } finally {
      await app.close();
    }
  });

  /**
   * A stored document that no longer matches the contract degrades to "nothing
   * saved yet, press Generate" — NEVER to a 422 blamed on the caller who merely
   * opened the page, for a row written by code they never ran
   * (`server/INSIGHTS.md`). The jsonb column is untyped input, and this is the
   * only place the program finds that out.
   */
  it('a stored document that outlived the contract reads as absent, not as an error', async () => {
    const repo = await setupRepo(workspaceId, {
      sha: INDEXED_SHA,
      status: 'full',
      filesIndexed: 412,
    });
    await pg.handle.db
      .insert(t.onboarding)
      .values({ repoId: repo.id, json: { what: 'a shape from two versions ago' } });
    const { app, runs } = await appWith();

    try {
      const res = await app.inject({ method: 'GET', url: `/repos/${repo.id}/onboarding` });
      expect(res.statusCode).toBe(200);
      expect(res.json().tour).toBeNull();
      expect(res.json().generate_blocked).toBeNull();
      expect(runs()).toBe(0);
    } finally {
      await app.close();
    }
  });
});
