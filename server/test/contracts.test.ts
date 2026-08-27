import { describe, it, expect } from 'vitest';
import {
  Review,
  Finding,
  Intent,
  BlastRadius,
  Risks,
  PrHistory,
  SmartDiff,
  Conformance,
  Onboarding,
  OnboardingDraft,
  OnboardingSectionKind,
  EvalRun,
  MemoryItem,
  RunTrace,
  Settings,
  Repo,
  PrDetail,
  RiskBrief,
  RiskBriefRecord,
  RiskBriefTimeline,
  ReviewRecord,
  AgentColumn,
  AgentColumnFinding,
  AgentColumnStatus,
  ConflictTake,
  Conflict,
  MultiAgentRun,
  MultiAgentRunRequest,
  MultiAgentRunRef,
  LastSuccessfulRun,
  RunRequest,
  MAX_AGENTS_PER_MULTI_RUN,
} from '@devdigest/shared';
import { MAX_ENV_VARS } from '../src/modules/onboarding/constants.js';

/**
 * Contract tests — parse/round-trip the fixtures from data.jsx/data2.jsx
 * so feature agents can rely on the schemas matching the prototype data.
 */
describe('AI contracts parse fixtures', () => {
  it('Review + Finding (data.jsx VERDICT/FINDINGS)', () => {
    const review = Review.parse({
      verdict: 'request_changes',
      summary: 'Two blockers before merge.',
      score: 61,
      findings: [
        {
          id: 'f1',
          severity: 'CRITICAL',
          category: 'security',
          title: 'Hardcoded Stripe secret key in commit',
          file: 'src/config.ts',
          start_line: 12,
          end_line: 12,
          rationale: 'Line 12 contains a literal `sk_live_` Stripe key.',
          suggestion: 'Move to env and rotate.',
          confidence: 0.98,
          kind: 'secret_leak',
        },
      ],
    });
    expect(review.findings).toHaveLength(1);
    expect(review.score).toBe(61);
  });

  it('lethal-trifecta Finding variant', () => {
    const f = Finding.parse({
      id: 'f2',
      severity: 'CRITICAL',
      category: 'security',
      title: 'Lethal trifecta',
      file: 'src/api/public/webhooks.ts',
      start_line: 61,
      end_line: 74,
      rationale: 'all three legs present',
      confidence: 0.79,
      kind: 'lethal_trifecta',
      trifecta_components: ['private_data_access', 'untrusted_input', 'exfil_path'],
      evidence: [{ component: 'untrusted_input', file: 'src/api/public/webhooks.ts', line: 61 }],
    });
    expect(f.trifecta_components).toContain('exfil_path');
  });

  it('Intent / BlastRadius / Risks / PrHistory', () => {
    expect(() =>
      Intent.parse({ intent: 'x', in_scope: ['a'], out_of_scope: ['b'], risk_areas: ['auth'] }),
    ).not.toThrow();
    // risk_areas is REQUIRED, not optional: it is a field of the strict schema
    // handed to the model, and putting a field in that schema is how you get
    // the model to fill it in.
    expect(() =>
      Intent.parse({ intent: 'x', in_scope: ['a'], out_of_scope: ['b'] }),
    ).toThrow();
    expect(() =>
      BlastRadius.parse({
        changed_symbols: [{ name: 'rateLimit', file: 'a.ts', kind: 'function' }],
        downstream: [
          {
            symbol: 'rateLimit',
            callers: [{ name: 'publicRouter', file: 'b.ts', line: 23 }],
            endpoints_affected: ['GET /x'],
            crons_affected: ['c'],
          },
        ],
        summary: 's',
      }),
    ).not.toThrow();
    expect(() =>
      Risks.parse({
        risks: [{ kind: 'security', title: 't', explanation: 'e', severity: 'high', file_refs: [] }],
      }),
    ).not.toThrow();
    expect(() =>
      PrHistory.parse({
        history: [
          {
            pr_number: 401,
            title: 't',
            merged_at: '2026-03-18',
            author: 'a',
            files_overlap: [],
            notes: 'n',
          },
        ],
      }),
    ).not.toThrow();
  });

  it('SmartDiff (data.jsx DIFF)', () => {
    const d = SmartDiff.parse({
      groups: [
        {
          role: 'core',
          files: [{ path: 'a.ts', additions: 84, deletions: 0, finding_lines: [28, 52] }],
        },
      ],
      split_suggestion: { too_big: false, total_lines: 285, proposed_splits: [] },
    });
    expect(d.groups[0]!.role).toBe('core');
  });

  // Onboarding moved to its own block below: it is no longer a one-line fixture.
  it('Conformance / EvalRun / MemoryItem', () => {
    expect(() =>
      Conformance.parse({
        spec_id: 's1',
        spec_title: 'Spec',
        items: [{ requirement: 'r', status: 'implemented' }],
        completeness_pct: 80,
      }),
    ).not.toThrow();
    expect(() =>
      EvalRun.parse({
        recall: 0.82,
        precision: 0.91,
        citation_accuracy: 0.95,
        traces_passed: 17,
        traces_total: 20,
        duration_ms: 12000,
        cost_usd: 0.23,
        per_trace: [{ name: 't01', pass: true, expected: 'x', actual: 'x' }],
      }),
    ).not.toThrow();
    expect(() =>
      MemoryItem.parse({
        content: 'c',
        scope: 'team',
        kind: 'decision',
        confidence: 0.92,
        sources: [{ pr: 401, context: 'ctx' }],
      }),
    ).not.toThrow();
  });

  it('RunTrace (data2.jsx TRACE single-document)', () => {
    const trace = RunTrace.parse({
      config: { agent: 'Security Reviewer', version: 'v7', model: 'gpt-4.1', pr: 482, source: 'local' },
      stats: { duration_ms: 8200, tokens_in: 14820, tokens_out: 1240, cost_usd: 0.06, findings: 3, grounding: '3/3 passed' },
      prompt_assembly: { system: 's', user: 'u' },
      tool_calls: [{ tool: 'read_file', args: "'src/config.ts'", meta: '1,240 bytes', ms: 120 }],
      raw_output: '{}',
      memory_pulled: [{ pr: 288, text: 'verified via stripe-signature' }],
      specs_read: ['specs/security-baseline.md'],
      log: [{ t: '00.00', kind: 'info', msg: 'started' }],
    });
    expect(trace.tool_calls).toHaveLength(1);
  });

  /**
   * `run_traces` is parsed on read, so every key the contract requires must
   * exist in every document ever persisted. Two do not: `project_context` post-
   * dates most rows, and `cost_usd` was removed by `d45ab0d` (2026-06-14) and
   * restored by `5e92756` (2026-07-28). Both are defaulted; drop either default
   * and `GET /runs/:id/trace` 500s on a historical document.
   */
  it('RunTrace parses a document from an older contract generation', () => {
    const legacy = RunTrace.parse({
      config: { agent: 'a', model: 'm' },
      stats: { duration_ms: 1, tokens_in: 1, tokens_out: 1, findings: 0, grounding: '0/0 passed' },
      prompt_assembly: { system: 's', user: 'u' },
      tool_calls: [],
      raw_output: '',
      memory_pulled: [],
      specs_read: [],
      log: [],
    });
    expect(legacy.stats.cost_usd).toBeNull();
    expect(legacy.project_context).toEqual([]);
  });
});

