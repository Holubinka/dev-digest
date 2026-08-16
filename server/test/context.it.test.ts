/**
 * 08 — the seven Project Context routes end to end, over a real Postgres.
 *
 * `MockSecretsProvider({})` guarantees no route here can reach a live provider,
 * and `MockGitClient` supplies the clone, so nothing touches the network or the
 * filesystem. What this file is for, and what the hermetic suites cannot check,
 * is the SQL: saved order surviving a round trip, the "used by N agents"
 * aggregate over two join paths, and workspace scoping on a real table.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockGitClient, MockSecretsProvider } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;
const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const TREE: Record<string, string> = {
  'docs/architecture.md': '# Architecture\n\napi/ must not import db/ directly.\n',
  'docs/style.md': '# Style\n',
  'specs/rate-limit.md': '# Rate limiting\n',
  'handbook/onboarding.md': '# Handbook\n',
  'src/ignored.ts': 'not markdown',
};

let pg: PgFixture;
let repoSeq = 0;

function appWith(tree: Record<string, string> = TREE) {
  return buildApp({
    config: config(),
    db: pg.handle.db,
    overrides: {
      secrets: new MockSecretsProvider({}),
      git: new MockGitClient({ tree }),
    },
  });
}

async function makeRepo(workspaceId: string, opts: { cloned?: boolean } = {}) {
  const name = `payments-api-${repoSeq++}`;
  const [repo] = await pg.handle.db
    .insert(t.repos)
    .values({
      workspaceId,
      owner: 'acme',
      name,
      fullName: `acme/${name}`,
      clonePath: opts.cloned === false ? null : `/clones/acme/${name}`,
    })
    .returning();
  return repo!;
}

async function makeAgent(workspaceId: string, opts: { enabled?: boolean } = {}) {
  const [agent] = await pg.handle.db
    .insert(t.agents)
    .values({
      workspaceId,
      name: `agent-${repoSeq++}`,
      provider: 'openai',
      model: 'gpt-4.1',
      systemPrompt: 'Review.',
      enabled: opts.enabled ?? true,
    })
    .returning();
  return agent!;
}

async function makeSkill(workspaceId: string, opts: { enabled?: boolean } = {}) {
  const [skill] = await pg.handle.db
    .insert(t.skills)
    .values({
      workspaceId,
      name: `skill-${repoSeq++}`,
      description: 'House rules',
      type: 'custom',
      source: 'manual',
      body: '# Rules',
      enabled: opts.enabled ?? true,
    })
    .returning();
  return skill!;
}

/** Drive the lazy first scan to completion so the document rows exist. */
async function scanned(app: Awaited<ReturnType<typeof buildApp>>, repoId: string) {
  const first = await app.inject({ method: 'GET', url: `/repos/${repoId}/context/docs` });
  expect(first.json().state).toBe('scanning');
  await app.container.jobs.onIdle();
  return app.inject({ method: 'GET', url: `/repos/${repoId}/context/docs` });
}

