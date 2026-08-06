import { describe, it, expect } from 'vitest';
import { Container } from '../src/platform/container.js';
import { loadConfig } from '../src/platform/config.js';
import type { Db } from '../src/db/client.js';
import type { ConventionRow, ConventionScanRow } from '../src/db/rows.js';
import { MockCodeIndex, MockGitClient, MockLLMProvider } from '../src/adapters/mocks.js';
import { ConventionsService } from '../src/modules/conventions/service.js';
import type { ConventionsRepository, InsertCandidate } from '../src/modules/conventions/repository.js';

/**
 * The extraction pipeline end to end without a database: sampling reads through
 * the git port, one mocked model call answers, and grounding decides what
 * survives. The assertions are about what the model is NOT allowed to get away
 * with — a fabricated quote, a file it never saw, a rule ESLint already covers.
 */

/**
 * Two sample files, long enough to clear the floor a real sample has to clear:
 * a nine-line helper is filtered out before the model sees it.
 */
const HANDLER = [
  "import { ListQuery } from './schemas.js';",
  "import { ValidationError } from '../../platform/errors.js';",
  "import { SkillsService } from './service.js';",
  '',
  '/** GET /skills — workspace-scoped, no body on the list. */',
  'export async function listSkills(req: Request) {',
  '  const parsed = ListQuery.parse(req.query);',
  '  if (!parsed.ok) throw new ValidationError("bad query");',
  '  return service.list(parsed.value);',
  '}',
  '',
  '/** DELETE /skills/:id — 404 when the row belongs to another workspace. */',
  'export async function deleteSkill(req: Request) {',
  '  const { workspaceId } = await getContext(container, req);',
  '  const ok = await service.delete(workspaceId, req.params.id);',
  '  if (!ok) throw new NotFoundError("Skill not found");',
  '  return { ok: true };',
  '}',
].join('\n');

const SERVICE = [
  "import { CreateSkill } from './schemas.js';",
  "import { ValidationError } from '../../platform/errors.js';",
  "import { SkillsRepository } from './repository.js';",
  '',
  '/** Create a skill; the body is versioned by the repository. */',
  'export async function createSkill(input: CreateSkillInput) {',
  '  const parsed = CreateSkill.parse(input);',
  '  if (!parsed.ok) throw new ValidationError("bad body");',
  '  return repo.insert(parsed.value);',
  '}',
  '',
  '/** Update a skill, refusing an end state nobody should be able to reach. */',
  'export async function updateSkill(id: string, patch: UpdateSkillInput) {',
  '  const row = await repo.getById(id);',
  '  if (!row) throw new NotFoundError("Skill not found");',
  '  return repo.update(id, patch);',
  '}',
].join('\n');

const FILES: Record<string, string> = {
  'tsconfig.json': '{ "compilerOptions": { "strict": true } }',
  '.prettierrc': '{ "semi": true, "singleQuote": true }',
  'src/routes.ts': HANDLER,
  'src/service.ts': SERVICE,
};

const REPO_ROW = {
  id: 'repo-1',
  owner: 'acme',
  name: 'payments-api',
  fullName: 'acme/payments-api',
  defaultBranch: 'main',
  clonePath: '/clones/acme/payments-api',
};

/** A candidate as the model would return it. */
function candidate(over: Partial<ModelCandidate> = {}): ModelCandidate {
  return {
    category: 'error-handling',
    rule: 'Handlers validate input with a Zod schema and throw ValidationError on failure.',
    evidence: [
      { path: 'src/routes.ts', line: 2, snippet: 'const parsed = ListQuery.parse(req.query);' },
      { path: 'src/service.ts', line: 2, snippet: 'const parsed = CreateSkill.parse(input);' },
    ],
    confidence: 0.9,
    ...over,
  };
}

interface ModelCandidate {
  category: string;
  rule: string;
  evidence: { path: string; line: number; snippet: string }[];
  confidence: number;
}

