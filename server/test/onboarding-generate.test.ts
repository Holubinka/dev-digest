/**
 * P5 step 6 — **one call, and the object that comes out of it**.
 *
 * Hermetic: `MockGitClient` over a fake tree, a stub facade, a fake provider and
 * a tokenizer that counts characters. Nothing here reaches a network, a clone or
 * a database, and the executor writes nothing anywhere — every case that ends in
 * a throw checks the same thing twice, because "it threw" and "nothing was
 * stored" are one statement in this file rather than two that have to agree.
 *
 * What only this suite can see:
 *
 *  1. EXACTLY ONE `completeStructured` per run. D3 costs one call for five
 *     sections, and nothing else in the feature can tell one call from five.
 *  2. The four numbers of the call — `attempts`, `tokens_in`, `cost_usd`,
 *     `model` — are the provider's own, not recomputed on our side. A recomputed
 *     `attempts` would report a repair that was never spent.
 *  3. The budget walk drops in reverse priority order, records every input's
 *     status, and never lets what SHIPS exceed the named ceiling — the escape is
 *     applied where each block is built, so the walk measures the shipped form
 *     (`server/INSIGHTS.md`, "A budget measured before an escape is not a
 *     budget").
 *  4. A `ConfigError` crosses this seam unflattened. Slice B answers
 *     `config_error` from it, and a catch here would take that away.
 *
 * NEGATIVE CONTROLS, verified by hand on 2026-08-17 — each mutation applied to
 * `generate-executor.ts` alone, and each turned exactly the case named red:
 *  - drop the `probes >= MAX_PATH_PROBES` guard → "spends no more than
 *    MAX_PATH_PROBES reads on one answer";
 *  - report `attempts: 1` instead of `result.attempts` → "records the call's own
 *    numbers, not numbers of ours";
 *  - remove the `heuristic` warn → "warns when the count came from the
 *    heuristic, and still generates";
 *  - subtract only the system prompt from the budget → "never ships more than
 *    the named budget";
 *  - hand `truncateBlockToBudget`'s job back to the walk's own cut → "cuts a
 *    block that does not fit without cutting its fence".
 *
 * NEGATIVE CONTROLS for the four fields SPEC-04 added, run on 2026-08-18. Every
 * one of them carries an empty `.default()` in the contract, so a run that
 * simply never sets it produces a record that PARSES, reads as zero or as an
 * empty list, and fails no gate anywhere — which is why each is pinned by a case
 * that goes red on exactly that mutation rather than by a sentence in a
 * docstring:
 *  - `chains_supplied: 0, longest_chain_files: 0` → "records how many chains
 *    were offered…" and "offers the chains one at a time…" (2 of 31);
 *  - `omitted: [], shortened: []` in `inputRow` → "names the samples the budget
 *    refused…" and "offers the chains one at a time…" (2 of 31);
 *  - `const budget = 24_000` instead of `budgetForIndex(input.filesIndexed)` →
 *    5 of 31, the clock among them, because the clock is computed from it.
 */
import { describe, it, expect, vi } from 'vitest';
import { MockGitClient, MockPromptTemplates } from '../src/adapters/mocks.js';
import { ConfigError } from '../src/platform/errors.js';
import type {
  LLMProvider,
  ModelInfo,
  OnboardingTokenizer,
  RepoRef,
  StructuredRequest,
  StructuredResult,
} from '@devdigest/shared';
import { OnboardingGenerateExecutor } from '../src/modules/onboarding/generate-executor.js';
import type {
  OnboardingGenerationContainer,
  OnboardingRepoRef,
} from '../src/modules/onboarding/generation-types.js';
import type { OnboardingResponse } from '../src/modules/onboarding/prompt.js';
import { SECTION_SPEC, ONBOARDING_SCHEMA_NAME } from '../src/modules/onboarding/prompt.js';
import {
  MAX_DOC_CHARS,
  MAX_FILE_CHARS,
  MAX_FLOWS,
  MAX_PATH_PROBES,
  MAX_TASKS,
  ONBOARDING_MAX_RETRIES,
  PATH_PROBE_BYTES,
  SAMPLE_FILE_COUNT,
  TOUR_LANGUAGE,
} from '../src/modules/onboarding/constants.js';
import { budgetForIndex, timeoutForBudget } from '../src/modules/onboarding/sizing.js';
// A TEST may import both sides of the `no-cross-module` boundary; `src` may not.
// This is the `REPO_MAP_TOKEN_BUDGET` precedent, and the reason the assertion
// below exists at all.
import { CRITICAL_PATH_CHAINS } from '../src/modules/repo-intel/constants.js';

/* ------------------------------------------------------------------ fixture */

const REPO: OnboardingRepoRef = {
  id: 'repo-1',
  owner: 'acme',
  name: 'payments-api',
  fullName: 'acme/payments-api',
};

const WORKSPACE = 'ws-1';

