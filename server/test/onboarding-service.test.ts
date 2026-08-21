/**
 * P1.10 — the service, with a fake repository and a COUNTING fake generator.
 *
 * The generator count is the assertion in almost every case here. A status code
 * proves what the caller was told; the number of times `run` was reached proves
 * what the workspace was charged, and those are different facts. Reading a tour
 * that already exists, and every one of the three refusals, must leave that
 * counter at zero.
 *
 * The repository is faked through `OnboardingReads` rather than through the
 * class: `OnboardingRepository` holds `private db`, and a private member makes a
 * plain object literal unassignable to the class type — which is why three
 * services in this repository still have no hermetic test.
 */
import { describe, it, expect } from 'vitest';
import { OnboardingService } from '../src/modules/onboarding/service.js';
import type {
  IndexSnapshot,
  OnboardingContainer,
  OnboardingGenerateInput,
  OnboardingReads,
  OnboardingRepo,
} from '../src/modules/onboarding/types.js';
import { ConfigError } from '../src/platform/errors.js';
import type { AppError } from '../src/platform/errors.js';
import type { OnboardingGenerationResult } from '../src/modules/onboarding/generation-types.js';
import type { OnboardingDraft, OnboardingRecord } from '@devdigest/shared';

const REPO_ID = '22222222-2222-4222-8222-222222222222';
const WORKSPACE = '33333333-3333-4333-8333-333333333333';

const REPO: OnboardingRepo = {
  id: REPO_ID,
  owner: 'acme',
  name: 'payments-api',
  fullName: 'acme/payments-api',
  defaultBranch: 'main',
  clonePath: '/clones/acme/payments-api',
};

/**
 * The repository really holds this many files. `READY.filesIndexed` is 412 —
 * the indexer's CUMULATIVE counter, which climbs with every incremental pass.
 * They are different numbers on purpose, and every test below that cares which
 * one was used relies on them differing.
 */
const FILES_ON_DISK = 260;

const READY: IndexSnapshot = {
  status: 'full',
  filesIndexed: 412,
  filesSkipped: 3,
  lastIndexedSha: 'a1b2c3d4',
  updatedAt: new Date('2026-08-18T09:00:00.000Z'),
};

/** The smallest thing that is a whole `OnboardingDraft`. Slice A's shape, not this slice's. */
const DRAFT: OnboardingDraft = {
  sections: [],
  flows: [],
  reading_path: [],
  tasks: [],
  setup_commands: [],
  packages: [],
  env_vars: [],
  env_vars_truncated: false,
  package_scan: { depth: 3, excluded_dirs: ['node_modules'], found: 2, shown: 2, bounded: false },
  inputs: [{ id: 'repo_map', status: 'included', tokens: 900, detail: null }],
  dropped: {
    unknown_path: 1,
    unknown_script: 0,
    manager_mismatch: 0,
    unknown_complexity: 0,
    unknown_section: 0,
  },
  sample_files: 12,
  sample_truncated: false,
  chains_supplied: 20,
  longest_chain_files: 5,
  // 412 indexed files — the fixture's own `READY` — computes to this pair.
  budget: 29_356,
  input_tokens_counted: 18200,
  system_tokens: 1_100,
  duration_ms: 96_412,
  tokenizer: 'cl100k_base',
  attempts: 1,
  tokens_in: 18477,
  provider: 'openrouter',
  model: 'deepseek/deepseek-v4-flash',
  cost_usd: 0.0031,
};

/**
 * The executor hands back a draft AND an audit; the audit is richer than the
 * record's five counters and the executor has already logged it, so the service
 * drops it. It is built here anyway, whole, so this fake cannot drift into a
 * shape the real seam does not have.
 */
const RESULT: OnboardingGenerationResult = {
  draft: DRAFT,
  audit: { ...DRAFT.dropped, off_chain: 2, unknown_env: 0, probes: 31, samples: ['src/app.ts'] },
};

const silentLog = { info: () => {}, warn: () => {} };

/** What `READY` becomes once the service has stamped it onto a record. */
const READY_STAMP = {
  last_indexed_sha: 'a1b2c3d4',
  files_indexed: 412,
  files_skipped: 3,
  status: 'full' as const,
};

interface Harness {
  service: OnboardingService;
  /** How many times the generator was reached — i.e. how many model calls were paid for. */
  runs: () => number;
  /** What the generator was handed, in order. The seam is one of the things under test. */
  inputs: () => OnboardingGenerateInput[];
  upserts: () => OnboardingRecord[];
  /** How many times the index state was read. `generate` reads it twice: the gate, then the re-check. */
  indexReads: () => number;
}