/** In-memory stand-in for the data layer, recording what the service persists. */
function fakeRepo(judged: string[] = []) {
  const saved: Omit<InsertCandidate, 'scanId'>[] = [];
  let scanRow: ConventionScanRow | undefined;

  const rows = (): ConventionRow[] =>
    saved.map((c, i) => {
      const [first, ...rest] = c.evidence;
      return {
        id: `cand-${i}`,
        workspaceId: c.workspaceId,
        repoId: c.repoId,
        scanId: scanRow?.id ?? null,
        category: c.category,
        rule: c.rule,
        evidencePath: first?.path ?? null,
        evidenceSnippet: first?.snippet ?? null,
        evidenceLine: first?.line ?? null,
        evidenceEndLine: first?.end_line ?? null,
        extraEvidence: rest,
        headSha: c.headSha,
        confidence: c.confidence,
        status: 'pending' as const,
        createdAt: new Date(0),
      };
    });

  const repo = {
    async getRepo() {
      return REPO_ROW;
    },
    // Pinned rather than left to the registry default: when that default moved
    // to another provider, every test in this file started calling the real
    // API through a provider nobody had injected a mock for.
    async featureModelOverride() {
      return { provider: 'openai' as const, model: 'gpt-4o-mini' };
    },
    async judgedRules() {
      return judged;
    },
    async latestScan() {
      return scanRow;
    },
    async listForRepo() {
      return rows();
    },
    async replacePending(
      _workspaceId: string,
      _repoId: string,
      scan: Omit<ConventionScanRow, 'id' | 'createdAt'>,
      candidates: Omit<InsertCandidate, 'scanId'>[],
    ) {
      saved.splice(0, saved.length, ...candidates);
      scanRow = { ...scan, id: 'scan-1', createdAt: new Date(0) } as ConventionScanRow;
      return { scan: scanRow, rows: rows() };
    },
  } as unknown as ConventionsRepository;

  return { repo, saved, scan: () => scanRow };
}

function serviceWith(
  candidates: ModelCandidate[],
  repo: ConventionsRepository,
  opts: { ranked?: string[]; files?: Record<string, string> } = {},
) {
  const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
  const llm = new MockLLMProvider('openai', {
    structuredBySchema: { ConventionExtraction: { candidates } },
  });
  const container = new Container(config, {} as Db, {
    // Every provider maps to the mock: a test must not be able to reach a real
    // API because a default moved.
    llm: { openai: llm, anthropic: llm, openrouter: llm },
    git: new MockGitClient({ files: opts.files ?? FILES }),
    codeIndex: new MockCodeIndex(),
    repoIntel: {
      getConventionSamples: async () => opts.ranked ?? ['src/routes.ts', 'src/service.ts'],
    } as unknown as Container['repoIntel'],
  });
  return { service: new ConventionsService(container, repo), llm };
}

async function extract(
  candidates: ModelCandidate[],
  judged: string[] = [],
  opts: { ranked?: string[]; files?: Record<string, string> } = {},
) {
  const { repo, saved, scan } = fakeRepo(judged);
  const { service, llm } = serviceWith(candidates, repo, opts);
  const result = await service.extract('ws-1', 'repo-1');
  return { result: result!, saved, scan, llm };
}

