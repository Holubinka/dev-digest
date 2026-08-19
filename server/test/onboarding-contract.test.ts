/**
 * P1.10 — the one failure in this slice that produces a VALID schema and no
 * error anywhere.
 *
 * `OnboardingRecord` is `OnboardingDraft.extend({ index_state, generated_at })`,
 * and `.extend()` overwrites silently. An earlier draft of plan 13 called the
 * package-walk facts `packages`, which under that `.extend()` would have
 * replaced slice A's array of package blocks with an object of counts — the
 * whole "How to run" section gone from every stored record, with nothing to
 * report it: `tsc` cannot see it (each package compiles against its OWN vendored
 * copy of the contract, so a collision is consistent within each), and the
 * client does not validate responses at runtime by design
 * (`client/src/lib/api.ts`).
 *
 * So the seam between the two slices is asserted here rather than agreed in
 * prose. Both directions matter: nothing of the draft's may be replaced, and
 * neither stamp may already exist on the draft — the second is what makes the
 * first true "by construction" rather than by luck.
 */
import { describe, it, expect } from 'vitest';
import { OnboardingDraft, OnboardingRecord } from '@devdigest/shared';

describe('onboarding contract — the record is the draft plus exactly two stamps', () => {
  it('carries every key of the draft, as the SAME schema object', () => {
    const draftKeys = Object.keys(OnboardingDraft.shape);
    // A guard on the guard: if the draft ever came back empty — a rename, a bad
    // barrel export — every assertion below would pass over nothing.
    expect(draftKeys.length).toBeGreaterThan(15);

    for (const key of draftKeys) {
      const own = OnboardingDraft.shape[key as keyof typeof OnboardingDraft.shape];
      const extended = OnboardingRecord.shape[key as keyof typeof OnboardingRecord.shape];
      // Identity, not deep equality: a replacement that happened to be
      // structurally similar is exactly the accident this test exists for.
      expect(extended, `record.${key} was replaced by the extension`).toBe(own);
    }
  });

  it('adds index_state and generated_at, and nothing else', () => {
    const added = Object.keys(OnboardingRecord.shape).filter(
      (key) => !(key in OnboardingDraft.shape),
    );
    expect(added.sort()).toEqual(['generated_at', 'index_state']);
  });

  it('the draft owns neither stamp, so the extension has nothing to overwrite', () => {
    expect('index_state' in OnboardingDraft.shape).toBe(false);
    expect('generated_at' in OnboardingDraft.shape).toBe(false);
  });

  it('the five numbers AC-52 names live on the DRAFT, so this slice records rather than computes them', () => {
    for (const key of ['attempts', 'input_tokens_counted', 'tokenizer', 'tokens_in', 'cost_usd']) {
      expect(key in OnboardingDraft.shape, `${key} should be produced by slice A`).toBe(true);
    }
  });

  /**
   * SPEC-04 added seven fields to the draft and three to a task, so the same
   * property has to hold one version later: the four keys the record adds are
   * still exactly two stamps, and every new field belongs to the DRAFT. A
   * `duration_ms` declared on the record instead would type-check in both
   * packages and simply never be produced by the pipeline.
   */
  it('the fields SPEC-04 added live on the draft, not on the record', () => {
    for (const key of ['chains_supplied', 'longest_chain_files', 'system_tokens', 'duration_ms']) {
      expect(key in OnboardingDraft.shape, `${key} should be produced by the generation`).toBe(
        true,
      );
    }
  });

  /**
   * The record is parsed back out of a jsonb column on every read, so a count
   * or an array without a `.default()` turns every row written before that field
   * existed into a failed parse. This slice degrades that to "no tour yet"
   * rather than a 422 — but the field itself is still the cheaper fix, and this
   * is where it is visible.
   */
  it('every count and array of the index stamp survives a document that predates it', () => {
    const parsed = OnboardingRecord.shape.index_state.safeParse({ status: 'full' });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data).toEqual({
      status: 'full',
      last_indexed_sha: '',
      files_indexed: 0,
      files_skipped: 0,
    });
  });
});

/**
 * The same obligation, one release later and against a WHOLE document rather
 * than a nested shape.
 *
 * SPEC-04 adds `steps`, `impact` and `verification` to a task, four counts to
 * the draft and two arrays to an input row. Every tour already in the database
 * was written without them, and every one of them is read back through this
 * schema. Drop a single `.default()` and the parse below fails; the repository
 * degrades that to `null`, and the screen says "nothing generated yet, press
 * Generate" about a tour that is whole in the database and was paid for once.
 * That failure has no compile error and no exception anywhere to announce it —
 * this parse is the only thing that says it happened.
 *
 * The fixture is deliberately a COMPLETE pre-SPEC-04 record, not a minimal one:
 * a tour saved by the shipped pipeline carries every old field, so a test built
 * out of `{}` would prove the defaults fire without proving they fire beside the
 * fields that were already there.
 */