d('08 project context routes (Testcontainers pg)', () => {
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

  it('reports no_clone with an empty list for a repo that has not been cloned', async () => {
    const app = await appWith();
    const repo = await makeRepo(workspaceId, { cloned: false });
    const res = await app.inject({ method: 'GET', url: `/repos/${repo.id}/context/docs` });
    expect(res.statusCode).toBe(200);
    expect(res.json().state).toBe('no_clone');
    expect(res.json().documents).toEqual([]);
    // The roots are echoed so an empty state can name what was searched, and
    // `.devdigest` is one of them for every repository (`AC-61`).
    expect(res.json().roots).toEqual(['specs', 'docs', 'insights', '.devdigest']);
    await app.close();
  });

  it('enqueues the first scan on the first read, then serves the documents it found', async () => {
    const app = await appWith();
    const repo = await makeRepo(workspaceId);

    const res = await scanned(app, repo.id);
    const page = res.json();
    expect(page.state).toBe('scanned');
    expect(page.file_count).toBe(3);
    expect(page.bounded).toBe(false);
    expect(page.scanned_at).not.toBeNull();
    expect(page.last_error).toBeNull();
    expect(page.documents.map((doc: { path: string }) => doc.path)).toEqual([
      'docs/architecture.md',
      'docs/style.md',
      'specs/rate-limit.md',
    ]);
    // Kinds come from the root, and `content` is null on the list.
    expect(page.documents.map((doc: { kind: string }) => doc.kind)).toEqual([
      'docs',
      'docs',
      'specs',
    ]);
    expect(page.documents[0].content).toBeNull();
    expect(page.documents[0].tokens).toBeGreaterThan(0);
    await app.close();
  });

  it('serves one document’s markdown, and refuses a path with no scanned row', async () => {
    const app = await appWith();
    const repo = await makeRepo(workspaceId);
    await scanned(app, repo.id);

    const ok = await app.inject({
      method: 'GET',
      url: `/repos/${repo.id}/context/docs/content?path=docs/architecture.md`,
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().content).toContain('must not import db/');

    // Present in the clone, absent from the configured roots — so absent here.
    const denied = await app.inject({
      method: 'GET',
      url: `/repos/${repo.id}/context/docs/content?path=handbook/onboarding.md`,
    });
    expect(denied.statusCode).toBe(404);

    const traversal = await app.inject({
      method: 'GET',
      url: `/repos/${repo.id}/context/docs/content?path=${encodeURIComponent('../../etc/passwd')}`,
    });
    expect(traversal.statusCode).toBe(400);
    await app.close();
  });

  it('a configured root named none of the three yields kind `other`', async () => {
    const app = await appWith();
    const repo = await makeRepo(workspaceId);
    await pg.handle.db
      .insert(t.settings)
      .values({ workspaceId, key: 'context_scan_roots', value: ['handbook'] });
    try {
      const res = await scanned(app, repo.id);
      expect(res.json().documents.map((d2: { path: string; kind: string }) => [d2.path, d2.kind])).toEqual([
        ['handbook/onboarding.md', 'other'],
      ]);
    } finally {
      await pg.handle.db
        .delete(t.settings)
        .where(
          and(
            eq(t.settings.workspaceId, workspaceId),
            eq(t.settings.key, 'context_scan_roots'),
          ),
        );
      await app.close();
    }
  });

  it('PUT then GET returns the paths in the SAVED order, not alphabetical', async () => {
    const app = await appWith();
    const repo = await makeRepo(workspaceId);
    const agent = await makeAgent(workspaceId);
    await scanned(app, repo.id);

    const paths = ['specs/rate-limit.md', 'docs/style.md', 'docs/architecture.md'];
    const put = await app.inject({
      method: 'PUT',
      url: `/agents/${agent.id}/context-docs`,
      payload: { repo_id: repo.id, paths },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().attached.map((a: { path: string }) => a.path)).toEqual(paths);

    const get = await app.inject({
      method: 'GET',
      url: `/agents/${agent.id}/context-docs?repo_id=${repo.id}`,
    });
    expect(get.json().attached.map((a: { path: string }) => a.path)).toEqual(paths);
    expect(get.json().attached.map((a: { position: number }) => a.position)).toEqual([0, 1, 2]);
    expect(get.json().attached[0].tokens).toBeGreaterThan(0);
    expect(get.json().attached[0].missing).toBe(false);
    await app.close();
  });

  it('rejects a traversal path and an oversized set, and leaves the saved set alone', async () => {
    const app = await appWith();
    const repo = await makeRepo(workspaceId);
    const agent = await makeAgent(workspaceId);
    await scanned(app, repo.id);
    await app.inject({
      method: 'PUT',
      url: `/agents/${agent.id}/context-docs`,
      payload: { repo_id: repo.id, paths: ['docs/style.md'] },
    });

    const traversal = await app.inject({
      method: 'PUT',
      url: `/agents/${agent.id}/context-docs`,
      payload: { repo_id: repo.id, paths: ['docs/style.md', '../../etc/passwd'] },
    });
    expect(traversal.statusCode).toBe(400);

    // 422, not 400: the `.max(50)` is a route SCHEMA rule, and this app answers
    // every schema failure with 422 (`modules/_shared/schemas.ts` says so about
    // `IdParams`). The plan's verification text predicted 400 for both this and
    // the traversal above; only the traversal is decided by the service, and
    // that one is 400. What both requirements actually ask for — reject the
    // whole body, save nothing — holds either way.
    const tooMany = await app.inject({
      method: 'PUT',
      url: `/agents/${agent.id}/context-docs`,
      payload: {
        repo_id: repo.id,
        paths: Array.from({ length: 51 }, (_, i) => `docs/f${i}.md`),
      },
    });
    expect(tooMany.statusCode).toBe(422);

    const after = await app.inject({
      method: 'GET',
      url: `/agents/${agent.id}/context-docs?repo_id=${repo.id}`,
    });
    expect(after.json().attached.map((a: { path: string }) => a.path)).toEqual(['docs/style.md']);
    await app.close();
  });

  it('saves a repeated path once, at its first position', async () => {
    const app = await appWith();
    const repo = await makeRepo(workspaceId);
    const agent = await makeAgent(workspaceId);
    await scanned(app, repo.id);
    const put = await app.inject({
      method: 'PUT',
      url: `/agents/${agent.id}/context-docs`,
      payload: {
        repo_id: repo.id,
        paths: ['docs/style.md', 'docs/architecture.md', 'docs/style.md'],
      },
    });
    expect(put.json().attached.map((a: { path: string }) => a.path)).toEqual([
      'docs/style.md',
      'docs/architecture.md',
    ]);
    await app.close();
  });

  it('counts "used by N agents" across BOTH join paths, and ignores a disabled skill', async () => {
    const app = await appWith();
    const repo = await makeRepo(workspaceId);
    await scanned(app, repo.id);

    const direct = await makeAgent(workspaceId);
    const viaEnabled = await makeAgent(workspaceId);
    const viaDisabled = await makeAgent(workspaceId);
    const enabledSkill = await makeSkill(workspaceId);
    const disabledSkill = await makeSkill(workspaceId, { enabled: false });
    await pg.handle.db.insert(t.agentSkills).values([
      { agentId: viaEnabled.id, skillId: enabledSkill.id, order: 0 },
      { agentId: viaDisabled.id, skillId: disabledSkill.id, order: 0 },
    ]);

    const doc = 'docs/architecture.md';
    await app.inject({
      method: 'PUT',
      url: `/agents/${direct.id}/context-docs`,
      payload: { repo_id: repo.id, paths: [doc] },
    });
    await app.inject({
      method: 'PUT',
      url: `/skills/${enabledSkill.id}/context-docs`,
      payload: { repo_id: repo.id, paths: [doc] },
    });
    await app.inject({
      method: 'PUT',
      url: `/skills/${disabledSkill.id}/context-docs`,
      payload: { repo_id: repo.id, paths: [doc] },
    });

    const page = await app.inject({ method: 'GET', url: `/repos/${repo.id}/context/docs` });
    const row = page
      .json()
      .documents.find((doc2: { path: string }) => doc2.path === doc);
    // The direct one and the one reaching it through an ENABLED skill. Not the
    // third: a disabled skill's body never becomes a prompt block, so neither
    // do its documents.
    expect(row.used_by_agents).toBe(2);
    await app.close();
  });

  it('counts an agent that reaches a document BOTH ways exactly once', async () => {
    const app = await appWith();
    const repo = await makeRepo(workspaceId);
    await scanned(app, repo.id);
    const agent = await makeAgent(workspaceId);
    const skill = await makeSkill(workspaceId);
    await pg.handle.db
      .insert(t.agentSkills)
      .values({ agentId: agent.id, skillId: skill.id, order: 0 });

    const doc = 'docs/style.md';
    await app.inject({
      method: 'PUT',
      url: `/agents/${agent.id}/context-docs`,
      payload: { repo_id: repo.id, paths: [doc] },
    });
    await app.inject({
      method: 'PUT',
      url: `/skills/${skill.id}/context-docs`,
      payload: { repo_id: repo.id, paths: [doc] },
    });

    const page = await app.inject({ method: 'GET', url: `/repos/${repo.id}/context/docs` });
    const row = page.json().documents.find((d2: { path: string }) => d2.path === doc);
    // Two counts added together would say 2. COUNT(DISTINCT) over the union says 1.
    expect(row.used_by_agents).toBe(1);

    // …and the agent editor marks the inherited row as already attached.
    const agentDocs = await app.inject({
      method: 'GET',
      url: `/agents/${agent.id}/context-docs?repo_id=${repo.id}`,
    });
    expect(agentDocs.json().inherited).toEqual([
      {
        path: doc,
        tokens: expect.any(Number),
        skill_id: skill.id,
        skill_name: skill.name,
        also_attached: true,
      },
    ]);
    await app.close();
  });

  it('scopes by workspace: a repo, agent and skill from elsewhere are 404', async () => {
    const app = await appWith();
    const [other] = await pg.handle.db
      .insert(t.workspaces)
      .values({ name: 'another tenant' })
      .returning();
    const otherRepo = await makeRepo(other!.id);
    const otherAgent = await makeAgent(other!.id);
    const otherSkill = await makeSkill(other!.id);
    const mineRepo = await makeRepo(workspaceId);

    expect(
      (await app.inject({ method: 'GET', url: `/repos/${otherRepo.id}/context/docs` })).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: `/agents/${otherAgent.id}/context-docs`,
          payload: { repo_id: mineRepo.id, paths: ['docs/style.md'] },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: `/skills/${otherSkill.id}/context-docs`,
          payload: { repo_id: mineRepo.id, paths: ['docs/style.md'] },
        })
      ).statusCode,
    ).toBe(404);
    // A repo belonging to the other workspace is equally refused for an agent
    // that IS mine — the link table's foreign key would have accepted it.
    const mineAgent = await makeAgent(workspaceId);
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: `/agents/${mineAgent.id}/context-docs`,
          payload: { repo_id: otherRepo.id, paths: ['docs/style.md'] },
        })
      ).statusCode,
    ).toBe(404);
    await app.close();
  });

  it('rescan re-runs the scan and updates the count', async () => {
    const app = await appWith();
    const repo = await makeRepo(workspaceId);
    await scanned(app, repo.id);

    const res = await app.inject({
      method: 'POST',
      url: `/repos/${repo.id}/context/rescan`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'scanning' });
    await app.container.jobs.onIdle();

    const page = await app.inject({ method: 'GET', url: `/repos/${repo.id}/context/docs` });
    expect(page.json().state).toBe('scanned');
    expect(page.json().file_count).toBe(3);
    await app.close();
  });

  /**
   * The SECOND scan, observed while it is in flight. The test above only ever
   * looked after `onIdle`, and the first-scan assertion in `scanned()` is about
   * a row that does not exist yet — so both were green while a rescan answered
   * `{status:'scanning'}` and the very next read said `scanned`, which is what
   * stopped the page polling and left the Rescan button enabled.
   */
  it('a rescan of an ALREADY-scanned repo reads back as scanning, over the previous result', async () => {
    const app = await appWith();
    const repo = await makeRepo(workspaceId);
    const first = await scanned(app, repo.id);
    const scannedAt = first.json().scanned_at;
    expect(first.json().state).toBe('scanned');

    // A second app over the SAME database whose walk is held open, so "while the
    // scan is in flight" is a state the test decides on rather than races for.
    const git = new MockGitClient({ tree: TREE });
    const walk = git.listFiles.bind(git);
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    git.listFiles = async (ref, opts) => {
      await held;
      return walk(ref, opts);
    };
    const slow = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { secrets: new MockSecretsProvider({}), git },
    });

    const res = await slow.inject({ method: 'POST', url: `/repos/${repo.id}/context/rescan` });
    expect(res.json()).toEqual({ status: 'scanning' });

    const during = await app.inject({ method: 'GET', url: `/repos/${repo.id}/context/docs` });
    expect(during.json().state).toBe('scanning');
    // The previous result is still underneath it: a rescan is not a reset.
    expect(during.json().file_count).toBe(3);
    expect(during.json().scanned_at).toBe(scannedAt);
    expect(during.json().documents).toHaveLength(3);

    release();
    await slow.container.jobs.onIdle();
    const after = await app.inject({ method: 'GET', url: `/repos/${repo.id}/context/docs` });
    expect(after.json().state).toBe('scanned');
    expect(after.json().scanned_at).not.toBe(scannedAt);
    await slow.close();
    await app.close();
  });

  it('a failed rescan leaves the previous result intact beside the failure', async () => {
    const app = await appWith();
    const repo = await makeRepo(workspaceId);
    const good = await scanned(app, repo.id);
    const scannedAt = good.json().scanned_at;
    expect(good.json().file_count).toBe(3);

    // A second app over the SAME database whose clone has gone away.
    const broken = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        secrets: new MockSecretsProvider({}),
        git: new MockGitClient({ noClone: true }),
      },
    });
    await broken.inject({ method: 'POST', url: `/repos/${repo.id}/context/rescan` });
    await broken.container.jobs.onIdle().catch(() => undefined);

    const page = await app.inject({ method: 'GET', url: `/repos/${repo.id}/context/docs` });
    const body = page.json();
    expect(body.state).toBe('failed');
    expect(body.last_error).toMatch(/ENOENT/);
    expect(body.last_error_at).not.toBeNull();
    // Untouched: the count, the time and the documents from the last success.
    expect(body.file_count).toBe(3);
    expect(body.scanned_at).toBe(scannedAt);
    expect(body.documents).toHaveLength(3);

    await broken.close();
    await app.close();
  });

  it('serves a skill’s own set, and an agent inherits it in binding order', async () => {
    const app = await appWith();
    const repo = await makeRepo(workspaceId);
    await scanned(app, repo.id);
    const agent = await makeAgent(workspaceId);
    const first = await makeSkill(workspaceId);
    const second = await makeSkill(workspaceId);
    await pg.handle.db.insert(t.agentSkills).values([
      { agentId: agent.id, skillId: second.id, order: 1 },
      { agentId: agent.id, skillId: first.id, order: 0 },
    ]);
    await app.inject({
      method: 'PUT',
      url: `/skills/${first.id}/context-docs`,
      payload: { repo_id: repo.id, paths: ['docs/style.md'] },
    });
    await app.inject({
      method: 'PUT',
      url: `/skills/${second.id}/context-docs`,
      payload: { repo_id: repo.id, paths: ['specs/rate-limit.md'] },
    });

    const skillDocs = await app.inject({
      method: 'GET',
      url: `/skills/${first.id}/context-docs?repo_id=${repo.id}`,
    });
    expect(skillDocs.json()).toEqual({
      repo_id: repo.id,
      attached: [
        { path: 'docs/style.md', position: 0, tokens: expect.any(Number), missing: false },
      ],
    });

    const agentDocs = await app.inject({
      method: 'GET',
      url: `/agents/${agent.id}/context-docs?repo_id=${repo.id}`,
    });
    expect(agentDocs.json().attached).toEqual([]);
    expect(agentDocs.json().inherited.map((i: { path: string }) => i.path)).toEqual([
      'docs/style.md',
      'specs/rate-limit.md',
    ]);
    await app.close();
  });

  it('an attachment whose file left the clone stays, and reports itself missing', async () => {
    const app = await appWith();
    const repo = await makeRepo(workspaceId);
    const agent = await makeAgent(workspaceId);
    await scanned(app, repo.id);
    await app.inject({
      method: 'PUT',
      url: `/agents/${agent.id}/context-docs`,
      payload: { repo_id: repo.id, paths: ['docs/style.md'] },
    });

    // Rescan against a clone that no longer holds the file.
    const shrunk = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        secrets: new MockSecretsProvider({}),
        git: new MockGitClient({ tree: { 'docs/architecture.md': '# Architecture\n' } }),
      },
    });
    await shrunk.inject({ method: 'POST', url: `/repos/${repo.id}/context/rescan` });
    await shrunk.container.jobs.onIdle();

    const after = await app.inject({
      method: 'GET',
      url: `/agents/${agent.id}/context-docs?repo_id=${repo.id}`,
    });
    // The row STAYS and shows `missing`. Cleaning it up is the opposite of what
    // the requirement asks for.
    expect(after.json().attached).toEqual([
      { path: 'docs/style.md', position: 0, tokens: null, missing: true },
    ]);
    await shrunk.close();
    await app.close();
  });

  // =========================================================================
  // 09 — authoring
  //
  // The SQL is what these are for: the upsert against `repo_docs_repo_path_uq`,
  // the `repo_doc_edits` join that produces `local`, and the recomputed
  // `file_count`. The hermetic suites can pin every decision except those.
  // =========================================================================

  it('creates a document that is in the list immediately, with NO rescan, and is attachable', async () => {
    const app = await appWith();
    const repo = await makeRepo(workspaceId);
    const agent = await makeAgent(workspaceId);
    const before = await scanned(app, repo.id);
    expect(before.json().file_count).toBe(3);

    const created = await app.inject({
      method: 'POST',
      url: `/repos/${repo.id}/context/docs`,
      payload: { path: '.devdigest/specs/public-api.md', content: '# Public API\n\nRules.\n' },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().local).toBe(true);
    expect(created.json().root).toBe('.devdigest');
    expect(created.json().tokens).toBeGreaterThan(0);
    // The badge matches the label the row will show. `.devdigest` is a
    // container, so the folder below it names the family.
    expect(created.json().kind).toBe('specs');

    // No rescan between the write and this read: the row is the point.
    const page = await app.inject({ method: 'GET', url: `/repos/${repo.id}/context/docs` });
    const paths = page.json().documents.map((d2: { path: string }) => d2.path);
    expect(paths).toContain('.devdigest/specs/public-api.md');
    // …and the footer's count agrees with the list it sits under.
    expect(page.json().file_count).toBe(paths.length);
    expect(page.json().state).toBe('scanned');
    const row = page
      .json()
      .documents.find((d2: { path: string }) => d2.path === '.devdigest/specs/public-api.md');
    expect(row.local).toBe(true);
    expect(row.stale).toBe(false);

    // An ordinary scan result: attachable like any other.
    const put = await app.inject({
      method: 'PUT',
      url: `/agents/${agent.id}/context-docs`,
      payload: { repo_id: repo.id, paths: ['.devdigest/specs/public-api.md'] },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().attached[0].missing).toBe(false);
    expect(put.json().attached[0].tokens).toBeGreaterThan(0);

    // …and a RESCAN labels it exactly as the write did. The two derivations are
    // one function reached from two callers, and this is the assertion that
    // says so: a badge that changed under the reader on the next scan would be
    // a change nobody could account for.
    await app.inject({ method: 'POST', url: `/repos/${repo.id}/context/rescan` });
    await app.container.jobs.onIdle();
    const rescanned = await app.inject({ method: 'GET', url: `/repos/${repo.id}/context/docs` });
    const sameRow = rescanned
      .json()
      .documents.find((d2: { path: string }) => d2.path === '.devdigest/specs/public-api.md');
    expect(sameRow.kind).toBe('specs');
    expect(sameRow.root).toBe('.devdigest');
    await app.close();
  });

  it('answers 409 on a second create of the same path, and does not overwrite', async () => {
    const app = await appWith();
    const repo = await makeRepo(workspaceId);
    await scanned(app, repo.id);
    const body = { path: '.devdigest/notes.md', content: 'FIRST' };

    expect((await app.inject({ method: 'POST', url: `/repos/${repo.id}/context/docs`, payload: body })).statusCode).toBe(201);
    const second = await app.inject({
      method: 'POST',
      url: `/repos/${repo.id}/context/docs`,
      payload: { ...body, content: 'SECOND' },
    });
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe('already_exists');

    const read = await app.inject({
      method: 'GET',
      url: `/repos/${repo.id}/context/docs/content?path=${encodeURIComponent('.devdigest/notes.md')}`,
    });
    expect(read.json().content).toBe('FIRST');
    await app.close();
  });

  it('saves an edit, and the next content read returns the new text', async () => {
    const app = await appWith();
    const repo = await makeRepo(workspaceId);
    await scanned(app, repo.id);

    const saved = await app.inject({
      method: 'PUT',
      url: `/repos/${repo.id}/context/docs/content`,
      payload: { path: 'docs/style.md', content: '# Style\n\nTwo spaces.\n' },
    });
    expect(saved.statusCode).toBe(200);
    // A save is not a create: the document is still the repository's.
    expect(saved.json().local).toBe(false);
    expect(saved.json().stale).toBe(false);

    const read = await app.inject({
      method: 'GET',
      url: `/repos/${repo.id}/context/docs/content?path=docs/style.md`,
    });
    expect(read.json().content).toBe('# Style\n\nTwo spaces.\n');
    await app.close();
  });

  it('creates a folder and says so, rather than returning an unchanged list', async () => {
    const app = await appWith();
    const repo = await makeRepo(workspaceId);
    const before = await scanned(app, repo.id);

    const folder = await app.inject({
      method: 'POST',
      url: `/repos/${repo.id}/context/folders`,
      payload: { path: '.devdigest/adr' },
    });
    expect(folder.statusCode).toBe(201);
    expect(folder.json()).toEqual({ path: '.devdigest/adr' });

    const after = await app.inject({ method: 'GET', url: `/repos/${repo.id}/context/docs` });
    expect(after.json().documents).toHaveLength(before.json().documents.length);
    await app.close();
  });

  it('refuses a write outside .devdigest/, a traversal, and a repo from another workspace', async () => {
    const app = await appWith();
    const repo = await makeRepo(workspaceId);
    await scanned(app, repo.id);
    const [other] = await pg.handle.db
      .insert(t.workspaces)
      .values({ name: 'another tenant for writes' })
      .returning();
    const otherRepo = await makeRepo(other!.id);

    const outsideZone = await app.inject({
      method: 'POST',
      url: `/repos/${repo.id}/context/docs`,
      payload: { path: 'docs/planted.md', content: 'x' },
    });
    expect(outsideZone.statusCode).toBe(400);
    expect(outsideZone.json().error.code).toBe('invalid_path');

    const traversal = await app.inject({
      method: 'POST',
      url: `/repos/${repo.id}/context/docs`,
      payload: { path: '../../etc/passwd.md', content: 'x' },
    });
    expect(traversal.statusCode).toBe(400);

    // 400 `too_large`, and NOT the 422 a route-schema `.max()` would produce.
    // The size of a document is a fact the client renders as "this is too big";
    // a schema failure is "your request was malformed", and this app answers
    // those 422 (see the `.max(50)` note above). Which is why `content` carries
    // no `.max()` in the contract and the bound lives in the service.
    const tooLarge = await app.inject({
      method: 'POST',
      url: `/repos/${repo.id}/context/docs`,
      payload: { path: '.devdigest/big.md', content: 'x'.repeat(40_001) },
    });
    expect(tooLarge.statusCode).toBe(400);
    expect(tooLarge.json().error.code).toBe('too_large');

    // Tenancy is decided before anything is written, so this is a 404 and not a
    // successful write into somebody else's clone.
    const crossTenant = await app.inject({
      method: 'POST',
      url: `/repos/${otherRepo.id}/context/docs`,
      payload: { path: '.devdigest/a.md', content: 'x' },
    });
    expect(crossTenant.statusCode).toBe(404);
    await app.close();
  });

  it('answers 409 clone_not_ready when the repo has no clone yet', async () => {
    const app = await appWith();
    const repo = await makeRepo(workspaceId, { cloned: false });
    const res = await app.inject({
      method: 'POST',
      url: `/repos/${repo.id}/context/docs`,
      payload: { path: '.devdigest/a.md', content: 'x' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('clone_not_ready');
    await app.close();
  });

  /**
   * The three read failures, as three codes. They used to be one 404, which told
   * somebody whose symlinked document was refused that it was missing.
   */
  it('reports doc_missing, doc_refused and doc_binary as three different answers', async () => {
    const app = await appWith({
      ...TREE,
      'docs/binary.md': 'text\u0000more',
      'docs/refused.md': 'never read',
    });
    const repo = await makeRepo(workspaceId);
    await scanned(app, repo.id);

    const binary = await app.inject({
      method: 'GET',
      url: `/repos/${repo.id}/context/docs/content?path=docs/binary.md`,
    });
    expect(binary.statusCode).toBe(415);
    expect(binary.json().error.code).toBe('doc_binary');

    // A path with no scanned row at all.
    const missing = await app.inject({
      method: 'GET',
      url: `/repos/${repo.id}/context/docs/content?path=docs/never-existed.md`,
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe('doc_missing');

    // Scanned, then refused by the clone — the symlink case, over a second app
    // whose port refuses that one path.
    const refusing = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        secrets: new MockSecretsProvider({}),
        git: new MockGitClient({
          tree: { ...TREE, 'docs/refused.md': 'never read' },
          refuse: { 'docs/refused.md': 'outside_clone' },
        }),
      },
    });
    const refused = await refusing.inject({
      method: 'GET',
      url: `/repos/${repo.id}/context/docs/content?path=docs/refused.md`,
    });
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error.code).toBe('doc_refused');
    await refusing.close();
    await app.close();
  });

  /**
   * `AC-71`. A tracked file edited here, then returned to the branch by a
   * resync's `git reset --hard`, and a rescan that hashes what is now on disk.
   */
  it('marks a document stale once the disk no longer holds the text DevDigest saved', async () => {
    const app = await appWith();
    const repo = await makeRepo(workspaceId);
    await scanned(app, repo.id);

    await app.inject({
      method: 'PUT',
      url: `/repos/${repo.id}/context/docs/content`,
      payload: { path: 'docs/style.md', content: 'MY EDIT' },
    });
    const fresh = await app.inject({ method: 'GET', url: `/repos/${repo.id}/context/docs` });
    expect(
      fresh.json().documents.find((d2: { path: string }) => d2.path === 'docs/style.md').stale,
    ).toBe(false);

    // What a resync leaves behind: the branch's text back on disk, and a rescan
    // over it. A second app whose clone holds the ORIGINAL body again.
    const reset = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        secrets: new MockSecretsProvider({}),
        git: new MockGitClient({ tree: TREE }),
      },
    });
    await reset.inject({ method: 'POST', url: `/repos/${repo.id}/context/rescan` });
    await reset.container.jobs.onIdle();

    const after = await app.inject({ method: 'GET', url: `/repos/${repo.id}/context/docs` });
    const row = after.json().documents.find((d2: { path: string }) => d2.path === 'docs/style.md');
    expect(row.stale).toBe(true);
    expect(row.local).toBe(false);
    await reset.close();
    await app.close();
  });

  it('uploads a .md, basenaming a traversal filename, and refuses a binary body', async () => {
    const app = await appWith();
    const repo = await makeRepo(workspaceId);
    await scanned(app, repo.id);

    // Hand-built rather than taken from a library: the point of this case is the
    // exact `filename` the parser hands the service, and a form-data helper that
    // sanitised it would be testing itself.
    const form = (filename: string, body: Buffer) => {
      const boundary = '----dd';
      const head = Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
          `Content-Type: text/markdown\r\n\r\n`,
      );
      const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
      return {
        headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
        payload: Buffer.concat([head, body, tail]),
      };
    };

    const ok = await app.inject({
      method: 'POST',
      url: `/repos/${repo.id}/context/docs/upload`,
      ...form('../../evil.md', Buffer.from('# Uploaded')),
    });
    expect(ok.statusCode).toBe(201);
    // The client's filename is a NAME, never a path.
    expect(ok.json().path).toBe('.devdigest/evil.md');
    expect(ok.json().local).toBe(true);

    const binary = await app.inject({
      method: 'POST',
      url: `/repos/${repo.id}/context/docs/upload`,
      ...form('trojan.md', Buffer.from([0x4d, 0x5a, 0x00, 0x41])),
    });
    expect(binary.statusCode).toBe(400);
    expect(binary.json().error.code).toBe('binary_content');
    await app.close();
  });
});