/**
 * Onboarding Tour (12) — what one generation produces, before anything persists it.
 *
 * The enums are what stop the model's free string from reaching the page as a
 * section the layout has no branch for, or as a complexity badge that is
 * `Medium` on one generation and `medium` on the next. The closed lists are
 * REJECTED against, never normalised, so each negative case below is a claim
 * about one item being dropped rather than about the shape being repaired.
 */
describe('Onboarding tour contracts', () => {
  const draft = {
    sections: [
      {
        kind: 'architecture',
        title: 'Архітектура',
        body: 'Сервер на Fastify у `server/src`, клієнт у `client/src`.',
        diagram: 'graph TD;\n  client --> server;',
        links: [{ label: 'Композиційний корінь', path: 'server/src/platform/container.ts' }],
        verified_paths: ['server/src/platform/container.ts'],
        state: 'ready',
        empty_reason: null,
      },
      {
        kind: 'critical_paths',
        title: 'Критичні шляхи',
        body: 'Імпорт PR починається в `server/src/modules/pulls/routes.ts`.',
        links: [],
        verified_paths: ['server/src/modules/pulls/routes.ts'],
        state: 'ready',
        empty_reason: null,
      },
      {
        kind: 'how_to_run',
        title: 'Як запустити',
        body: 'Кожен пакет має власний менеджер.',
        links: [],
        verified_paths: [],
        state: 'ready',
        empty_reason: null,
      },
      {
        kind: 'reading_path',
        title: 'Порядок читання',
        body: 'Почни з композиційного кореня.',
        links: [],
        verified_paths: [],
        state: 'ready',
        empty_reason: null,
      },
      {
        kind: 'first_tasks',
        title: 'Перші задачі',
        body: '',
        links: [],
        verified_paths: [],
        state: 'empty',
        empty_reason: 'no_tasks',
      },
    ],
    flows: [
      {
        title: 'Імпорт pull request',
        steps: [
          { path: 'server/src/modules/pulls/routes.ts', note: 'Приймає номер PR.' },
          { path: 'server/src/modules/pulls/service.ts', note: 'Тягне метадані.' },
        ],
      },
    ],
    reading_path: [
      { path: 'server/src/platform/container.ts', reason: 'Тут будується весь граф.' },
    ],
    tasks: [
      {
        title: 'Додати лічильник до аудиту',
        path: 'server/src/modules/onboarding/constants.ts',
        why: 'Стелі стартові й переглядаються з чисел.',
        complexity: 'medium',
        steps: [
          {
            text: 'Додай константу поруч із рештою стель.',
            path: 'server/src/modules/onboarding/constants.ts',
            command: null,
          },
          // A step that names neither: `null` twice, and the step is still a
          // step. This is the shape a grounded answer most often has.
          { text: 'Перевір, що лічильник видно в аудиті.', path: null, command: null },
          {
            text: 'Прожени юніт-тести пакета.',
            path: null,
            command: 'pnpm db:migrate',
          },
        ],
        impact: 'Аудит генерації та тест, що читає ті самі ключі.',
        verification: 'Новий ключ видно у відповіді GET /repos/:id/onboarding.',
      },
    ],
    // Repo-level preconditions, each authorised by a file of this repository:
    // `cp` by the `.env.example` it reads from, `docker compose` by the file that
    // declares the service it starts. Neither is expressible as a package script,
    // which is why they are not in a package block.
    setup_commands: [
      {
        command: 'cp server/.env.example server/.env',
        why: 'Сервер читає конфіг із власного .env.',
        source_path: 'server/.env.example',
      },
      {
        command: 'docker compose up -d postgres',
        why: 'У Docker живе лише Postgres; API і веб — на хості.',
        source_path: 'docker-compose.yml',
      },
    ],
    packages: [
      {
        name: '@devdigest/api',
        path: 'server',
        manager: 'pnpm',
        install_command: 'pnpm install',
        commands: [
          { script: 'db:migrate', command: 'pnpm db:migrate', why: 'Міграції не йдуть на старті.' },
        ],
      },
      // A package whose lock files name no single manager: the block stays, the
      // commands do not. `null` is the answer, not a default to `npm`.
      { name: 'legacy', path: 'legacy', manager: null, install_command: null, commands: [] },
    ],
    env_vars: [{ name: 'DATABASE_URL', source_path: 'server/.env.example' }],
    env_vars_truncated: false,
    package_scan: {
      depth: 2,
      excluded_dirs: ['node_modules', 'dist', 'vendor'],
      found: 6,
      shown: 6,
      bounded: false,
    },
    inputs: [
      { id: 'repo_map', status: 'included', tokens: 5_200, detail: null, omitted: [], shortened: [] },
      {
        id: 'file_samples',
        status: 'truncated',
        tokens: 12_400,
        detail: '20 files',
        // `detail` counts what arrived; this names what did not.
        omitted: ['client/src/lib/api.ts'],
        shortened: [],
      },
      // Nothing of a dropped input shipped, so neither array can name anything:
      // `omitted` is about the items of an input that partly arrived.
      { id: 'project_docs', status: 'dropped', tokens: 0, detail: 'over budget', omitted: [], shortened: [] },
    ],
    dropped: {
      unknown_path: 2,
      unknown_script: 1,
      manager_mismatch: 1,
      unknown_complexity: 1,
      unknown_section: 1,
    },
    sample_files: 20,
    sample_truncated: true,
    chains_supplied: 20,
    longest_chain_files: 5,
    budget: 32_528,
    input_tokens_counted: 21_840,
    system_tokens: 1_180,
    tokenizer: 'cl100k_base',
    attempts: 2,
    tokens_in: 22_110,
    duration_ms: 104_216,
    provider: 'openrouter',
    model: 'deepseek/deepseek-v4-flash',
    cost_usd: 0.004,
  };

  it('OnboardingDraft round-trips one generation', () => {
    const parsed = OnboardingDraft.parse(draft);
    expect(parsed.sections.map((s) => s.kind)).toEqual(OnboardingSectionKind.options);
    expect(parsed.dropped.unknown_section).toBe(1);
    expect(parsed.package_scan.found).toBe(6);
    expect(parsed.packages[1]!.manager).toBeNull();
    expect(parsed.setup_commands.map((c) => c.source_path)).toEqual([
      'server/.env.example',
      'docker-compose.yml',
    ]);
    expect(parsed.tokenizer).toBe('cl100k_base');
    expect(parsed.attempts).toBe(2);
    expect(parsed.cost_usd).toBe(0.004);
    // SPEC-04's four: what was supplied, what the prompt cost on its own, and
    // how long the one call took. `budget` is now computed per index rather
    // than constant, which is why it is no longer 24 000 here.
    expect(parsed.chains_supplied).toBe(20);
    expect(parsed.longest_chain_files).toBe(5);
    expect(parsed.system_tokens).toBe(1_180);
    expect(parsed.duration_ms).toBe(104_216);
    expect(parsed.budget).toBe(32_528);
  });

  /**
   * A task is what the window draws, and R5 says it draws nothing that is not in
   * this contract. So the shape is asserted rather than assumed: three steps,
   * each with both keys present, and `null` — not absence — for the step that
   * names no file and no command.
   */
  it('a task carries its steps, impact and verification, and a step names null rather than nothing', () => {
    const parsed = OnboardingDraft.parse(draft);
    const task = parsed.tasks[0]!;
    expect(task.steps).toHaveLength(3);
    expect(task.steps[0]!.path).toBe('server/src/modules/onboarding/constants.ts');
    expect(task.steps[0]!.command).toBeNull();
    expect(task.steps[1]).toEqual({
      text: 'Перевір, що лічильник видно в аудиті.',
      path: null,
      command: null,
    });
    expect(task.steps[2]!.command).toBe('pnpm db:migrate');
    expect(task.impact).toBe('Аудит генерації та тест, що читає ті самі ключі.');
    expect(task.verification).toBe('Новий ключ видно у відповіді GET /repos/:id/onboarding.');

    // A step key that is present-and-null is not the same claim as an absent
    // one, and only the first parses: `.nullable()`, never `.optional()`.
    const { path: _absent, ...noPathKey } = task.steps[1]!;
    expect(() =>
      OnboardingDraft.parse({ ...draft, tasks: [{ ...draft.tasks[0]!, steps: [noPathKey] }] }),
    ).toThrow();
  });

  /**
   * `omitted` and `shortened` are the record's answer to "why is this section
   * thin": one names the items of a per-item input that did not ship, the other
   * the documents that shipped with their tail cut. A document can be in both —
   * cut and then dropped is not a state, but cut while another was dropped is.
   */
  it('an input row names what did not ship and what arrived shortened', () => {
    const parsed = OnboardingDraft.parse(draft);
    expect(parsed.inputs[1]!.omitted).toEqual(['client/src/lib/api.ts']);
    expect(parsed.inputs[1]!.shortened).toEqual([]);

    const withCutDoc = OnboardingDraft.parse({
      ...draft,
      inputs: [
        {
          id: 'project_docs',
          status: 'truncated',
          tokens: 6_100,
          detail: '6 of 7 documents',
          omitted: ['e2e/README.md'],
          shortened: ['README.md'],
        },
      ],
    });
    expect(withCutDoc.inputs[0]!.shortened).toEqual(['README.md']);
    expect(withCutDoc.inputs[0]!.omitted).toEqual(['e2e/README.md']);
  });

  /**
   * `.optional()` and `.nullable()` are different claims — absent versus
   * present-and-null — and R30 turns on the first. A section with no diagram has
   * the KEY MISSING, so a renderer may ask `'diagram' in section` and get a
   * truthful answer; `""` would render as a broken frame instead of no frame.
   */
  it('diagram is absent on a section without one, never an empty string', () => {
    const parsed = OnboardingDraft.parse(draft);
    expect(parsed.sections[0]!.diagram).toBe('graph TD;\n  client --> server;');
    expect('diagram' in parsed.sections[1]!).toBe(false);
    expect(parsed.sections[4]!.state).toBe('empty');
    expect(parsed.sections[4]!.empty_reason).toBe('no_tasks');
    // `empty_reason` is nullable, not optional: the key is present on a ready
    // section too, holding null. Omitting it is not the same claim.
    const { empty_reason: _dropped, ...noReason } = draft.sections[0]!;
    expect(() =>
      OnboardingDraft.parse({ ...draft, sections: [noReason, ...draft.sections.slice(1)] }),
    ).toThrow();
  });

  /**
   * Both rejected kinds are LITERALS FROM THIS REPOSITORY, not invented examples:
   * `routes_and_apis` is named twice in `server/src/prompts/onboarding.system.md`,
   * and `gotchas` comes from `client/messages/en/onboarding.json:10` ("conventions
   * & gotchas"). Both are scaffolding written before the feature was ordered, and
   * both are exactly what a sixth section would arrive wearing.
   */
  it('a section kind from the repo scaffolding — routes_and_apis, gotchas — is rejected', () => {
    for (const kind of ['routes_and_apis', 'gotchas']) {
      expect(() =>
        OnboardingDraft.parse({
          ...draft,
          sections: [{ ...draft.sections[0]!, kind }, ...draft.sections.slice(1)],
        }),
      ).toThrow();
    }
  });

  it('a fourth complexity, a fifth manager and a fractional counter are rejected', () => {
    expect(() =>
      OnboardingDraft.parse({
        ...draft,
        tasks: [{ ...draft.tasks[0]!, complexity: 'trivial' }],
      }),
    ).toThrow();
    expect(() =>
      OnboardingDraft.parse({
        ...draft,
        packages: [{ ...draft.packages[0]!, manager: 'deno' }],
      }),
    ).toThrow();
    expect(() =>
      OnboardingDraft.parse({
        ...draft,
        dropped: { ...draft.dropped, unknown_path: 2.5 },
      }),
    ).toThrow();
    expect(() =>
      OnboardingDraft.parse({
        ...draft,
        inputs: [{ id: 'sample_files', status: 'included', tokens: 1, detail: null }],
      }),
    ).toThrow();
    expect(() => OnboardingDraft.parse({ ...draft, tokenizer: 'o200k_base' })).toThrow();
  });

  /**
   * THE SEAM. The slice that persists builds its record as
   * `OnboardingDraft.extend({ generated_at, index_state })`, and Zod's `.extend()`
   * OVERWRITES on a key collision. So the extension is safe only while this shape
   * owns neither key — that is a property of this object, asserted here, not an
   * agreement between two plans.
   *
   * It is asserted on `Object.keys(shape)` rather than by parsing, because Zod
   * STRIPS an unknown key instead of rejecting it: a stamp added here would fail
   * no parse, throw no exception and break no type in either package. Nothing
   * else in this repository would ever say it happened.
   */
  it('OnboardingDraft carries no stamp — .extend({ generated_at, index_state }) cannot collide', () => {
    const keys = Object.keys(OnboardingDraft.shape);
    expect(keys).toContain('dropped');
    expect(keys).toContain('package_scan');
    expect(keys).not.toContain('generated_at');
    expect(keys).not.toContain('index_state');
  });

  /**
   * A setup command is a line a reader copies and runs, so the field that makes
   * it checkable is not decoration: without `source_path` there is no file to
   * prove the command against, and `cp .env.example .env` for a repository that
   * has no `.env.example` is indistinguishable from one that does. Required, not
   * optional — an optional authorisation is no authorisation.
   */
  it('a setup command without its authorising source_path is rejected', () => {
    const { source_path: _none, ...unauthorised } = draft.setup_commands[0]!;
    expect(() =>
      OnboardingDraft.parse({ ...draft, setup_commands: [unauthorised] }),
    ).toThrow();
  });

  /**
   * A cut env list has to say it was cut. This is not hypothetical arithmetic:
   * `server/.env.example` in THIS repository declares 13 keys against a ceiling of
   * `MAX_ENV_VARS` = 12, so the repository the feature is demonstrated on is
   * already one over, and without the flag its tour would show twelve variables
   * with nothing to distinguish that from all of them.
   *
   * Raising the ceiling would not fix it — it would move the cliff to a repository
   * with 25 variables and keep the silence. The flag is the fix, and it is
   * `sample_truncated`'s shape rather than a new one. Grounding sets it (P4); what
   * this asserts is that the shape leaves no way to stay quiet.
   */
  it('a cut env list must say so — env_vars_truncated is required, not optional', () => {
    const atCeiling = Array.from({ length: MAX_ENV_VARS }, (_, i) => ({
      name: `VAR_${i}`,
      source_path: 'server/.env.example',
    }));
    const cut = OnboardingDraft.parse({
      ...draft,
      env_vars: atCeiling,
      env_vars_truncated: true,
    });
    expect(cut.env_vars).toHaveLength(MAX_ENV_VARS);
    expect(cut.env_vars_truncated).toBe(true);

    const { env_vars_truncated: _silent, ...noFlag } = draft;
    expect(() => OnboardingDraft.parse(noFlag)).toThrow();
  });

  /** `Onboarding` is the content half: the draft's audit numbers are not part of it. */
  it('Onboarding parses the content half and drops the generation numbers', () => {
    const tour = Onboarding.parse(draft);
    expect(tour.sections).toHaveLength(5);
    // Setup commands are content — they are drawn — while the numbers below
    // describe the generation and stop at the draft.
    expect(tour.setup_commands).toHaveLength(2);
    // The truncation flag is content too — it is drawn beside the list it
    // describes, unlike `sample_truncated`, which only ever reaches a log.
    expect(tour.env_vars_truncated).toBe(false);
    expect(tour).not.toHaveProperty('dropped');
    expect(tour).not.toHaveProperty('tokenizer');
  });

  /**
   * THE READ PATH, not the write one. A tour lives in a `jsonb` column and is
   * parsed on the way back out (`modules/onboarding/repository.ts`), so a count
   * or an array ADDED to this contract later is one that is ABSENT from every
   * document already stored. Without a `.default()` those documents stop
   * parsing, the repository degrades the failure to `null`, and the page says
   * "nothing generated yet, press Generate" about a tour that is whole in the
   * database and was paid for once.
   *
   * So the assertion is about a version of this contract that does not exist
   * yet: strip every count and every array, exactly as a document written
   * before them would lack them, and the parse must still succeed — with zeros
   * and empty lists, never with a plausible number.
   */
  it('a document written before the counts and arrays existed parses to zeros and empty lists', () => {
    const {
      sections: _sections,
      flows: _flows,
      reading_path: _readingPath,
      tasks: _tasks,
      setup_commands: _setupCommands,
      packages: _packages,
      env_vars: _envVars,
      inputs: _inputs,
      sample_files: _sampleFiles,
      chains_supplied: _chainsSupplied,
      longest_chain_files: _longestChainFiles,
      budget: _budget,
      input_tokens_counted: _inputTokensCounted,
      system_tokens: _systemTokens,
      attempts: _attempts,
      tokens_in: _tokensIn,
      duration_ms: _durationMs,
      cost_usd: _costUsd,
      ...older
    } = draft;

    const parsed = OnboardingDraft.parse({
      ...older,
      // The two nested shapes, stripped the same way: only the boolean the
      // package walk cannot default survives.
      package_scan: { bounded: false },
      dropped: {},
    });

    expect(parsed.sections).toEqual([]);
    expect(parsed.flows).toEqual([]);
    expect(parsed.reading_path).toEqual([]);
    expect(parsed.tasks).toEqual([]);
    expect(parsed.setup_commands).toEqual([]);
    expect(parsed.packages).toEqual([]);
    expect(parsed.env_vars).toEqual([]);
    expect(parsed.inputs).toEqual([]);
    expect(parsed.package_scan).toEqual({
      depth: 0,
      excluded_dirs: [],
      found: 0,
      shown: 0,
      bounded: false,
    });
    expect(parsed.dropped).toEqual({
      unknown_path: 0,
      unknown_script: 0,
      manager_mismatch: 0,
      unknown_complexity: 0,
      unknown_section: 0,
    });
    expect(parsed.sample_files).toBe(0);
    expect(parsed.chains_supplied).toBe(0);
    expect(parsed.longest_chain_files).toBe(0);
    expect(parsed.budget).toBe(0);
    expect(parsed.input_tokens_counted).toBe(0);
    expect(parsed.system_tokens).toBe(0);
    expect(parsed.attempts).toBe(0);
    expect(parsed.tokens_in).toBe(0);
    expect(parsed.duration_ms).toBe(0);
    // `cost_usd` defaults to `null`, not `0`: "the provider quoted no price" and
    // "the generation was free" are different facts, and this field already has
    // a member for the first one.
    expect(parsed.cost_usd).toBeNull();
  });

  /**
   * The same obligation one level down. A field is added to `OnboardingSection`
   * as readily as to the draft, and a section, a flow or a package block that
   * fails to parse fails the WHOLE document — the array it sits in is not
   * salvaged item by item on read.
   */
  it('a section, a flow and a package block predating their arrays parse the same way', () => {
    const parsed = OnboardingDraft.parse({
      ...draft,
      sections: [
        {
          kind: 'architecture',
          title: 'Архітектура',
          body: 'Сервер на Fastify у `server/src`.',
          state: 'ready',
          empty_reason: null,
        },
      ],
      flows: [{ title: 'Імпорт PR' }],
      packages: [{ name: 'server', path: 'server', manager: 'pnpm', install_command: null }],
      // A task and an input row exactly as SPEC-03 wrote them: four keys and
      // four keys. Both sit inside arrays that are not salvaged item by item,
      // so either one failing takes the whole stored tour with it.
      tasks: [
        {
          title: 'Додати лічильник',
          path: 'server/src/modules/onboarding/constants.ts',
          why: 'Стелі переглядаються з чисел.',
          complexity: 'low',
        },
      ],
      inputs: [{ id: 'repo_map', status: 'included', tokens: 5_200, detail: null }],
    });

    expect(parsed.sections[0]!.links).toEqual([]);
    expect(parsed.sections[0]!.verified_paths).toEqual([]);
    expect(parsed.flows[0]!.steps).toEqual([]);
    expect(parsed.packages[0]!.commands).toEqual([]);
    expect(parsed.tasks[0]!.steps).toEqual([]);
    expect(parsed.tasks[0]!.impact).toBe('');
    expect(parsed.tasks[0]!.verification).toBe('');
    expect(parsed.inputs[0]!.omitted).toEqual([]);
    expect(parsed.inputs[0]!.shortened).toEqual([]);
  });
});