describe('onboarding contract — a tour saved before SPEC-04 still parses', () => {
  const beforeSpec04 = {
    sections: [
      {
        kind: 'first_tasks',
        title: 'Перші задачі',
        body: 'Почни з лічильників у `server/src/modules/onboarding/constants.ts`.',
        links: [],
        verified_paths: ['server/src/modules/onboarding/constants.ts'],
        state: 'ready',
        empty_reason: null,
      },
    ],
    flows: [{ title: 'Імпорт pull request', steps: [] }],
    reading_path: [{ path: 'server/src/platform/container.ts', reason: 'Тут будується граф.' }],
    tasks: [
      {
        title: 'Додати лічильник до аудиту',
        path: 'server/src/modules/onboarding/constants.ts',
        why: 'Стелі стартові й переглядаються з чисел.',
        complexity: 'medium',
      },
    ],
    setup_commands: [],
    packages: [],
    env_vars: [],
    env_vars_truncated: false,
    package_scan: { depth: 2, excluded_dirs: [], found: 6, shown: 6, bounded: false },
    inputs: [{ id: 'project_docs', status: 'truncated', tokens: 6_100, detail: '7 of 7 documents' }],
    dropped: {
      unknown_path: 0,
      unknown_script: 0,
      manager_mismatch: 0,
      unknown_complexity: 0,
      unknown_section: 0,
    },
    sample_files: 19,
    sample_truncated: false,
    budget: 24_000,
    input_tokens_counted: 23_481,
    tokenizer: 'cl100k_base',
    attempts: 1,
    tokens_in: 23_902,
    provider: 'openrouter',
    model: 'deepseek/deepseek-v4-flash',
    cost_usd: 0.0053,
    index_state: {
      last_indexed_sha: '7554ce0',
      files_indexed: 656,
      files_skipped: 4,
      status: 'full',
    },
    generated_at: '2026-08-18T09:12:44.000Z',
  };

  it('parses, and the task reads as a task that states nothing rather than one that is broken', () => {
    const parsed = OnboardingRecord.safeParse(beforeSpec04);
    expect(parsed.success, JSON.stringify(parsed.success ? [] : parsed.error.issues)).toBe(true);
    if (!parsed.success) return;

    const task = parsed.data.tasks[0]!;
    expect(task.steps).toEqual([]);
    expect(task.impact).toBe('');
    expect(task.verification).toBe('');
    // The four old keys are untouched: the defaults fill gaps, they do not
    // rewrite what the document already said.
    expect(task.title).toBe('Додати лічильник до аудиту');
    expect(task.complexity).toBe('medium');
  });

  it('the draft counts SPEC-04 added read as zero, never as a plausible number', () => {
    const parsed = OnboardingRecord.parse(beforeSpec04);
    expect(parsed.chains_supplied).toBe(0);
    expect(parsed.longest_chain_files).toBe(0);
    expect(parsed.system_tokens).toBe(0);
    expect(parsed.duration_ms).toBe(0);
    // `budget` predates this change and keeps what the document said — the value
    // that was applied, not the one today's formula would compute for it.
    expect(parsed.budget).toBe(24_000);
  });

  it('an input row written before the two arrays reads as "nothing was named", not "nothing was cut"', () => {
    const parsed = OnboardingRecord.parse(beforeSpec04);
    const row = parsed.inputs[0]!;
    expect(row.omitted).toEqual([]);
    expect(row.shortened).toEqual([]);
    // `detail` is what the screen draws and it is untouched: the arrays are the
    // record's half of the same fact, not a replacement for it.
    expect(row.detail).toBe('7 of 7 documents');
  });

  /**
   * A step is `{ text, path, command }` with both of the last two `.nullable()`
   * rather than `.optional()`, so a step that names no file still HAS the key.
   * Written as a rejection because the distinction is invisible in the happy
   * case: `undefined` would be silently accepted by an `.optional()` and the
   * consumer's `step.path === null` branch would never run.
   */
  it('a step must carry both keys — null is the answer, absence is not', () => {
    const withStep = (step: unknown) => ({
      ...beforeSpec04,
      tasks: [{ ...beforeSpec04.tasks[0]!, steps: [step] }],
    });

    const ok = OnboardingRecord.parse(withStep({ text: 'Додай гілку в обробник.', path: null, command: null }));
    expect(ok.tasks[0]!.steps[0]).toEqual({
      text: 'Додай гілку в обробник.',
      path: null,
      command: null,
    });

    expect(() => OnboardingRecord.parse(withStep({ text: 'Додай гілку.' }))).toThrow();
    expect(() =>
      OnboardingRecord.parse(withStep({ text: 'Додай гілку.', path: 'server/src/index.ts' })),
    ).toThrow();
  });
});