/** Comfortably over `MIN_FILE_CHARS`, and a round number so budgets are easy. */
const FILE = 'export const handler = () => ({ ok: true });\n'.repeat(20);

const TREE: Record<string, string> = {
  'package.json': '{"name":"demo","scripts":{"dev":"next dev","test":"vitest"}}',
  'pnpm-lock.yaml': 'lockfileVersion: 9\n',
  'server/package.json': '{"name":"@demo/api","scripts":{"dev":"tsx watch","db:migrate":"drizzle"}}',
  'server/package-lock.json': '{"lockfileVersion":3}',
  '.env.example': 'DATABASE_URL=\nLOG_LEVEL=\n',
  'docker-compose.yml': 'services:\n  postgres:\n    image: postgres:16\n',
  'README.md': '# demo\n\nA repository used by this test.\n',
  'server/src/index.ts': FILE,
  'server/src/routes.ts': FILE,
  'server/src/service.ts': FILE,
};

const CHAINS = [['server/src/index.ts', 'server/src/routes.ts']];
const RANKED = ['server/src/index.ts', 'server/src/routes.ts', 'server/src/service.ts'];

function section(
  kind: string,
  overrides: Partial<OnboardingResponse['sections'][number]> = {},
): OnboardingResponse['sections'][number] {
  return {
    kind,
    title: `Заголовок ${kind}`,
    body: `Опис секції ${kind}, що згадує server/src/index.ts.`,
    diagram: null,
    links: [{ label: 'вхід', path: 'server/src/index.ts' }],
    ...overrides,
  };
}

/** A well-behaved answer: everything in it is true of the tree above. */
function answer(overrides: Partial<OnboardingResponse> = {}): OnboardingResponse {
  return {
    sections: [
      section('architecture', { diagram: 'flowchart LR\n  A["api"] --> B["db"]' }),
      section('critical_paths'),
      section('how_to_run'),
      section('reading_path'),
      section('first_tasks'),
    ],
    flows: [
      {
        title: 'Запит проходить систему',
        steps: [
          { path: 'server/src/index.ts', note: 'вхід' },
          { path: 'server/src/routes.ts', note: 'маршрути' },
        ],
      },
    ],
    reading_path: [
      { path: 'server/src/index.ts', reason: 'звідси стартує процес' },
      { path: 'server/src/service.ts', reason: 'тут логіка' },
    ],
    tasks: [
      {
        title: 'Додати перевірку входу',
        path: 'server/src/service.ts',
        why: 'мала зміна в одному файлі',
        complexity: 'low',
        steps: [
          { text: 'Відкрий сервіс', path: 'server/src/service.ts', command: null },
          { text: 'Запусти застосунок', path: null, command: 'pnpm dev' },
        ],
        impact: 'Один сервіс і його виклик у маршруті.',
        verification: 'Запит без поля повертає 400.',
      },
    ],
    run: [
      {
        package_path: '.',
        install_command: 'pnpm install',
        commands: [{ script: 'dev', command: 'pnpm dev', why: 'запускає застосунок' }],
      },
    ],
    setup_commands: [
      { command: 'cp .env.example .env', why: 'готує змінні', source_path: '.env.example' },
    ],
    env_vars: [{ name: 'DATABASE_URL', source_path: '.env.example' }],
    ...overrides,
  };
}

/* -------------------------------------------------------------------- fakes */

interface FakeLlmOptions {
  data?: OnboardingResponse;
  result?: Partial<StructuredResult<OnboardingResponse>>;
  throws?: Error;
  /** A call that never settles — the case only the outer clock can end. */
  hang?: boolean;
  /** Wall-clock the call takes, under fake timers. The only way to see `duration_ms`. */
  delayMs?: number;
}

class FakeLLM implements LLMProvider {
  readonly id = 'openrouter' as const;
  public calls: StructuredRequest<unknown>[] = [];

  constructor(private opts: FakeLlmOptions = {}) {}

  async listModels(): Promise<ModelInfo[]> {
    throw new Error('the generation must not list models');
  }
  async complete(): Promise<never> {
    throw new Error('the generation must use completeStructured');
  }
  async embed(): Promise<number[][]> {
    throw new Error('the generation must not embed');
  }
  async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    this.calls.push(req as StructuredRequest<unknown>);
    if (this.opts.hang) return new Promise<never>(() => {});
    if (this.opts.delayMs !== undefined) {
      const delay = this.opts.delayMs;
      await new Promise<void>((resolve) => setTimeout(resolve, delay));
    }
    if (this.opts.throws) throw this.opts.throws;
    return {
      data: (this.opts.data ?? answer()) as unknown as T,
      model: 'deepseek/deepseek-v4-flash',
      tokensIn: 4321,
      tokensOut: 1234,
      costUsd: 0.0042,
      raw: '{}',
      attempts: 1,
      ...this.opts.result,
    };
  }
}