/**
 * Risk Brief (10) — the contract P2 persists and P3 renders. `RiskBriefRecord` is
 * parsed on read out of `pr_brief.json`, so every field it requires must be present
 * in every row ever written; the enums are what stop a model's free string from
 * reaching the card as a level or a freshness the UI has no branch for.
 */
describe('Risk Brief contracts', () => {
  const record = {
    what: 'Adds a per-workspace rate limit to the brief route.',
    why: 'The paid path was keyed by IP, which throttled unrelated workspaces.',
    risk_level: 'medium',
    risks: [
      {
        kind: 'security',
        title: 'Limit evaded by a distributed caller',
        explanation: 'Keying on IP lets a caller spread the spend across addresses.',
        severity: 'high',
        file_refs: ['server/src/modules/brief/routes.ts'],
      },
    ],
    review_focus: [
      {
        ref: 'server/src/modules/brief/routes.ts',
        kind: 'file',
        reason: 'The keyGenerator resolves tenancy twice per POST.',
      },
      { ref: 'POST /pulls/:id/brief', kind: 'endpoint', reason: 'The only paid route here.' },
    ],
    head_sha: 'a'.repeat(40),
    intent_computed_at: '2026-08-16T09:00:00.000Z',
    intent_freshness: 'stale',
    blast_status: 'partial',
    link_sha: 'b'.repeat(40),
    index_matches_head: false,
    inputs: [
      { id: 'diff_stats', status: 'included', tokens: 320, detail: '12 files, +840/-96' },
      { id: 'intent', status: 'included', tokens: 210, detail: null },
      { id: 'specs', status: 'truncated', tokens: 1200, detail: 'specs/SPEC-02-pr-why-risk-brief.md' },
      { id: 'linked_issue', status: 'missing', tokens: 0, detail: 'no linked issue' },
    ],
    ref_lines: [
      { ref: 'server/src/modules/brief/routes.ts', line: 42, source: 'blast_symbol' },
    ],
    dropped_refs: ['../../etc/passwd'],
    dropped_risks: 2,
    budget: 8000,
    input_tokens_counted: 4310,
    tokenizer: 'cl100k_base',
    attempts: 2,
    tokens_in: 4402,
    provider: 'openai',
    model: 'gpt-4.1',
    cost_usd: 0.031,
    computed_at: '2026-08-16T09:05:00.000Z',
  };

  it('RiskBrief — the flat schema handed to the model', () => {
    const brief = RiskBrief.parse({
      what: record.what,
      why: record.why,
      risk_level: record.risk_level,
      risks: record.risks,
      review_focus: record.review_focus,
    });
    expect(brief.risks).toHaveLength(1);
    expect(brief.review_focus[1]!.kind).toBe('endpoint');
  });

  it('RiskBriefRecord round-trips a full row', () => {
    const parsed = RiskBriefRecord.parse(record);
    expect(parsed.head_sha).toBe('a'.repeat(40));
    expect(parsed.attempts).toBe(2);
    expect(parsed.tokens_in).toBe(4402);
    expect(parsed.inputs).toHaveLength(4);
    expect(parsed.index_matches_head).toBe(false);
    expect(parsed.ref_lines).toEqual([
      { ref: 'server/src/modules/brief/routes.ts', line: 42, source: 'blast_symbol' },
    ]);
  });

  /**
   * `ref_lines` carries the line beside the refs, never inside them: `RiskBrief`
   * — the schema the model fills — has no line field, so a number can only come
   * from the blast answer the server measured.
   */
  it('ref_lines round-trips one entry of each source, and never reaches RiskBrief', () => {
    const parsed = RiskBriefRecord.parse({
      ...record,
      ref_lines: [
        { ref: 'src/middleware/ratelimit.ts', line: 12, source: 'blast_symbol' },
        { ref: 'src/api/public/index.ts', line: 23, source: 'blast_caller' },
        { ref: 'GET /api/public/items', line: 88, source: 'blast_endpoint' },
      ],
    });
    expect(parsed.ref_lines.map((r) => r.source)).toEqual([
      'blast_symbol',
      'blast_caller',
      'blast_endpoint',
    ]);
    expect(parsed.ref_lines[1]!.line).toBe(23);
    // The refs themselves keep their shapes — plain strings, no `:<n>` suffix in
    // the stored value and no line field on Risk / ReviewFocusItem.
    expect(parsed.risks[0]!.file_refs).toEqual(['server/src/modules/brief/routes.ts']);
    expect(RiskBrief.parse(record)).not.toHaveProperty('ref_lines');
  });

  it('a ref_lines source outside the enum, or a non-integer line, is rejected', () => {
    expect(() =>
      RiskBriefRecord.parse({
        ...record,
        ref_lines: [{ ref: 'src/a.ts', line: 12, source: 'pr_files_patch' }],
      }),
    ).toThrow();
    // A model-written number is the one thing this field must not be able to hold,
    // and a fractional or string line is what a guessed one looks like.
    expect(() =>
      RiskBriefRecord.parse({
        ...record,
        ref_lines: [{ ref: 'src/a.ts', line: 12.5, source: 'blast_symbol' }],
      }),
    ).toThrow();
    expect(() =>
      RiskBriefRecord.parse({
        ...record,
        ref_lines: [{ ref: 'src/a.ts', line: '12', source: 'blast_symbol' }],
      }),
    ).toThrow();
  });

  it('cost_usd and link_sha are nullable — an unpriced model and a missing index are rows, not errors', () => {
    const parsed = RiskBriefRecord.parse({
      ...record,
      cost_usd: null,
      link_sha: null,
      intent_computed_at: null,
      intent_freshness: 'unknown',
    });
    expect(parsed.cost_usd).toBeNull();
    expect(parsed.link_sha).toBeNull();
  });

  it('a fourth risk_level is rejected', () => {
    expect(() => RiskBriefRecord.parse({ ...record, risk_level: 'critical' })).toThrow();
    expect(() =>
      RiskBriefRecord.parse({
        ...record,
        risks: [{ ...record.risks[0]!, severity: 'critical' }],
      }),
    ).toThrow();
  });

  it('a fourth intent_freshness is rejected', () => {
    expect(() => RiskBriefRecord.parse({ ...record, intent_freshness: 'maybe' })).toThrow();
    // A boolean would spell "unknown" as false, i.e. "not stale" — the one thing
    // this field exists to avoid claiming.
    expect(() => RiskBriefRecord.parse({ ...record, intent_freshness: false })).toThrow();
  });

  it('an input id or status outside its enum is rejected', () => {
    expect(() =>
      RiskBriefRecord.parse({
        ...record,
        inputs: [{ id: 'patch', status: 'included', tokens: 1, detail: null }],
      }),
    ).toThrow();
    expect(() =>
      RiskBriefRecord.parse({
        ...record,
        inputs: [{ id: 'specs', status: 'partial', tokens: 1, detail: null }],
      }),
    ).toThrow();
    expect(() => RiskBriefRecord.parse({ ...record, tokenizer: 'o200k_base' })).toThrow();
  });

  it('RiskBriefTimeline with two entries parses', () => {
    const timeline = RiskBriefTimeline.parse({
      entries: [
        {
          head_sha: 'c'.repeat(40),
          what: 'First state.',
          risk_level: 'low',
          computed_at: '2026-08-15T10:00:00.000Z',
          on_branch: false,
          level_changed: false,
        },
        {
          head_sha: 'd'.repeat(40),
          what: 'Second state.',
          risk_level: 'high',
          computed_at: '2026-08-16T10:00:00.000Z',
          on_branch: true,
          level_changed: true,
        },
      ],
      commits_without_brief: 3,
      evicted: 0,
      max_states: 20,
    });
    expect(timeline.entries).toHaveLength(2);
    expect(timeline.entries[1]!.level_changed).toBe(true);
    // `evicted` is the count carried on the rows, never inferred from entries.length:
    // a PR at exactly max_states has evicted nothing.
    expect(timeline.evicted).toBe(0);
  });
});

