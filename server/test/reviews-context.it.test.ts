/**
 * 08 — project context reaching the model, end to end.
 *
 * The acceptance test for the run path: an attached document becomes a wrapped
 * block inside `## Project context` with its own path beside its text, the trace
 * records what went AND what did not, and an agent with nothing attached
 * produces the prompt it produced before this feature existed.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { waitForPrRuns } from './helpers/runs.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import {
  MockEmbedder,
  MockGitClient,
  MockLLMProvider,
  MockSecretsProvider,
} from '../src/adapters/mocks.js';
import type { Review, RunTrace } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const DIFF = `diff --git a/api/handler.ts b/api/handler.ts
--- a/api/handler.ts
+++ b/api/handler.ts
@@ -1,3 +1,4 @@
 import { z } from 'zod';
+import { pool } from '../db/pool';
 export const handler = () => null;`;

const REVIEW_FIXTURE: Review = {
  verdict: 'approve',
  summary: 'Nothing to report.',
  score: 100,
  findings: [],
};

const ARCHITECTURE = '# Architecture\n\nModule `api/` must not import `db/` directly.\n';
const STYLE = '# Style\n\nTwo spaces.\n';
const TREE: Record<string, string> = {
  'docs/architecture.md': ARCHITECTURE,
  'docs/style.md': STYLE,
};

d('08 project context in the assembled prompt', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let seq = 0;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  /** `llmFallback` is what keeps this hermetic — see reviews-skills.it.test.ts. */
  function makeApp(tree: Record<string, string> = TREE) {
    return buildApp({
      config: loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv),
      db: pg.handle.db,
      overrides: {
        secrets: new MockSecretsProvider({}),
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: DIFF, tree }),
        llm: { openai: new MockLLMProvider('openai', { structured: REVIEW_FIXTURE }) },
        llmFallback: new MockLLMProvider('openai', { structured: REVIEW_FIXTURE }),
      },
    });
  }

  type App = Awaited<ReturnType<typeof makeApp>>;

  async function setupPr() {
    const name = `context-lab-${seq++}`;
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({
        workspaceId,
        owner: 'acme',
        name,
        fullName: `acme/${name}`,
        clonePath: `/clones/acme/${name}`,
      })
      .returning();
    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: repo!.id,
        number: 1,
        title: 'Query the pool from the handler',
        author: 'someone',
        branch: 'feat/x',
        base: 'main',
        headSha: 'abc1234',
        additions: 1,
        deletions: 0,
        filesCount: 1,
        status: 'needs_review',
      })
      .returning();
    return { repo: repo!, pr: pr! };
  }

  /**
   * Drive the lazy first scan to completion.
   *
   * Required before a run, not decoration: the run path reads a document only
   * while `repo_docs` still holds it, the same deny-by-default rule the reading
   * pane applies. A repository nobody has scanned has no documents to send.
   */
  async function scanRepo(app: App, repoId: string): Promise<void> {
    await app.inject({ method: 'GET', url: `/repos/${repoId}/context/docs` });
    await app.container.jobs.onIdle();
  }

  async function createAgent(app: App, name: string): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: {
        name,
        provider: 'openai',
        model: 'gpt-4o-mini',
        system_prompt: 'You are a reviewer.',
        repo_intel: false,
      },
    });
    return res.json().id as string;
  }

  async function traceOf(app: App, prId: string, agentId: string): Promise<RunTrace> {
    await app.inject({ method: 'POST', url: `/pulls/${prId}/review`, payload: { agentId } });
    const runs = await waitForPrRuns(pg.handle.db, prId, { expected: 1 });
    const res = await app.inject({ method: 'GET', url: `/runs/${runs[0]!.id}/trace` });
    expect(res.statusCode).toBe(200);
    return res.json() as RunTrace;
  }

  it('renders the attached documents in saved order, each with its path inside its wrapper', async () => {
    const app = await makeApp();
    const { repo, pr } = await setupPr();
    const agentId = await createAgent(app, 'Context Reviewer');
    await scanRepo(app, repo.id);
    // Saved in the REVERSE of alphabetical, so the order that comes back proves
    // the saved order and not a sort.
    await app.inject({
      method: 'PUT',
      url: `/agents/${agentId}/context-docs`,
      payload: { repo_id: repo.id, paths: ['docs/style.md', 'docs/architecture.md'] },
    });

    const trace = await traceOf(app, pr.id, agentId);
    const specs = trace.prompt_assembly.specs ?? '';

    expect(trace.prompt_assembly.user).toContain('## Project context');
    // Heading, then the ONE trusted line, then the first fence.
    expect(specs).toContain("this project's own specifications");
    expect(specs.indexOf("this project's own specifications")).toBeLessThan(
      specs.indexOf('<untrusted source="spec-0">'),
    );
    // The path travels inside the wrapper, beside the text.
    expect(specs).toContain('<untrusted source="spec-0">\n### docs/style.md');
    expect(specs).toContain('<untrusted source="spec-1">\n### docs/architecture.md');
    expect(specs).toContain('must not import `db/` directly');

    expect(trace.specs_read).toEqual(['docs/style.md', 'docs/architecture.md']);
    expect(trace.project_context).toEqual([
      { path: 'docs/style.md', tokens: expect.any(Number), status: 'included' },
      { path: 'docs/architecture.md', tokens: expect.any(Number), status: 'included' },
    ]);
    expect(trace.log.map((l) => l.msg)).toContainEqual(
      expect.stringMatching(/^project context: 2 of 2 document\(s\), \d+ token\(s\) attached/),
    );
    await app.close();
  });

  it('an agent with nothing attached produces the pre-08 prompt exactly', async () => {
    const app = await makeApp();
    const { pr } = await setupPr();
    const agentId = await createAgent(app, 'Plain Reviewer');

    const trace = await traceOf(app, pr.id, agentId);
    expect(trace.prompt_assembly.specs).toBeNull();
    expect(trace.prompt_assembly.user).not.toContain('## Project context');
    expect(trace.specs_read).toEqual([]);
    expect(trace.project_context).toEqual([]);
    // No section means nothing to say about one.
    expect(trace.log.map((l) => l.msg)).not.toContainEqual(
      expect.stringContaining('project context:'),
    );
    await app.close();
  });

  it('reports a document that left the clone as missing, and the run still finishes', async () => {
    const app = await makeApp({ 'docs/architecture.md': ARCHITECTURE });
    const { repo, pr } = await setupPr();
    const agentId = await createAgent(app, 'Half Reviewer');
    await scanRepo(app, repo.id);
    await app.inject({
      method: 'PUT',
      url: `/agents/${agentId}/context-docs`,
      payload: { repo_id: repo.id, paths: ['docs/gone.md', 'docs/architecture.md'] },
    });

    const trace = await traceOf(app, pr.id, agentId);
    expect(trace.project_context.map((d) => [d.path, d.status])).toEqual([
      ['docs/gone.md', 'missing'],
      ['docs/architecture.md', 'included'],
    ]);
    // The other document still went, and the run is not failed.
    expect(trace.specs_read).toEqual(['docs/architecture.md']);
    expect(trace.prompt_assembly.specs).toContain('### docs/architecture.md');
    expect(trace.log.map((l) => l.msg)).toContainEqual(
      expect.stringContaining('skipped docs/gone.md (missing)'),
    );
    await app.close();
  });

  it('stops at the first document that does not fit and drops the rest', async () => {
    const app = await makeApp();
    const { repo, pr } = await setupPr();
    const agentId = await createAgent(app, 'Budgeted Reviewer');
    await scanRepo(app, repo.id);
    await app.inject({
      method: 'PUT',
      url: `/agents/${agentId}/context-docs`,
      payload: { repo_id: repo.id, paths: ['docs/architecture.md', 'docs/style.md'] },
    });
    // Room for the first rendered document and nothing else.
    await app.inject({
      method: 'PUT',
      url: '/settings',
      payload: { context_token_budget: 25 },
    });

    try {
      const trace = await traceOf(app, pr.id, agentId);
      expect(trace.project_context.map((d) => d.status)).toEqual(['included', 'dropped']);
      expect(trace.specs_read).toEqual(['docs/architecture.md']);
      expect(trace.prompt_assembly.specs).not.toContain('docs/style.md');
    } finally {
      await app.inject({
        method: 'PUT',
        url: '/settings',
        payload: { context_token_budget: 16000 },
      });
      await app.close();
    }
  });

  it('a run against a DIFFERENT repository gets no section, a reason, and no substitute', async () => {
    const app = await makeApp();
    const bound = await setupPr();
    const other = await setupPr();
    const agentId = await createAgent(app, 'Bound Reviewer');
    await app.inject({
      method: 'PUT',
      url: `/agents/${agentId}/context-docs`,
      payload: { repo_id: bound.repo.id, paths: ['docs/architecture.md'] },
    });

    // The other repo's clone holds a file at the very same path. It must not be
    // picked up: the attachment is bound to a different repository.
    const trace = await traceOf(app, other.pr.id, agentId);
    expect(trace.prompt_assembly.specs).toBeNull();
    expect(trace.specs_read).toEqual([]);
    expect(trace.project_context).toEqual([]);
    expect(trace.log.map((l) => l.msg)).toContainEqual(
      expect.stringMatching(/attaches 1 document\(s\), but none for acme\/context-lab-/),
    );
    await app.close();
  });

  /**
   * The run path's deny-by-default gate, end to end.
   *
   * An admin narrows the roots and rescans; the document leaves `repo_docs` but
   * the attachment stays, exactly as the spec's edge case requires. Before the
   * gate, the page and the editor called it gone while every review still read
   * it off disk and sent it to the model.
   */
  it('stops sending a document once the roots no longer cover it, and reports it missing', async () => {
    const app = await makeApp();
    const { repo, pr } = await setupPr();
    const agentId = await createAgent(app, 'Narrowed Reviewer');
    await scanRepo(app, repo.id);
    await app.inject({
      method: 'PUT',
      url: `/agents/${agentId}/context-docs`,
      payload: { repo_id: repo.id, paths: ['docs/architecture.md'] },
    });

    await app.inject({ method: 'PUT', url: '/settings', payload: { context_scan_roots: ['specs'] } });
    try {
      await app.inject({ method: 'POST', url: `/repos/${repo.id}/context/rescan` });
      await app.container.jobs.onIdle();

      const trace = await traceOf(app, pr.id, agentId);
      // The attachment is STILL there — cleanup is the opposite of what the
      // edge case asks — and it reports itself rather than vanishing.
      const attached = await app.inject({
        method: 'GET',
        url: `/agents/${agentId}/context-docs?repo_id=${repo.id}`,
      });
      expect(attached.json().attached).toEqual([
        { path: 'docs/architecture.md', position: 0, tokens: null, missing: true },
      ]);
      expect(trace.project_context).toEqual([
        { path: 'docs/architecture.md', tokens: 0, status: 'missing' },
      ]);
      // The clone still holds the file. Nothing of it reached the prompt.
      expect(trace.prompt_assembly.specs).toBeNull();
      expect(trace.prompt_assembly.user).not.toContain('must not import');
      expect(trace.specs_read).toEqual([]);
    } finally {
      await app.inject({
        method: 'PUT',
        url: '/settings',
        payload: { context_scan_roots: ['specs', 'docs', 'insights'] },
      });
      await app.close();
    }
  });

  /**
   * `run_traces` is full of documents written before `project_context` existed —
   * 282 of the 285 rows on the development database. The read path parses rather
   * than casts, so the contract's `.default([])` fires and the drawer that reads
   * `.length` off the field has something to read.
   */
  it('serves a trace written before project_context existed, with the field defaulted', async () => {
    const app = await makeApp();
    const { pr } = await setupPr();
    const [run] = await pg.handle.db
      .insert(t.agentRuns)
      .values({ workspaceId, prId: pr.id, status: 'done' })
      .returning();
    // Written straight to the column: no typed writer can produce a document
    // that predates one of its own fields.
    await pg.handle.db.insert(t.runTraces).values({
      runId: run!.id,
      trace: {
        config: { agent: 'a', model: 'm', source: 'local' },
        stats: {
          duration_ms: 1,
          tokens_in: 1,
          tokens_out: 1,
          cost_usd: null,
          findings: 0,
          grounding: '0/0 passed',
        },
        prompt_assembly: { system: 's', user: 'u' },
        tool_calls: [],
        raw_output: '',
        memory_pulled: [],
        specs_read: [],
        log: [],
      },
    });

    const res = await app.inject({ method: 'GET', url: `/runs/${run!.id}/trace` });
    expect(res.statusCode).toBe(200);
    expect(res.json().project_context).toEqual([]);
    await app.close();
  });

  /**
   * The same read path one contract generation further back. `d45ab0d`
   * (2026-06-14) removed `cost_usd` from `RunStats` and from both trace
   * builders; `5e92756` (2026-07-28) put it back. A trace persisted between
   * those two carries `stats` with no `cost_usd` key at all, and a required key
   * would make the parse — and the route — throw on it. No row on this
   * development database is from that window, so the fixture is the only way to
   * reach the case.
   */
  it('serves a trace whose stats predate cost_usd, with the key defaulted to null', async () => {
    const app = await makeApp();
    const { pr } = await setupPr();
    const [run] = await pg.handle.db
      .insert(t.agentRuns)
      .values({ workspaceId, prId: pr.id, status: 'done' })
      .returning();
    await pg.handle.db.insert(t.runTraces).values({
      runId: run!.id,
      trace: {
        config: { agent: 'a', model: 'm', source: 'local' },
        // No `cost_usd`, exactly as the builders of that window wrote it.
        stats: { duration_ms: 1, tokens_in: 1, tokens_out: 1, findings: 0, grounding: '0/0 passed' },
        prompt_assembly: { system: 's', user: 'u' },
        tool_calls: [],
        raw_output: '',
        memory_pulled: [],
        specs_read: [],
        log: [],
      },
    });

    const res = await app.inject({ method: 'GET', url: `/runs/${run!.id}/trace` });
    expect(res.statusCode).toBe(200);
    expect(res.json().stats.cost_usd).toBeNull();
    await app.close();
  });

  it('an inherited document from an enabled skill reaches the prompt, deduped against the agent’s own', async () => {
    const app = await makeApp();
    const { repo, pr } = await setupPr();
    const agentId = await createAgent(app, 'Inheriting Reviewer');
    await scanRepo(app, repo.id);
    const skill = await app.inject({
      method: 'POST',
      url: '/skills',
      payload: { name: `House rules ${seq}`, description: 'rules', type: 'rubric', body: '# R' },
    });
    const skillId = skill.json().id as string;
    await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/skills`,
      payload: { skill_ids: [skillId] },
    });
    await app.inject({
      method: 'PUT',
      url: `/agents/${agentId}/context-docs`,
      payload: { repo_id: repo.id, paths: ['docs/architecture.md'] },
    });
    await app.inject({
      method: 'PUT',
      url: `/skills/${skillId}/context-docs`,
      payload: { repo_id: repo.id, paths: ['docs/architecture.md', 'docs/style.md'] },
    });

    const trace = await traceOf(app, pr.id, agentId);
    // Own first, then the skill's — and the shared document exactly once.
    expect(trace.specs_read).toEqual(['docs/architecture.md', 'docs/style.md']);
    expect(trace.prompt_assembly.specs!.match(/### docs\/architecture\.md/g)).toHaveLength(1);
    await app.close();
  });
});