function harness(
  opts: {
    index?: IndexSnapshot;
    /**
     * What every read AFTER the first answers with — a reindex landing inside
     * the generation window. Omitted, the index never moves.
     */
    indexAfter?: IndexSnapshot;
    stored?: OnboardingRecord | null;
    repo?: OnboardingRepo | undefined;
    /** The true file count the budget is sized with. Defaults to `FILES_ON_DISK`. */
    filesOnDisk?: number;
    run?: () => Promise<OnboardingGenerationResult>;
  } = {},
): Harness {
  let runs = 0;
  let indexReads = 0;
  const upserts: OnboardingRecord[] = [];
  const inputs: OnboardingGenerateInput[] = [];

  const reads: OnboardingReads = {
    getRepo: async () => ('repo' in opts ? opts.repo : REPO),
    get: async () => opts.stored ?? null,
    upsert: async (_repoId, record) => {
      upserts.push(record);
    },
  };

  const container: OnboardingContainer = {
    repoIntel: {
      getIndexState: async () => {
        indexReads += 1;
        const gate = opts.index ?? READY;
        return indexReads === 1 ? gate : (opts.indexAfter ?? gate);
      },
      countIndexedFiles: async () => opts.filesOnDisk ?? FILES_ON_DISK,
    },
    onboardingGenerator: {
      run: async (input) => {
        runs += 1;
        inputs.push(input);
        if (opts.run) return opts.run();
        return RESULT;
      },
    },
  };

  return {
    service: new OnboardingService(container, reads),
    runs: () => runs,
    inputs: () => inputs,
    upserts: () => upserts,
    indexReads: () => indexReads,
  };
}

describe('onboarding service — reading (R1, R15)', () => {
  it('reading makes ZERO generator calls, however many times it is read (AC-46)', async () => {
    const h = harness();
    for (let i = 0; i < 3; i += 1) {
      await h.service.page(WORKSPACE, REPO_ID, silentLog);
    }
    expect(h.runs()).toBe(0);
  });

  it('with nothing saved the answer is explicit rather than empty (AC-62)', async () => {
    const page = await harness().service.page(WORKSPACE, REPO_ID, silentLog);
    expect(page).toMatchObject({
      tour: null,
      stale: false,
      generate_blocked: null,
      index: { status: 'full', files_indexed: 412, last_indexed_sha: 'a1b2c3d4' },
    });
  });

  it('a repo in another workspace is undefined — the route turns that into 404 (AC-9)', async () => {
    const h = harness({ repo: undefined });
    expect(await h.service.page(WORKSPACE, REPO_ID, silentLog)).toBeUndefined();
    expect(await h.service.generate(WORKSPACE, REPO_ID, silentLog)).toBeUndefined();
    // Tenancy before spend: not one call.
    expect(h.runs()).toBe(0);
  });

  /**
   * READING IS NEVER BLOCKED. A repository whose index has since crashed still
   * serves the tour it has — only the Generate button is refused, and the
   * refusal travels BESIDE the tour rather than instead of it (AC-60).
   */
  it('a failed index still serves the previous tour, with the refusal beside it', async () => {
    const stored = { ...DRAFT, index_state: { ...READY_STAMP }, generated_at: 'then' } as OnboardingRecord;
    const page = await harness({
      stored,
      index: { ...READY, status: 'failed', degraded: true, degradedReason: 'index_failed' },
    }).service.page(WORKSPACE, REPO_ID, silentLog);

    expect(page?.tour).not.toBeNull();
    expect(page?.generate_blocked).toBe('index_failed');
  });
});

describe('onboarding service — the gate refuses before any spend (R8)', () => {
  const cases = [
    {
      name: 'index_missing',
      index: { ...READY, status: 'degraded' as const, degraded: true, degradedReason: 'no_data' as const, filesIndexed: 0, lastIndexedSha: '' },
      code: 'onboarding_index_missing',
    },
    {
      name: 'index_failed',
      index: { ...READY, status: 'failed' as const, degraded: true, degradedReason: 'index_failed' as const },
      code: 'onboarding_index_failed',
    },
    {
      name: 'language_unsupported',
      index: { ...READY, status: 'partial' as const, filesIndexed: 0, reason: 'no_files' },
      code: 'onboarding_language_unsupported',
    },
  ];

  for (const c of cases) {
    it(`${c.name} throws ${c.code} as a 409, and the generator stays untouched`, async () => {
      const h = harness({ index: c.index });
      const err = await h.service
        .generate(WORKSPACE, REPO_ID, silentLog)
        .then(() => null, (e: AppError) => e);

      expect(err?.code).toBe(c.code);
      expect(err?.statusCode).toBe(409);
      // AC-63: refused BEFORE any model call, not after one.
      expect(h.runs()).toBe(0);
      expect(h.upserts()).toHaveLength(0);
    });
  }

  /** AC-84: the id and its message may not promise that waiting helps. */
  it('the index_missing message claims nothing about waiting', async () => {
    const h = harness({
      index: { ...READY, status: 'degraded', degraded: true, degradedReason: 'no_data', filesIndexed: 0, lastIndexedSha: '' },
    });
    const err = await h.service
      .generate(WORKSPACE, REPO_ID, silentLog)
      .then(() => null, (e: AppError) => e);
    expect(err?.message).not.toMatch(/wait|shortly|in progress|building|try again soon/i);
  });

  /** AC-64 again, this time through the paid path: `partial` with files GENERATES. */
  it('a partial index generates rather than refusing (R16)', async () => {
    const h = harness({ index: { ...READY, status: 'partial', filesIndexed: 40, filesSkipped: 900 } });
    const record = await h.service.generate(WORKSPACE, REPO_ID, silentLog);
    expect(h.runs()).toBe(1);
    expect(record?.index_state).toEqual({
      last_indexed_sha: 'a1b2c3d4',
      files_indexed: 40,
      files_skipped: 900,
      status: 'partial',
    });
  });
});