class RecordingGit extends MockGitClient {
  public reads: { path: string; maxBytes: number }[] = [];

  async readFile(repo: RepoRef, path: string, maxBytes: number): Promise<string> {
    this.reads.push({ path, maxBytes });
    return super.readFile(repo, path, maxBytes);
  }
}

interface Options {
  tree?: Record<string, string>;
  repoMap?: string;
  chains?: string[][];
  ranked?: string[];
  llm?: FakeLlmOptions;
  llmThrows?: Error;
  tokenizerId?: OnboardingTokenizer;
  /**
   * `files_indexed`, the one number the budget and the clock are computed from.
   *
   * The default is 0, i.e. the FLOOR budget of 24 000 — the pair every
   * size-tuned case in this file was measured against, so raising it silently
   * would loosen those cases rather than strengthen them. Whatever cares about
   * the ramp passes its own count.
   */
  filesIndexed?: number;
}

function harness(opts: Options = {}) {
  const git = new RecordingGit({ tree: opts.tree ?? TREE });
  const llm = new FakeLLM(opts.llm ?? {});
  const prompts = new MockPromptTemplates({ 'onboarding.system.md': 'SYS {{sections}} {{language}}' });
  const renders: { name: string; vars: Record<string, string> }[] = [];
  const logs: { level: 'info' | 'warn'; obj: Record<string, unknown>; msg: string }[] = [];
  let llmCalls = 0;

  const container: OnboardingGenerationContainer = {
    git,
    prompts: {
      render: async (name, vars) => {
        renders.push({ name, vars });
        return prompts.render(name, vars);
      },
    },
    tokenizer: { count: (text) => text.length, id: opts.tokenizerId ?? 'cl100k_base' },
    settingsRepo: { value: async () => null },
    repoIntel: {
      getRepoMap: async () => ({ text: opts.repoMap ?? 'server/\n  src/\n    index.ts\n', tokens: 30 }),
      getCriticalPaths: async () => opts.chains ?? CHAINS,
      getTopFilesByRank: async () => opts.ranked ?? RANKED,
    },
    llm: async () => {
      llmCalls += 1;
      if (opts.llmThrows) throw opts.llmThrows;
      return llm;
    },
  };

  const log = {
    info: (obj: object, msg: string) =>
      logs.push({ level: 'info', obj: obj as Record<string, unknown>, msg }),
    warn: (obj: object, msg: string) =>
      logs.push({ level: 'warn', obj: obj as Record<string, unknown>, msg }),
  };

  const filesIndexed = opts.filesIndexed ?? 0;

  return {
    git,
    llm,
    logs,
    renders,
    filesIndexed,
    budget: budgetForIndex(filesIndexed),
    llmCallCount: () => llmCalls,
    run: () =>
      new OnboardingGenerateExecutor(container).run(
        { workspaceId: WORKSPACE, repo: REPO, filesIndexed },
        log,
      ),
  };
}

const userMessageOf = (llm: FakeLLM): string =>
  llm.calls[0]?.messages.find((message) => message.role === 'user')?.content ?? '';

/* -------------------------------------------------------------------- cases */

describe('the one call', () => {
  it('makes exactly one structured call for all five sections', async () => {
    const { run, llm } = harness();
    const { draft } = await run();

    expect(llm.calls).toHaveLength(1);
    const call = llm.calls[0];
    expect(call?.schemaName).toBe(ONBOARDING_SCHEMA_NAME);
    expect(call?.maxRetries).toBe(ONBOARDING_MAX_RETRIES);
    expect(call?.timeoutMs).toBe(timeoutForBudget(budgetForIndex(0)));
    expect(call?.temperature).toBe(0);
    expect(call?.reasoning).toBe(false);
    expect(call?.messages.map((message) => message.role)).toEqual(['system', 'user']);
    expect(draft.sections).toHaveLength(5);
  });

  it('renders the system prompt with the section list and the fixed language', async () => {
    const { run, renders } = harness();
    await run();

    expect(renders).toHaveLength(1);
    expect(renders[0]?.name).toBe('onboarding.system.md');
    expect(renders[0]?.vars).toEqual({ sections: SECTION_SPEC, language: TOUR_LANGUAGE });
  });

  it('records the call\'s own numbers, not numbers of ours', async () => {
    const { run } = harness({
      llm: { result: { attempts: 2, tokensIn: 9876, costUsd: 0.5, model: 'vendor/model-x' } },
    });
    const { draft } = await run();

    expect(draft.attempts).toBe(2);
    expect(draft.tokens_in).toBe(9876);
    expect(draft.cost_usd).toBe(0.5);
    expect(draft.model).toBe('vendor/model-x');
    expect(draft.provider).toBe('openrouter');
    // Ours, and a different measurement of a different thing: the assembled
    // input, counted before the call, against the ceiling it was fitted to.
    expect(draft.tokenizer).toBe('cl100k_base');
    expect(draft.budget).toBe(budgetForIndex(0));
    expect(draft.input_tokens_counted).toBeGreaterThan(0);
    expect(draft.input_tokens_counted).not.toBe(9876);
  });

  it('carries no stamp: the draft has neither generated_at nor index_state', async () => {
    const { run } = harness();
    const { draft } = await run();

    expect(Object.keys(draft)).not.toContain('generated_at');
    expect(Object.keys(draft)).not.toContain('index_state');
  });

  it('warns when the count came from the heuristic, and still generates', async () => {
    const { run, logs } = harness({ tokenizerId: 'heuristic' });
    const { draft } = await run();

    expect(draft.tokenizer).toBe('heuristic');
    const warn = logs.find((line) => line.level === 'warn');
    expect(warn?.msg).toMatch(/heuristic/i);
    expect(logs.some((line) => line.level === 'info')).toBe(true);
  });

  it('writes one log line carrying the audit of the generation', async () => {
    const { run, logs } = harness();
    const { audit } = await run();

    const info = logs.filter((line) => line.level === 'info');
    expect(info).toHaveLength(1);
    expect(info[0]?.obj).toMatchObject({ attempts: 1, probes: audit.probes });
  });
});