describe('ConventionsService.extract', () => {
  it('keeps a rule whose quotes are all in the repo, and stores the real code', async () => {
    const { result, saved } = await extract([candidate()]);

    expect(result.response.candidates).toHaveLength(1);
    expect(result.audit).toMatchObject({ returned: 1, kept: 1 });
    expect(saved[0]?.evidence).toHaveLength(2);
    // The fixture claims line 2; the quote is on line 7. Re-anchoring is what
    // keeps this candidate alive, and the stored line is the true one.
    expect(saved[0]?.evidence[0]).toMatchObject({
      path: 'src/routes.ts',
      line: 7,
      snippet: '  const parsed = ListQuery.parse(req.query);',
    });
  });

  it('samples the config files as well as the ranked source files', async () => {
    const { result, llm } = await extract([candidate()]);
    const call = llm.calls.find((c) => c.method === 'completeStructured');
    const prompt = JSON.stringify(call?.req);

    expect(prompt).toContain('tsconfig.json');
    expect(prompt).toContain('src/routes.ts');
    expect(result.response.scan?.sample_files).toBe(4);
  });

  it('drops a rule whose only support is a quote that is not in the file', async () => {
    const { result, saved } = await extract([
      candidate({
        evidence: [
          { path: 'src/routes.ts', line: 2, snippet: 'const user = await db.users.find(id);' },
          { path: 'src/service.ts', line: 2, snippet: 'const parsed = CreateSkill.parse(input);' },
        ],
      }),
    ]);

    expect(saved).toHaveLength(0);
    expect(result.audit).toMatchObject({ snippetNotFound: 1, tooLittleEvidence: 1, kept: 0 });
  });

  it('drops a rule that cites a file the scan never sampled', async () => {
    const { result } = await extract([
      candidate({
        evidence: [
          { path: 'src/secret.ts', line: 1, snippet: 'export const KEY = "sk_live";' },
          { path: 'src/other.ts', line: 1, snippet: 'export const OTHER = 2;' },
        ],
      }),
    ]);

    expect(result.audit).toMatchObject({ unsampledFile: 2, kept: 0 });
  });

  it('drops a rule Prettier already enforces before it checks its quotes', async () => {
    const { result } = await extract([
      candidate({ rule: 'Use single quotes for every string literal.' }),
    ]);

    expect(result.audit).toMatchObject({ machineEnforced: 1, kept: 0, snippetNotFound: 0 });
  });

  it('drops a rule a person already judged in an earlier scan', async () => {
    const { result } = await extract(
      [candidate()],
      ['handlers validate input with a zod schema and throw validationerror on failure'],
    );

    expect(result.audit).toMatchObject({ duplicate: 1, kept: 0 });
  });

  it('discounts confidence by the share of quotes that proved out', async () => {
    const { saved } = await extract([
      candidate({
        confidence: 1,
        evidence: [
          { path: 'src/routes.ts', line: 2, snippet: 'const parsed = ListQuery.parse(req.query);' },
          { path: 'src/service.ts', line: 2, snippet: 'const parsed = CreateSkill.parse(input);' },
          { path: 'src/routes.ts', line: 9, snippet: 'const nothing = like.this(at_all);' },
        ],
      }),
    ]);

    expect(saved[0]?.confidence).toBeCloseTo(2 / 3);
  });

  it('records the commit the evidence was read at', async () => {
    const { saved, scan } = await extract([candidate()]);
    expect(saved[0]?.headSha).toBe('a1b2c3d4');
    expect(scan()?.headSha).toBe('a1b2c3d4');
  });

  it('does not spend a sample slot on a barrel or a style object', async () => {
    const { result } = await extract([candidate()], [], {
      ranked: ['src/index.ts', 'src/ui/styles.ts', 'src/types.d.ts', 'src/routes.ts', 'src/service.ts'],
      files: {
        ...FILES,
        'src/index.ts': `export * from './routes.js';\n`.repeat(40),
        'src/ui/styles.ts': `export const s = { card: { padding: 14 } };\n`.repeat(40),
        'src/types.d.ts': `declare module 'x';\n`.repeat(40),
      },
    });

    expect(result.samples).toEqual(['src/routes.ts', 'src/service.ts']);
  });

  it('skips a file too small to hold a convention', async () => {
    const { result } = await extract([candidate()], [], {
      ranked: ['src/tiny.ts', 'src/routes.ts', 'src/service.ts'],
      files: { ...FILES, 'src/tiny.ts': 'export const NOW = () => Date.now();' },
    });

    expect(result.samples).not.toContain('src/tiny.ts');
  });

  it('refuses to scan a repo with nothing readable in it', async () => {
    const { repo } = fakeRepo();
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    const container = new Container(config, {} as Db, {
      llm: { openai: new MockLLMProvider('openai', { structuredBySchema: {} }) },
      git: new MockGitClient({ files: {} }),
      codeIndex: { grep: async () => [] } as unknown as Container['codeIndex'],
      repoIntel: { getConventionSamples: async () => [] } as unknown as Container['repoIntel'],
    });

    await expect(new ConventionsService(container, repo).extract('ws-1', 'repo-1')).rejects.toThrow(
      /clone/i,
    );
  });
});