describe('onboarding service — generating (R6, R7, R11, R12, R14)', () => {
  it('stamps the draft with the state the gate approved and the moment of the write', async () => {
    const h = harness();
    const record = await h.service.generate(WORKSPACE, REPO_ID, silentLog);

    expect(record?.index_state).toEqual(READY_STAMP);
    expect(Date.parse(record!.generated_at)).not.toBeNaN();
    // R12: the five numbers arrive from the generator and are persisted unaltered.
    expect(record).toMatchObject({
      attempts: 1,
      input_tokens_counted: 18200,
      tokenizer: 'cl100k_base',
      tokens_in: 18477,
      cost_usd: 0.0031,
    });
    // And the tour itself passed through untouched — no key renamed, none lost.
    expect(record?.dropped).toEqual(DRAFT.dropped);
    expect(record?.package_scan).toEqual(DRAFT.package_scan);
    expect(h.upserts()).toEqual([record]);
  });

  /**
   * AC-60. The budget on the record and the `files_indexed` beside it have to
   * describe ONE moment, and they do by construction: the number handed over is
   * the gate's own reading, the same object `toIndexState` stamps. A second read
   * here — or a port that let the generator ask for itself — is what would make
   * these two numbers two facts instead of one.
   */
  it('sizes the generation with the true file count, and stamps the indexer counter', async () => {
    // These are two different questions and they get two different numbers.
    // `repo_index_state.files_indexed` ACCUMULATES — `pipeline/incremental.ts`
    // adds each pass to the last — so a repository refreshed often would drift
    // past the budget ramp and be funded at the ceiling for ever while holding
    // the same files. The budget therefore reads the count; the record still
    // reports what the indexer did.
    const h = harness();
    const record = await h.service.generate(WORKSPACE, REPO_ID, silentLog);

    expect(h.inputs()).toEqual([
      { workspaceId: WORKSPACE, repo: REPO, filesIndexed: FILES_ON_DISK },
    ]);
    expect(record?.index_state.files_indexed).toBe(READY.filesIndexed);
    expect(FILES_ON_DISK).not.toBe(READY.filesIndexed);
    // Two reads, and the gate's decision came off the FIRST.
    expect(h.indexReads()).toBe(2);
  });

  it('a counter drifted past the ramp does not buy a bigger budget', async () => {
    // The failure this pins is invisible to every other test: the counter climbs
    // with use, so the same repository would silently cost more over time.
    const drifted = { ...READY, filesIndexed: 40_000 };
    const h = harness({ index: drifted, indexAfter: drifted });
    await h.service.generate(WORKSPACE, REPO_ID, silentLog);

    expect(h.inputs()).toEqual([
      { workspaceId: WORKSPACE, repo: REPO, filesIndexed: FILES_ON_DISK },
    ]);
  });

  /**
   * AC-74. Two people press Generate on one repository within the same second;
   * one model call is made and both are handed its result. The key is `repoId`
   * ALONE — there is one row per repo, so two runs on different shas would race
   * to write the same row.
   */
  it('two concurrent generations make ONE call and receive the same record', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const h = harness({
      run: async () => {
        await gate;
        return RESULT;
      },
    });

    const both = Promise.all([
      h.service.generate(WORKSPACE, REPO_ID, silentLog),
      h.service.generate(WORKSPACE, REPO_ID, silentLog),
    ]);
    release();
    const [first, second] = await both;

    expect(h.runs()).toBe(1);
    expect(first).toBe(second);
    expect(h.upserts()).toHaveLength(1);
  });

  it('the lock is released, so a later generation still runs', async () => {
    const h = harness();
    await h.service.generate(WORKSPACE, REPO_ID, silentLog);
    await h.service.generate(WORKSPACE, REPO_ID, silentLog);
    expect(h.runs()).toBe(2);
  });

  /** AC-51 / AC-60: a failed generation writes NOTHING, so the stored tour survives. */
  it('a generator that throws leaves upsert uncalled and answers external_service_error', async () => {
    const h = harness({
      run: async () => {
        throw new Error('the model returned nonsense three times');
      },
    });
    const err = await h.service
      .generate(WORKSPACE, REPO_ID, silentLog)
      .then(() => null, (e: AppError) => e);

    expect(err?.code).toBe('external_service_error');
    expect(err?.statusCode).toBe(502);
    expect(err?.message).toMatch(/nonsense/);
    expect(h.upserts()).toHaveLength(0);
  });

  /**
   * AC-53. "No key for the provider this feature is pointed at" is a first-class
   * state with its own copy and its own link to Settings; flattening it into a
   * 502 turns the one fault a user can fix into the one they cannot diagnose.
   */
  it('a ConfigError propagates as ITSELF, not wrapped', async () => {
    const h = harness({
      run: async () => {
        throw new ConfigError('OPENROUTER_API_KEY is not configured');
      },
    });
    const err = await h.service
      .generate(WORKSPACE, REPO_ID, silentLog)
      .then(() => null, (e: AppError) => e);

    expect(err).toBeInstanceOf(ConfigError);
    expect(err?.code).toBe('config_error');
    expect(err?.statusCode).toBe(500);
    expect(h.upserts()).toHaveLength(0);
  });
});