describe('what the answer is allowed to claim', () => {
  it('drops a task whose file is not in the clone, and counts it once', async () => {
    const data = answer({
      tasks: [
        {
          title: 'Полагодити те, чого немає',
          path: 'server/src/nope.ts',
          why: 'вигадка',
          complexity: 'low',
          steps: [],
          impact: '',
          verification: '',
        },
        {
          title: 'Додати перевірку входу',
          path: 'server/src/service.ts',
          why: 'мала зміна',
          complexity: 'low',
          steps: [],
          impact: '',
          verification: '',
        },
      ],
    });
    const { run } = harness({ llm: { data } });
    const { draft } = await run();

    expect(draft.tasks.map((task) => task.path)).toEqual(['server/src/service.ts']);
    expect(draft.dropped.unknown_path).toBe(1);
    expect(JSON.stringify(draft)).not.toContain('nope.ts');
  });

  it('a verbose task list cannot spend the probe budget, and the setup list survives', async () => {
    // The defect this pins: claims were collected from EVERY task while grounding
    // keeps at most MAX_TASKS, so a long answer reached the ceiling inside the
    // task loop — and `setup_commands`, collected after it, then failed
    // verification wholesale. The "run it once per clone" list vanished from the
    // page, and `unknown_path` was inflated by claims that were true.
    const claimed = MAX_PATH_PROBES + 10;
    const data = answer({
      tasks: Array.from({ length: claimed }, (_, index) => ({
        title: `Задача ${index}`,
        path: `server/src/ghost-${index}.ts`,
        why: 'вигадка',
        complexity: 'low' as const,
        steps: [],
        impact: '',
        verification: '',
      })),
    });
    const { run, git } = harness({ llm: { data } });
    const before = git.reads.length;
    const { draft, audit } = await run();
    const probes = git.reads
      .slice(before)
      .filter((read) => read.path.includes('ghost-') && read.maxBytes === PATH_PROBE_BYTES);

    // Only tasks that could be stored are probed at all.
    expect(probes).toHaveLength(MAX_TASKS);
    expect(audit.probes).toBeLessThan(MAX_PATH_PROBES);
    expect(draft.tasks).toHaveLength(0);
    // The counters still describe more than was kept — see the deferred finding
    // that they are computed before the caps — so this holds either way.
    expect(draft.dropped.unknown_path).toBeGreaterThanOrEqual(MAX_TASKS);
    expect(draft.setup_commands).toHaveLength(1);
  });

  it('never counts a real file missing because it fell outside the probe window', async () => {
    // `collectClaimedPaths` probes `tasks.slice(0, MAX_TASKS)`, and its docstring
    // states the two bounds are the SAME bound — that no claim it refuses to
    // probe is ever counted `unknown_path`. Grounding walked every task the model
    // returned and sliced only on the way out, so when early tasks failed the
    // complexity gate the walk reached tasks whose paths nobody had read: real
    // files, reported missing, and dropped for want of a probe.
    const extra: Record<string, string> = {};
    for (let i = 0; i < 8; i += 1) extra[`server/src/t${i}.ts`] = FILE;

    const data = answer({
      tasks: Array.from({ length: 8 }, (_, i) => ({
        title: `Задача ${i}`,
        path: `server/src/t${i}.ts`,
        why: 'справжній файл',
        // The first two fail the complexity gate, so the walk runs past the
        // sixth task looking for something to keep.
        complexity: (i < 2 ? 'epic' : 'low') as 'low',
        steps: [],
        impact: '',
        verification: '',
      })),
    });
    const { run } = harness({ tree: { ...TREE, ...extra }, llm: { data } });
    const { draft } = await run();

    expect(draft.dropped.unknown_complexity).toBe(2);
    // Every path the model named exists. None may be counted missing.
    expect(draft.dropped.unknown_path).toBe(0);
    expect(draft.tasks.map((t) => t.path)).toEqual([
      'server/src/t2.ts',
      'server/src/t3.ts',
      'server/src/t4.ts',
      'server/src/t5.ts',
    ]);
  });

  it('spends no more than MAX_PATH_PROBES reads on one answer', async () => {
    // Flows are not capped on the way in, so they are what can still reach the
    // ceiling now that tasks are sliced before they are probed.
    const claimed = MAX_PATH_PROBES + 10;
    const data = answer({
      flows: Array.from({ length: claimed }, (_, index) => ({
        title: `Потік ${index}`,
        steps: [{ path: `server/src/ghost-${index}.ts`, note: 'вигадка' }],
      })),
    });
    const { run, git } = harness({ llm: { data } });
    const before = git.reads.length;
    const { audit } = await run();
    const probes = git.reads
      .slice(before)
      .filter((read) => read.path.includes('ghost-') && read.maxBytes === PATH_PROBE_BYTES);

    expect(audit.probes).toBe(MAX_PATH_PROBES);
    expect(probes).toHaveLength(MAX_PATH_PROBES);
  });

  it('verifies a path the prose names that no list ever showed the model', async () => {
    const data = answer({
      sections: [
        section('architecture', {
          // `README.md` is read by the gather; `server/src/nowhere.ts` is not in
          // the clone at all. One becomes a verified path, the other stays prose.
          body: 'Огляд у README.md, а деталі в server/src/nowhere.ts.',
        }),
        section('critical_paths'),
        section('how_to_run'),
        section('reading_path'),
        section('first_tasks'),
      ],
    });
    const { run } = harness({ llm: { data } });
    const { draft } = await run();

    const architecture = draft.sections.find((entry) => entry.kind === 'architecture');
    expect(architecture?.verified_paths).toContain('README.md');
    expect(architecture?.verified_paths).not.toContain('server/src/nowhere.ts');
  });
});