/**
 * `ReviewRecord.head_sha` — which STATE of the PR a review describes. The banner
 * asks "is there a completed review for the head I am looking at", and nothing
 * else in the schema answers it: `pull_requests.last_reviewed_sha` speaks only for
 * the newest completed run. `null` is "written before this column existed", which
 * is why it is nullable rather than defaulted to the current head.
 */
describe('ReviewRecord head_sha', () => {
  const review = {
    id: 'r1',
    pr_id: 'pr1',
    agent_id: null,
    run_id: 'run-1',
    agent_name: 'Security Reviewer',
    head_sha: 'a'.repeat(40),
    kind: 'review',
    verdict: 'request_changes',
    summary: 'Two blockers before merge.',
    score: 61,
    model: 'gpt-4.1',
    grounding: '3/3 passed',
    created_at: '2026-08-16T09:05:00.000Z',
    findings: [],
  };

  it('carries the head it describes', () => {
    const parsed = ReviewRecord.parse(review);
    expect(parsed.head_sha).toBe('a'.repeat(40));
  });

  it('null is a row from before the column, not a claim about the current head', () => {
    const parsed = ReviewRecord.parse({ ...review, head_sha: null });
    expect(parsed.head_sha).toBeNull();
  });

  it('the key is required — an absent head_sha is not the same as an unknown one', () => {
    const { head_sha: _omitted, ...withoutHead } = review;
    expect(() => ReviewRecord.parse(withoutHead)).toThrow();
    expect(() => ReviewRecord.parse({ ...review, head_sha: 42 })).toThrow();
  });
});