describe('onboarding service — staleness is reported, never acted on (R5)', () => {
  it('an index that has moved past the tour flips stale and starts nothing', async () => {
    const stored = { ...DRAFT, index_state: READY_STAMP, generated_at: 'then' } as OnboardingRecord;
    const h = harness({ stored, index: { ...READY, lastIndexedSha: 'ffff0000' } });
    const page = await h.service.page(WORKSPACE, REPO_ID, silentLog);

    expect(page?.stale).toBe(true);
    expect(page?.generate_blocked).toBeNull();
    expect(page?.tour).not.toBeNull();
    // The whole point: seeing it does not spend anything.
    expect(h.runs()).toBe(0);
  });
});

/**
 * A reindex that lands INSIDE the generation window.
 *
 * `repo-intel/pipeline/full.ts` deletes every symbol and reference for the repo
 * (`deleteAllForRepo`) long before it writes the new state row, so a generation
 * that passed the gate at T0 and assembles its input between those two writes
 * reads an EMPTIED index. Stamping the thin tour it produced with the state the
 * gate approved is what makes the damage invisible: for a resync on the same
 * HEAD that state is identical to the current one, `stale` stays false, and the
 * thin tour looks freshly generated to everyone who opens it.
 *
 * The price is named rather than hidden — the model call is already paid for
 * when this is discovered, and it is thrown away (human decision, 2026-08-18).
 */
describe('onboarding service — the index moved under a running generation', () => {
  const LATER = new Date('2026-08-18T09:02:00.000Z');

  it('a resync on the SAME HEAD is caught — nothing is written and the answer is 409', async () => {
    // `lastIndexedSha` is deliberately unchanged here: this is precisely the
    // case a sha comparison misses, and the only one whose damage is silent.
    const h = harness({ index: READY, indexAfter: { ...READY, updatedAt: LATER } });

    const err = await h.service
      .generate(WORKSPACE, REPO_ID, silentLog)
      .then(() => null, (e: AppError) => e);

    expect(err?.code).toBe('onboarding_index_changed');
    expect(err?.statusCode).toBe(409);
    expect(err?.message).toMatch(/again/i);
    expect(h.upserts()).toHaveLength(0);
    // The refusal is post-spend BY NATURE: the generation ran and is discarded.
    expect(h.runs()).toBe(1);
  });

  it('an index that advanced to a new sha is refused the same way', async () => {
    const h = harness({
      index: READY,
      indexAfter: { ...READY, lastIndexedSha: 'ffff0000', updatedAt: LATER },
    });

    const err = await h.service
      .generate(WORKSPACE, REPO_ID, silentLog)
      .then(() => null, (e: AppError) => e);

    expect(err?.code).toBe('onboarding_index_changed');
    expect(err?.statusCode).toBe(409);
    expect(h.upserts()).toHaveLength(0);
  });

  it('an index that did not move is written, and the state was read on BOTH sides', async () => {
    const h = harness();
    const record = await h.service.generate(WORKSPACE, REPO_ID, silentLog);

    expect(h.upserts()).toEqual([record]);
    expect(record?.index_state).toEqual(READY_STAMP);
    // Two reads — the gate and the re-check. One of them would leave the window open.
    expect(h.indexReads()).toBe(2);
  });
});