describe('the budget', () => {
  it('counts what ships and reports every input as included when it all fits', async () => {
    const { run, llm } = harness();
    const { draft } = await run();

    // The row order IS the priority order, so the LAST row is always the one the
    // walk cuts first. `project_docs` moved above `file_samples` on 2026-08-18.
    expect(draft.inputs.map((input) => `${input.id}:${input.status}`)).toEqual([
      'repo_map:included',
      'package_configs:included',
      'critical_paths:included',
      'project_docs:included',
      'file_samples:included',
    ]);
    expect(draft.sample_files).toBe(RANKED.length);
    expect(draft.sample_truncated).toBe(false);
    expect(draft.inputs.find((input) => input.id === 'file_samples')?.detail).toBe('3 of 3 files');
    // The chains are offered one block per chain now, and collapse back into
    // the one row per id that `inputs[]` is.
    expect(draft.inputs.find((input) => input.id === 'critical_paths')?.detail).toBe(
      `${CHAINS.length} of ${CHAINS.length} chains`,
    );
    for (const input of draft.inputs) {
      expect(input.omitted).toEqual([]);
      expect(input.shortened).toEqual([]);
    }

    const user = userMessageOf(llm);
    for (const path of RANKED) expect(user).toContain(path);
  });

  it('drops in reverse priority order and says how many samples survived', async () => {
    // Big enough that the samples run out of room, small enough that the four
    // higher-priority inputs do not — and since 2026-08-18 the documents are one
    // of those four, so it is the samples that pay.
    const { run } = harness({ repoMap: 'x'.repeat(20_000) });
    const { draft } = await run();

    const status = Object.fromEntries(draft.inputs.map((input) => [input.id, input.status]));
    expect(status['repo_map']).toBe('included');
    expect(status['package_configs']).toBe('included');
    expect(status['critical_paths']).toBe('included');
    expect(status['project_docs']).toBe('included');
    expect(status['file_samples']).toBe('truncated');
    expect(draft.sample_files).toBeLessThan(RANKED.length);
    expect(draft.sample_truncated).toBe(true);
    expect(draft.inputs.find((input) => input.id === 'file_samples')?.detail).toBe(
      `${draft.sample_files} of ${RANKED.length} files`,
    );
  });

  it('never ships more than the computed budget', async () => {
    // At the ramp's top end, so the bound being tested is the one this run was
    // given rather than the floor that used to be the only number there was.
    const { run, llm, budget } = harness({ repoMap: 'x'.repeat(80_000), filesIndexed: 2_000 });
    const { draft } = await run();

    const system = llm.calls[0]?.messages.find((message) => message.role === 'system')?.content ?? '';
    expect(budget).toBe(50_000);
    expect(system.length + userMessageOf(llm).length).toBeLessThanOrEqual(budget);
    expect(draft.input_tokens_counted).toBe(system.length + userMessageOf(llm).length);
    expect(draft.input_tokens_counted).toBeLessThanOrEqual(draft.budget);
    expect(draft.budget).toBe(budget);
  });

  it('cuts a block that does not fit without cutting its fence', async () => {
    const { run, llm } = harness({ repoMap: 'x'.repeat(80_000) });
    const { draft } = await run();

    const user = userMessageOf(llm);
    const opened = user.match(/<untrusted source="/g) ?? [];
    const closed = user.match(/\n<\/untrusted>/g) ?? [];
    expect(opened.length).toBeGreaterThan(0);
    expect(closed).toHaveLength(opened.length);
    expect(draft.inputs[0]).toMatchObject({ id: 'repo_map', status: 'truncated' });
  });

  it('offers the documents one at a time, so a big README does not take the rest', async () => {
    // Four documents, the second far bigger than the room left after the samples.
    // As ONE block all four would be dropped together; split, the walk keeps
    // what fits and stops.
    const { run, llm } = harness({
      tree: {
        ...TREE,
        'AGENTS.md': '# rules\n',
        'client/package.json': '{"name":"@demo/web"}',
        'client/README.md': `# web\n${'w'.repeat(MAX_DOC_CHARS)}`,
        'server/README.md': '# api\n\nThe API map lives here.\n',
      },
      // Big enough that the documents run out of room part-way through. It has to
      // squeeze harder than it once did: the documents no longer sit behind the
      // samples, so only the skeleton can crowd them now.
      repoMap: 'x'.repeat(21_000),
    });
    const { draft } = await run();

    const docs = draft.inputs.find((input) => input.id === 'project_docs');
    expect(docs?.status).toBe('truncated');
    expect(docs?.detail).toMatch(/^[1-3] of 4 documents/);

    // The root pair leads, so what survives is what the repository says about
    // itself — never an arbitrary package's README.
    const user = userMessageOf(llm);
    expect(user).toContain('<untrusted source="README.md">');
    expect(user).toContain('<untrusted source="AGENTS.md">');
    expect(user).not.toContain('<untrusted source="client/README.md">');
  });

  it('says in the same sentence how many documents fit and how many the ceiling cut', async () => {
    const { run } = harness({
      tree: {
        ...TREE,
        'README.md': `# demo\n${'r'.repeat(MAX_DOC_CHARS)}`,
        'server/README.md': '# api\n\nShort enough to arrive whole.\n',
      },
    });
    const { draft } = await run();

    // `MAX_DOC_CHARS` is otherwise invisible: the block holds the capped text, so
    // "it was cut" is not decidable from the record without this number.
    expect(draft.inputs.find((input) => input.id === 'project_docs')?.detail).toBe(
      '2 of 2 documents, 1 shortened',
    );
  });

  it('says nothing about shortening when the ceiling touched nothing', async () => {
    const { run } = harness({
      tree: { ...TREE, 'server/README.md': '# api\n' },
    });
    const { draft } = await run();

    expect(draft.inputs.find((input) => input.id === 'project_docs')?.detail).toBe(
      '2 of 2 documents',
    );
    // The samples' sentence is unchanged by the shared counter.
    expect(draft.inputs.find((input) => input.id === 'file_samples')?.detail).toBe(
      `${RANKED.length} of ${RANKED.length} files`,
    );
  });

  it('keeps the documents when there are more samples than the budget holds', async () => {
    // The case the priority reversal exists for. Before it, twenty samples took
    // 17 964 of ~22 000 block tokens on a real clone and every document was
    // dropped whole — the tour described a repository whose README it never read.
    const many = Array.from({ length: 12 }, (_, index) => `server/src/f${index}.ts`);
    const tree: Record<string, string> = {
      ...TREE,
      'server/README.md': '# api\n\nThe API map lives here.\n',
    };
    for (const path of many) tree[path] = 'export const handler = () => 1;\n'.repeat(75);

    const { run, llm } = harness({ tree, ranked: many });
    const { draft } = await run();

    const status = Object.fromEntries(draft.inputs.map((input) => [input.id, input.status]));
    expect(status['project_docs']).toBe('included');
    expect(status['file_samples']).toBe('truncated');
    expect(draft.sample_files).toBeLessThan(many.length);

    // Both documents are fenced into what actually shipped, not merely gathered.
    const user = userMessageOf(llm);
    expect(user).toContain('<untrusted source="README.md">');
    expect(user).toContain('<untrusted source="server/README.md">');
    // And the samples degrade by losing their TAIL rather than all at once,
    // which is what being split per item buys them.
    expect(draft.sample_files).toBeGreaterThan(0);
  });

  /**
   * AC-24. As ONE block, a supply of twenty chains is all-or-nothing: the walk
   * has a single cut point, so the block that does not fit is dropped whole and
   * takes every input behind it with it. Split, the walk keeps what fits, and
   * the record names the rest.
   */
  it('offers the chains one at a time, and names the ones that did not fit', async () => {
    const chains = Array.from({ length: 20 }, (_, index) =>
      Array.from({ length: 5 }, (_, step) => `server/src/${'d'.repeat(390)}-${index}-${step}.ts`),
    );
    const { run } = harness({ chains });
    const { draft } = await run();

    // Still exactly five rows, in `OnboardingInputId` order, out of 20 blocks.
    expect(draft.inputs.map((input) => input.id)).toEqual([
      'repo_map',
      'package_configs',
      'critical_paths',
      'project_docs',
      'file_samples',
    ]);

    const row = draft.inputs.find((input) => input.id === 'critical_paths');
    const sent = Number(/^(\d+) of 20 chains$/.exec(row?.detail ?? '')?.[1]);
    expect(sent).toBeGreaterThan(0);
    expect(sent).toBeLessThan(20);
    expect(row?.status).toBe('truncated');
    expect(row?.omitted).toHaveLength(20 - sent);
    // The tail is what is refused, never the head: `chain-1` is the highest
    // ranked root the supply found.
    expect(row?.omitted).toContain('chain-20');
    expect(row?.omitted).not.toContain('chain-1');
    expect(row?.shortened).toEqual([]);
    // And the count on the draft is the SUPPLY, not what survived the walk.
    expect(draft.chains_supplied).toBe(20);
  });

  it('names the samples the budget refused and the documents the ceiling cut', async () => {
    const { run } = harness({
      tree: {
        ...TREE,
        'README.md': `# demo\n${'r'.repeat(MAX_DOC_CHARS)}`,
        'server/README.md': '# api\n\nShort enough to arrive whole.\n',
      },
      // Enough to take the tail of the samples and nothing above them.
      repoMap: 'x'.repeat(16_000),
    });
    const { draft } = await run();

    const samples = draft.inputs.find((input) => input.id === 'file_samples');
    expect(samples?.status).toBe('truncated');
    expect(samples?.omitted.length).toBeGreaterThan(0);
    // By PATH, so a reader of the record knows which file the tour never saw.
    for (const path of samples?.omitted ?? []) expect(RANKED).toContain(path);
    expect(samples?.omitted).toContain(RANKED[RANKED.length - 1]);
    expect(samples?.shortened).toEqual([]);

    const docs = draft.inputs.find((input) => input.id === 'project_docs');
    // The ceiling cut this one before it was fenced — it DID ship, with its tail
    // gone, which is a different absence from never having been sent.
    expect(docs?.shortened).toEqual(['README.md']);

    // An input offered whole has neither list: it is included or dropped in one
    // piece, and there is nothing inside it to name.
    const repoMap = draft.inputs.find((input) => input.id === 'repo_map');
    expect(repoMap?.omitted).toEqual([]);
    expect(repoMap?.shortened).toEqual([]);
  });

  it('reports an input that had nothing to say as missing, not dropped', async () => {
    const { run } = harness({ chains: [] });
    const { draft } = await run();

    expect(draft.inputs.find((input) => input.id === 'critical_paths')).toMatchObject({
      status: 'missing',
      tokens: 0,
    });
  });
});

describe('when the call does not come back', () => {
  it('lets a ConfigError out unflattened, and returns nothing', async () => {
    const boom = new ConfigError('OPENROUTER_API_KEY is not configured');
    const { run, llm } = harness({ llmThrows: boom });

    await expect(run()).rejects.toBeInstanceOf(ConfigError);
    expect(llm.calls).toHaveLength(0);
  });

  it('throws when the repair runs out, and returns nothing', async () => {
    const { run, llm } = harness({ llm: { throws: new Error('schema repair exhausted') } });

    await expect(run()).rejects.toThrow(/repair/i);
    expect(llm.calls).toHaveLength(1);
  });

  it('is bounded by the clock its budget bought, and says so before it throws', async () => {
    vi.useFakeTimers();
    try {
      // 656 files, so the clock under test is the COMPUTED 219 360 ms rather
      // than the floor: a run that missed a 180 000 ms bound at this size would
      // be a bug in the ramp, not a slow provider.
      const { run, llm, logs, budget } = harness({ llm: { hang: true }, filesIndexed: 656 });
      const clock = timeoutForBudget(budget);
      const pending = run();
      const settled = pending.then(
        () => 'resolved',
        (err: Error) => err.message,
      );

      await vi.advanceTimersByTimeAsync(0);
      expect(llm.calls).toHaveLength(1);
      expect(llm.calls[0]?.timeoutMs).toBe(clock);
      // Still running one millisecond before its own deadline.
      await vi.advanceTimersByTimeAsync(clock - 1);
      expect(logs.some((line) => line.level === 'warn')).toBe(false);
      await vi.advanceTimersByTimeAsync(2);

      expect(await settled).toMatch(/timed out/i);

      // The ONLY record a timed-out generation leaves: no row is written, so
      // the two numbers that say whether the clock was the wrong size have to
      // be on this line (AC-65).
      const warn = logs.find((line) => line.level === 'warn');
      expect(warn?.msg).toMatch(/missed its clock/);
      expect(warn?.obj).toMatchObject({
        repoId: REPO.id,
        budget,
        filesIndexed: 656,
        timeoutMs: clock,
      });
      expect(warn?.obj.durationMs).toBeGreaterThanOrEqual(clock);
      // And nothing was produced: "it threw" and "nothing was stored" are one
      // statement here.
      expect(logs.some((line) => line.level === 'info')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('the size of the repository decides the size of the call', () => {
  it('computes the budget and the clock from files_indexed, and records both', async () => {
    // 656 is this repository's own `files_indexed`, and 32 528 / 219 360 is the
    // pair SPEC-04 § D11 (as amended by § D22) and § D12 derive for it.
    const { run, llm } = harness({ filesIndexed: 656 });
    const { draft } = await run();

    expect(draft.budget).toBe(32_528);
    expect(llm.calls[0]?.timeoutMs).toBe(219_360);
    expect(draft.budget).toBe(budgetForIndex(656));
  });

  it('gives a repository twice the size more room and more time', async () => {
    const small = await harness({ filesIndexed: 100 }).run();
    const large = await harness({ filesIndexed: 1_200 }).run();

    expect(large.draft.budget).toBeGreaterThan(small.draft.budget);
    expect(timeoutForBudget(large.draft.budget)).toBeGreaterThan(
      timeoutForBudget(small.draft.budget),
    );
  });

  it('counts the system prompt apart from the blocks', async () => {
    const { run, llm } = harness();
    const { draft } = await run();

    const system = llm.calls[0]?.messages.find((message) => message.role === 'system')?.content ?? '';
    // Only one of the two numbers moves when the budget walk drops a block;
    // summed together they would hide which one grew.
    expect(draft.system_tokens).toBe(system.length);
    expect(draft.system_tokens).toBeLessThan(draft.input_tokens_counted);
  });

  it('measures the call itself, not the gather around it', async () => {
    vi.useFakeTimers();
    try {
      const { run } = harness({ llm: { delayMs: 4_321 } });
      const pending = run();
      await vi.advanceTimersByTimeAsync(4_321);
      const { draft } = await pending;

      expect(draft.duration_ms).toBe(4_321);
    } finally {
      vi.useRealTimers();
    }
  });

  it('records how many chains were offered and how far the longest one reached', async () => {
    const chains = [
      ['server/src/index.ts', 'server/src/routes.ts'],
      ['server/src/index.ts', 'server/src/routes.ts', 'server/src/service.ts'],
      ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts'],
    ];
    const { run } = harness({ chains });
    const { draft } = await run();

    // The SUPPLY, not the answer: a thin critical-paths section is read against
    // what the model was given, and both numbers default to 0 in the contract —
    // so a run that forgot to set them would look exactly like a repository
    // with no import graph.
    expect(draft.chains_supplied).toBe(3);
    expect(draft.longest_chain_files).toBe(5);
  });

  it('reports no supply at all as zero rather than as one empty chain', async () => {
    const { run } = harness({ chains: [] });
    const { draft } = await run();

    expect(draft.chains_supplied).toBe(0);
    expect(draft.longest_chain_files).toBe(0);
  });

  /**
   * The two numbers that may not be imported into each other's module —
   * `no-cross-module` follows `import type` as well — and are therefore held
   * here, the way `test/onboarding-gather.test.ts` holds `REPO_MAP_TOKEN_BUDGET`.
   *
   * The direction is the criterion (AC-22): the display ceiling may never sit
   * BELOW the supply, or a flow that passed every membership test is discarded
   * with no counter to say so.
   */
  it('never displays fewer flows than the chains it was supplied', () => {
    expect(MAX_FLOWS).toBeGreaterThanOrEqual(CRITICAL_PATH_CHAINS);
  });

  /**
   * R37 / AC-67. A bigger budget buys more of what was already selected and
   * never a wider selection: the gather reads the same files at the same caps
   * whatever the budget is, and only the walk downstream of it moves.
   */
  it('raises no selection ceiling: the same reads at both ends of the ramp', async () => {
    const floor = harness({ filesIndexed: 0 });
    const ceiling = harness({ filesIndexed: 2_000 });
    const small = await floor.run();
    const large = await ceiling.run();

    expect(large.draft.budget).toBeGreaterThan(small.draft.budget);
    expect(ceiling.git.reads).toEqual(floor.git.reads);
    expect([SAMPLE_FILE_COUNT, MAX_FILE_CHARS, MAX_DOC_CHARS]).toEqual([20, 6_000, 4_000]);
  });
});
