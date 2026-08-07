import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockCodeIndex, MockGitClient, MockLLMProvider } from '../src/adapters/mocks.js';
import type { RepoIntel } from '../src/modules/repo-intel/types.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[conventions] Docker not available — skipping integration tests.');
}

/**
 * The conventions module over a real database: extraction persists a scan and
 * its candidates, a person's accept/reject survives the next scan, and a
 * re-scan does not propose a rule that was already judged.
 */
d('/repos/:id/conventions', () => {
  let pg: PgFixture;
  let workspaceId: string;

  // Long enough to clear MIN_FILE_CHARS — a sample below the floor is dropped
  // before the model sees it, which would leave the scan with nothing to read.
  const ROUTES = [
    "import { ListQuery } from './schemas.js';",
    "import { ValidationError } from '../../platform/errors.js';",
    '',
    '/** GET /skills — workspace-scoped; the list carries no body. */',
    'export async function listSkills(req: Request) {',
    '  const parsed = ListQuery.parse(req.query);',
    '  throw new ValidationError("bad query");',
    '}',
    '',
    '/** DELETE /skills/:id — 404 across a workspace boundary. */',
    'export async function deleteSkill(req: Request) {',
    '  const { workspaceId } = await getContext(container, req);',
    '  throw new NotFoundError("Skill not found");',
    '}',
  ].join('\n');

  const SERVICE = [
    "import { CreateSkill } from './schemas.js';",
    "import { ValidationError } from '../../platform/errors.js';",
    '',
    '/** Create a skill; the repository versions the body. */',
    'export async function createSkill(input: CreateSkillInput) {',
    '  const parsed = CreateSkill.parse(input);',
    '  throw new ValidationError("bad body");',
    '}',
    '',
    '/** Update a skill, refusing an end state nobody should reach. */',
    'export async function updateSkill(id: string, patch: UpdateSkillInput) {',
    '  const row = await repo.getById(id);',
    '  throw new NotFoundError("Skill not found");',
    '}',
  ].join('\n');

  const FILES = {
    'tsconfig.json': '{ "compilerOptions": { "strict": true } }',
    'src/config.ts': ROUTES,
    'src/service.ts': SERVICE,
  };

  const CANDIDATE = {
    category: 'error-handling',
    rule: 'Handlers throw ValidationError instead of returning an error object.',
    evidence: [
      { path: 'src/config.ts', line: 3, snippet: 'throw new ValidationError("bad query");' },
      { path: 'src/service.ts', line: 3, snippet: 'throw new ValidationError("bad body");' },
    ],
    confidence: 0.9,
  };

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
   * `samples` stands in for repo-intel's ranking. Passing `[]` leaves the
   * service on its fallback path — a ripgrep proxy over the clone, which is
   * where a freshly added repo starts.
   */
  function makeApp(candidates: unknown[] = [CANDIDATE], samples = ['src/config.ts', 'src/service.ts']) {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    return buildApp({
      config,
      db: pg.handle.db,
      overrides: {
        git: new MockGitClient({ files: FILES }),
        codeIndex: new MockCodeIndex(),
        repoIntel: { getConventionSamples: async () => samples } as unknown as RepoIntel,
        // Under every provider id: the feature model's registry default decides
        // which one the service resolves, and a test must not follow it to a
        // real API when that default moves.
        llm: (() => {
          const mock = new MockLLMProvider('openai', {
            structuredBySchema: { ConventionExtraction: { candidates } },
          });
          return { openai: mock, anthropic: mock, openrouter: mock };
        })(),
      },
    });
  }

  async function addRepo(name: string) {
    const [row] = await pg.handle.db
      .insert(t.repos)
      .values({
        workspaceId,
        owner: 'acme',
        name,
        fullName: `acme/${name}`,
        defaultBranch: 'main',
        clonePath: `/clones/acme/${name}`,
      })
      .returning();
    return row!.id;
  }

  it('persists a scan and its candidates, and lists them back', async () => {
    const app = await makeApp();
    const repoId = await addRepo('conventions-api');

    const extract = await app.inject({
      method: 'POST',
      url: `/repos/${repoId}/conventions/extract`,
    });
    expect(extract.statusCode).toBe(200);
    const body = extract.json();
    expect(body.candidates).toHaveLength(1);
    expect(body.candidates[0].status).toBe('pending');
    expect(body.candidates[0].evidence_path).toBe('src/config.ts');
    expect(body.candidates[0].extra_evidence).toHaveLength(1);
    expect(body.scan).toMatchObject({ candidates_returned: 1, candidates_kept: 1 });
    // The snippet stored is the file's line, not the model's rendering of it.
    expect(body.candidates[0].evidence_snippet).toBe('  throw new ValidationError("bad query");');

    const list = await app.inject({ method: 'GET', url: `/repos/${repoId}/conventions` });
    expect(list.json().candidates).toHaveLength(1);
    expect(list.json().scan.id).toBe(body.scan.id);

    await app.close();
  });

  it('accepts, rejects and edits one candidate', async () => {
    const app = await makeApp();
    const repoId = await addRepo('billing-api');
    const extracted = await app.inject({
      method: 'POST',
      url: `/repos/${repoId}/conventions/extract`,
    });
    const id = extracted.json().candidates[0].id;

    const accepted = await app.inject({
      method: 'PATCH',
      url: `/conventions/${id}`,
      payload: { status: 'accepted' },
    });
    expect(accepted.json().status).toBe('accepted');

    const edited = await app.inject({
      method: 'PATCH',
      url: `/conventions/${id}`,
      payload: { rule: '  Handlers throw AppError subclasses.  ', category: 'api' },
    });
    expect(edited.json().rule).toBe('Handlers throw AppError subclasses.');
    expect(edited.json().category).toBe('api');
    // An edit does not un-judge the candidate.
    expect(edited.json().status).toBe('accepted');

    const empty = await app.inject({ method: 'PATCH', url: `/conventions/${id}`, payload: {} });
    expect(empty.statusCode).toBe(422);

    await app.close();
  });

  it('keeps judged candidates across a re-scan and does not propose them again', async () => {
    const app = await makeApp();
    const repoId = await addRepo('shipping-api');

    const first = await app.inject({ method: 'POST', url: `/repos/${repoId}/conventions/extract` });
    const id = first.json().candidates[0].id;
    await app.inject({
      method: 'PATCH',
      url: `/conventions/${id}`,
      payload: { status: 'rejected' },
    });

    const second = await app.inject({ method: 'POST', url: `/repos/${repoId}/conventions/extract` });
    const ids = second.json().candidates.map((c: { id: string }) => c.id);

    // The rejected row is still there — that is what stops the model proposing
    // it a second time — and the scan kept nothing new.
    expect(ids).toEqual([id]);
    expect(second.json().candidates[0].status).toBe('rejected');
    expect(second.json().scan.candidates_kept).toBe(0);

    const rows = await pg.handle.db
      .select()
      .from(t.conventions)
      .where(eq(t.conventions.repoId, repoId));
    expect(rows).toHaveLength(1);

    await app.close();
  });

  it('replaces the pending candidates of the previous scan', async () => {
    const app = await makeApp();
    const repoId = await addRepo('inventory-api');

    const first = await app.inject({ method: 'POST', url: `/repos/${repoId}/conventions/extract` });
    const firstId = first.json().candidates[0].id;

    const second = await app.inject({ method: 'POST', url: `/repos/${repoId}/conventions/extract` });
    expect(second.json().candidates).toHaveLength(1);
    expect(second.json().candidates[0].id).not.toBe(firstId);

    await app.close();
  });

  it('scans a repo repo-intel has not ranked yet, through the ripgrep fallback', async () => {
    // MockCodeIndex.grep reports `src/config.ts` and nothing else, so both
    // quotes have to come out of that one file.
    const app = await makeApp(
      [
        {
          ...CANDIDATE,
          evidence: [
            { path: 'src/config.ts', line: 2, snippet: 'const parsed = ListQuery.parse(req.query);' },
            { path: 'src/config.ts', line: 3, snippet: 'throw new ValidationError("bad query");' },
          ],
        },
      ],
      [],
    );
    const repoId = await addRepo('unindexed-api');

    const res = await app.inject({ method: 'POST', url: `/repos/${repoId}/conventions/extract` });
    expect(res.json().candidates).toHaveLength(1);
    expect(res.json().candidates[0].evidence_path).toBe('src/config.ts');

    await app.close();
  });

  it('404s for a repo in another workspace', async () => {
    const app = await makeApp();
    const [other] = await pg.handle.db
      .insert(t.workspaces)
      .values({ name: 'other-tenant' })
      .returning();
    const [foreign] = await pg.handle.db
      .insert(t.repos)
      .values({
        workspaceId: other!.id,
        owner: 'other',
        name: 'repo',
        fullName: 'other/repo',
        defaultBranch: 'main',
      })
      .returning();

    const res = await app.inject({
      method: 'POST',
      url: `/repos/${foreign!.id}/conventions/extract`,
    });
    expect(res.statusCode).toBe(404);

    await app.close();
  });
});