describe('platform DTOs', () => {
  it('Settings defaults + passthrough', () => {
    const s = Settings.parse({ extra_key: 'x' });
    expect(s.theme).toBe('dark');
    expect((s as Record<string, unknown>).extra_key).toBe('x');
  });

  it('Repo + PrDetail', () => {
    expect(() =>
      Repo.parse({
        id: 'r1',
        workspace_id: 'w1',
        owner: 'acme',
        name: 'payments-api',
        full_name: 'acme/payments-api',
        default_branch: 'main',
        clone_path: null,
        last_polled_at: null,
        created_by: null,
      }),
    ).not.toThrow();
    expect(() =>
      PrDetail.parse({
        number: 482,
        title: 't',
        author: 'a',
        branch: 'b',
        base: 'main',
        head_sha: 'sha',
        additions: 1,
        deletions: 0,
        files_count: 1,
        status: 'open',
        files: [],
        commits: [],
      }),
    ).not.toThrow();
  });
});

describe('multi-agent contracts (SPEC-05)', () => {
  const uuid = (n: number) => `0000000${n}`.slice(-8) + '-0000-4000-8000-000000000000';

  const finding = {
    id: 'f1',
    severity: 'WARNING',
    category: 'security',
    title: 'Unbounded fan-out',
    file: 'src/run.ts',
    start_line: 12,
    end_line: 18,
    rationale: 'No ceiling on concurrent runs.',
    suggestion: 'Bound it.',
    confidence: 0.8,
    review_id: 'rev1',
    accepted_at: null,
    dismissed_at: null,
  };

  it('AgentColumnFinding is FindingRecord, not the old seven-field subset', () => {
    // The expanded detail draws confidence, rationale and the suggested fix, and
    // the Accept/Dismiss buttons must show their state on first paint (AC-63) —
    // which is `accepted_at` / `dismissed_at`. A subset makes that a second
    // request, and a second shape drifts from this one.
    const parsed = AgentColumnFinding.parse(finding);
    expect(parsed.accepted_at).toBeNull();
    expect(parsed.confidence).toBe(0.8);
    const { review_id: _dropped, ...subset } = finding;
    expect(() => AgentColumnFinding.parse(subset)).toThrow();
  });

  it('AgentColumnStatus carries queued and cancelled, which agent_runs.status alone cannot', () => {
    // AC-33/AC-34: a bounded fan-out has runs that exist and have not started.
    // AC-39: a cancelled column must be distinguishable from a failed one.
    expect(AgentColumnStatus.options).toEqual([
      'queued',
      'running',
      'done',
      'failed',
      'cancelled',
    ]);
  });

  it('AgentColumn keeps a deleted agent named (AC-118)', () => {
    const column = AgentColumn.parse({
      run_id: 'run1',
      agent_id: null,
      agent_name: 'Security',
      agent_deleted: true,
      provider: null,
      model: null,
      status: 'done',
      error: null,
      verdict: 'request_changes',
      score: 61,
      summary: null,
      duration_ms: 8200,
      cost_usd: null,
      findings: [finding],
    });
    expect(column.agent_name).toBe('Security');
    expect(column.agent_deleted).toBe(true);
  });

  it('ConflictTake.verdict has exactly THREE kinds — severities, ignored, not_reviewed', () => {
    // SPEC-05 § D22. The rejected alternative is four run states inside the
    // verdict; the run state already sits in `AgentColumn.status` of the same
    // body, and this test is what makes splitting it a red suite rather than a
    // screen that says "reviewing" beside a column that says "run failed".
    const take = (verdict: string, note: string | null) => ({
      run_id: 'run1',
      agent_id: null,
      persona: 'Security',
      verdict,
      note,
    });
    for (const v of ['CRITICAL', 'WARNING', 'SUGGESTION', 'ignored', 'not_reviewed']) {
      expect(() => ConflictTake.parse(take(v, null))).not.toThrow();
    }
    for (const v of ['failed', 'cancelled', 'running', 'queued', 'done']) {
      expect(ConflictTake.safeParse(take(v, null)).success, `verdict ${v}`).toBe(false);
    }
    // AC-122: a `not_reviewed` take carries no note at all, so the field is
    // nullable rather than a string holding the system's own words.
    expect(ConflictTake.parse(take('not_reviewed', null)).note).toBeNull();
  });

  it('Conflict carries the line RANGE, not a single line', () => {
    const c = Conflict.parse({
      file: 'src/run.ts',
      start_line: 12,
      end_line: 18,
      title: 'Unbounded fan-out',
      takes: [],
    });
    expect(c.end_line).toBe(18);
    expect(() =>
      Conflict.parse({ file: 'a', line: 12, title: 't', takes: [] }),
    ).toThrow();
  });

  it('MultiAgentRun says how it ran and whether its total is complete', () => {
    const run = MultiAgentRun.parse({
      id: 'm1',
      pr_id: 'p1',
      pr_number: 482,
      pr_title: 'Add rate limiting to public API endpoints',
      head_sha: 'abc123',
      ran_at: '2026-08-26T10:00:00.000Z',
      agent_count: 4,
      concurrency: 3,
      total_duration_ms: 9100,
      total_duration_kind: 'measured',
      total_cost_usd: 0.2,
      total_cost_partial: true,
      columns: [],
      conflicts: [],
    });
    // AC-40's "how it was executed" is written from this number, never from the
    // word "parallel"; AC-42's incompleteness mark is a field, not an inference.
    expect(run.concurrency).toBe(3);
    expect(run.total_cost_partial).toBe(true);
    // AC-41/AC-156/AC-158: the duration and its CAPTION travel together, so a
    // number measured over a finished multi-run can never be printed as the time
    // elapsed on a live one, or the other way round.
    expect(run.total_duration_kind).toBe('measured');
  });

  it('MultiAgentRunRef is a link, not a comparison', () => {
    const ref = MultiAgentRunRef.parse({
      id: 'm1',
      pr_id: 'p1',
      pr_number: 482,
      ran_at: '2026-08-26T10:00:00.000Z',
    });
    expect(Object.keys(ref).sort()).toEqual(['id', 'pr_id', 'pr_number', 'ran_at']);
  });

  it('LastSuccessfulRun lets every number be absent (AC-20, AC-21)', () => {
    const r = LastSuccessfulRun.parse({
      agent_id: uuid(1),
      duration_ms: 8200,
      cost_usd: null,
      ran_at: null,
    });
    // An agent whose last successful run has no cost still counts toward the
    // time maximum, so cost is nullable on its own rather than the row missing.
    expect(r.cost_usd).toBeNull();
    expect(r.duration_ms).toBe(8200);
  });

  it('MultiAgentRunRequest is non-empty and capped at the ceiling (AC-27, AC-30)', () => {
    expect(MAX_AGENTS_PER_MULTI_RUN).toBe(10);
    expect(() =>
      MultiAgentRunRequest.parse({ agentIds: [uuid(1), uuid(2)] }),
    ).not.toThrow();
    // Derived with `.pick().required()`, so these three prove the derivation kept
    // the checks rather than just the field.
    expect(MultiAgentRunRequest.safeParse({ agentIds: [] }).success).toBe(false);
    expect(
      MultiAgentRunRequest.safeParse({
        agentIds: Array.from({ length: 11 }, (_, i) => uuid(i)),
      }).success,
    ).toBe(false);
    expect(MultiAgentRunRequest.safeParse({}).success).toBe(false);
    expect(MultiAgentRunRequest.safeParse({ agentIds: ['not-a-uuid'] }).success).toBe(false);
  });

  it('RunRequest still accepts every body the PR page already sends', () => {
    // `agentIds` was ADDED to `RunRequest`; `reviews/routes.ts` parses
    // `req.body ?? {}` through it, so all three of these must keep parsing or
    // AC-35 ("the PR page's review button does not change") is already broken.
    expect(RunRequest.parse({})).toEqual({});
    expect(RunRequest.parse({ agentId: 'a1' })).toEqual({ agentId: 'a1' });
    expect(RunRequest.parse({ all: true })).toEqual({ all: true });
  });
});
