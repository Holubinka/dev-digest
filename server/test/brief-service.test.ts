/**
 * P2 step 6 — `BriefService`, against fakes. No Postgres, no LLM, no Docker.
 *
 * `BriefService` takes its container and its repository as constructor
 * parameters and its logger per call, so the whole path runs on three object
 * literals and no composition root at all. The ports are
 * declared structurally in `types.ts` NAMING ONLY THE READ HALF — there is no
 * `derive` on the intent port and no `summarize` on the blast one — so "exactly
 * one model call" is partly enforced by the type system and asserted here on top
 * of that (R16, R41, R43, R45).
 */
import { describe, it, expect, vi } from 'vitest';
import type {
  BlastRadiusView,
  IntentRecord,
  RiskBrief,
  RiskBriefInput,
  StructuredRequest,
  StructuredResult,
} from '@devdigest/shared';
import { BriefService } from '../src/modules/brief/service.js';
import type {
  BriefContainer,
  BriefDiffStats,
  BriefPull,
  BriefReads,
  BriefValues,
} from '../src/modules/brief/types.js';
import type { PrBriefRow } from '../src/db/rows.js';
import { ConfigError } from '../src/platform/errors.js';
import {
  BRIEF_MAX_RETRIES,
  BRIEF_TIMEOUT_MS,
  BRIEF_TOKEN_BUDGET,
} from '../src/modules/brief/constants.js';

const WS = 'ws-1';
const PR = 'pr-1';
const HEAD = 'de50d5c364fb';

const PULL: BriefPull = {
  id: PR,
  repoId: 'repo-1',
  headSha: HEAD,
  title: 'Add the Risk Brief',
  body: 'Briefs a reviewer. Plan: `plans/10.md`',
  linkedIssue: null,
};

const INTENT: IntentRecord = {
  intent: 'Briefs a reviewer before they open the diff.',
  in_scope: ['the brief module'],
  out_of_scope: ['a second model call'],
  risk_areas: ['public API'],
  confidence: 'high',
  evidence: ['title', 'body'],
  plan_refs: ['plans/10.md'],
  provider: 'openai',
  model: 'gpt-4.1',
  computed_at: '2026-08-16T09:00:00.000Z',
};

function blast(over: Partial<BlastRadiusView> = {}): BlastRadiusView {
  return {
    status: 'full',
    reason: null,
    repo_full_name: 'Holubinka/dev-digest',
    head_sha: HEAD,
    link_sha: HEAD,
    index_matches_head: true,
    changed_files: ['server/src/modules/brief/service.ts'],
    symbols: [],
    totals: { symbols: 0, callers: 0, endpoints: 0, crons: 0 },
    summary: null,
    ...over,
  };
}

const ANSWER: RiskBrief = {
  what: 'Adds a per-state risk brief.',
  why: 'Reviewers open a PR cold.',
  risk_level: 'medium',
  risks: [
    {
      kind: 'public API',
      title: 'A new paid route',
      explanation: 'It spends money on a POST.',
      severity: 'medium',
      file_refs: ['server/src/modules/brief/service.ts'],
    },
  ],
  review_focus: [
    { ref: 'server/src/modules/brief/service.ts', kind: 'file', reason: 'the budget walk' },
  ],
};

/** A row exactly as Postgres would hand it back, built from what the service wrote. */
function rowFrom(prId: string, headSha: string, values: BriefValues): PrBriefRow {
  return {
    prId,
    headSha,
    what: values.what,
    why: values.why,
    riskLevel: values.riskLevel,
    risks: values.risks,
    reviewFocus: values.reviewFocus,
    inputs: values.inputs,
    refLines: values.refLines,
    droppedRefs: values.droppedRefs,
    droppedRisks: values.droppedRisks,
    intentComputedAt: values.intentComputedAt,
    intentFreshness: values.intentFreshness,
    blastStatus: values.blastStatus,
    linkSha: values.linkSha,
    indexMatchesHead: values.indexMatchesHead,
    budget: values.budget,
    inputTokensCounted: values.inputTokensCounted,
    tokenizer: values.tokenizer,
    attempts: values.attempts,
    tokensIn: values.tokensIn,
    provider: values.provider,
    model: values.model,
    costUsd: values.costUsd,
    computedAt: new Date('2026-08-16T12:00:00.000Z'),
    evictedCount: 0,
  };
}

interface RepoOptions {
  pull?: BriefPull | undefined;
  stored?: PrBriefRow | undefined;
  headCommittedAt?: Date | null;
  diff?: BriefDiffStats;
  filePaths?: string[];
}

function fakeRepo(opts: RepoOptions = {}) {
  const writes: { headSha: string; values: BriefValues; maxStates: number }[] = [];
  const repo: BriefReads = {
    getPull: async () => ('pull' in opts ? opts.pull : PULL),
    getRepo: async () => ({ owner: 'Holubinka', name: 'dev-digest' }),
    getFilePaths: async () => opts.filePaths ?? ['server/src/modules/brief/service.ts'],
    getDiffStats: async () => opts.diff ?? { files: 1, additions: 10, deletions: 1 },
    getBriefFor: async () => opts.stored,
    getHeadCommittedAt: async () => opts.headCommittedAt ?? null,
    upsertBrief: async (prId, headSha, values, maxStates) => {
      writes.push({ headSha, values, maxStates });
      return rowFrom(prId, headSha, values);
    },
  };
  return { repo, writes };
}

interface LlmOptions {
  answer?: RiskBrief;
  attempts?: number;
  tokensIn?: number;
  costUsd?: number | null;
  /** Never resolves — the R43 case. */
  hang?: boolean;
  throws?: Error;
}

function fakeLlm(opts: LlmOptions = {}) {
  const calls: StructuredRequest<unknown>[] = [];
  const provider = {
    id: 'openai' as const,
    listModels: async () => [],
    complete: async () => {
      throw new Error('complete() must never be called on this path');
    },
    completeStructured: (async (req: StructuredRequest<unknown>) => {
      calls.push(req);
      if (opts.throws) throw opts.throws;
      if (opts.hang) return new Promise(() => {});
      return {
        data: opts.answer ?? ANSWER,
        model: req.model,
        tokensIn: opts.tokensIn ?? 1234,
        tokensOut: 200,
        costUsd: opts.costUsd ?? 0.004,
        raw: '{}',
        attempts: opts.attempts ?? 1,
      } as StructuredResult<unknown>;
    }) as never,
    embed: async () => [],
  };
  return { provider, calls };
}

interface ContainerOptions {
  intent?: IntentRecord | null;
  blastView?: BlastRadiusView | undefined;
  tokenizerId?: 'cl100k_base' | 'heuristic';
  llm?: ReturnType<typeof fakeLlm>['provider'];
  llmThrows?: Error;
  specs?: Record<string, string>;
}

function fakeContainer(opts: ContainerOptions = {}) {
  const derive = vi.fn();
  const summarize = vi.fn();
  const container = {
    settingsRepo: { value: async () => null },
    git: {
      readFile: async (_repo: unknown, path: string) => {
        const text = opts.specs?.[path];
        if (text === undefined) throw new Error(`not in the clone: ${path}`);
        return text;
      },
    },
    prompts: { render: async () => 'SYSTEM PROMPT' },
    tokenizer: { count: (t: string) => t.length, id: opts.tokenizerId ?? 'cl100k_base' },
    // `derive` and `summarize` are present on the FAKES so the assertions below
    // can prove they are never called. They are absent from the PORT types, so
    // the service could not call them even if it tried.
    intentService: { get: async () => opts.intent ?? null, derive },
    blastService: { getBlast: async () => opts.blastView, summarize },
    llm: async () => {
      if (opts.llmThrows) throw opts.llmThrows;
      return opts.llm;
    },
  } as unknown as BriefContainer;
  return { container, derive, summarize };
}

function fakeLog() {
  const warn = vi.fn();
  return { log: { warn }, warn };
}

function byId(inputs: RiskBriefInput[]): Record<string, RiskBriefInput> {
  return Object.fromEntries(inputs.map((row) => [row.id, row])) as Record<string, RiskBriefInput>;
}

describe('BriefService.get — the pure read (R28, R31)', () => {
  it('returns undefined for a PR outside the workspace, with no LLM resolved', async () => {
    const llm = fakeLlm();
    const { container } = fakeContainer({ llm: llm.provider });
    const { repo } = fakeRepo({ pull: undefined });
    const service = new BriefService(container, repo);

    expect(await service.get(WS, PR)).toBeUndefined();
    expect(llm.calls).toHaveLength(0);
  });

  it('returns null when nothing has been computed for the current head', async () => {
    const { container } = fakeContainer();
    const { repo } = fakeRepo({ stored: undefined });
    expect(await new BriefService(container, repo).get(WS, PR)).toBeNull();
  });

  it('serves a stored record with ZERO model calls, however many times it is read (R28)', async () => {
    const llm = fakeLlm();
    const { container } = fakeContainer({ llm: llm.provider });
    const values = (
      await (async () => {
        const first = fakeRepo();
        const svc = new BriefService(
          fakeContainer({ llm: fakeLlm().provider }).container,
          first.repo,
        );
        await svc.compute(WS, PR, fakeLog().log);
        return first.writes[0]!.values;
      })()
    );
    const { repo } = fakeRepo({ stored: rowFrom(PR, HEAD, values) });
    const service = new BriefService(container, repo);

    for (let i = 0; i < 5; i += 1) {
      const record = await service.get(WS, PR);
      expect(record?.what).toBe(ANSWER.what);
      expect(record?.head_sha).toBe(HEAD);
    }
    expect(llm.calls).toHaveLength(0);
  });
});

describe('BriefService.compute — exactly one call, and what it records', () => {
  it('makes exactly one completeStructured, with the schema, retries and timeout of the plan', async () => {
    const llm = fakeLlm();
    const { container, derive, summarize } = fakeContainer({ llm: llm.provider, intent: INTENT });
    const { repo } = fakeRepo();
    const out = await new BriefService(container, repo).compute(WS, PR, fakeLog().log);

    expect(out.ok).toBe(true);
    expect(llm.calls).toHaveLength(1);
    expect(llm.calls[0]!.schemaName).toBe('RiskBrief');
    expect(llm.calls[0]!.maxRetries).toBe(BRIEF_MAX_RETRIES);
    expect(llm.calls[0]!.maxRetries).toBe(1);
    expect(llm.calls[0]!.timeoutMs).toBe(BRIEF_TIMEOUT_MS);
    expect(llm.calls[0]!.timeoutMs).toBe(45_000);
    expect(llm.calls[0]!.reasoning).toBe(false);
    // No intent derivation, no blast summary — one paid call per computation.
    expect(derive).not.toHaveBeenCalled();
    expect(summarize).not.toHaveBeenCalled();
  });

  it('records the four separate numbers, copying attempts and tokens_in off the result (R19)', async () => {
    const llm = fakeLlm({ attempts: 2, tokensIn: 4321, costUsd: 0.0099 });
    const { container } = fakeContainer({ llm: llm.provider });
    const { repo, writes } = fakeRepo();
    const out = await new BriefService(container, repo).compute(WS, PR, fakeLog().log);
    if (!out.ok) throw new Error(out.reason);

    expect(out.record.budget).toBe(BRIEF_TOKEN_BUDGET);
    expect(out.record.input_tokens_counted).toBeGreaterThan(0);
    expect(out.record.input_tokens_counted).toBeLessThanOrEqual(BRIEF_TOKEN_BUDGET);
    expect(out.record.attempts).toBe(2);
    expect(out.record.tokens_in).toBe(4321);
    expect(out.record.cost_usd).toBe(0.0099);
    expect(out.record.tokenizer).toBe('cl100k_base');
    // Our count and the provider's are different numbers measured by different
    // counters, and the record keeps both rather than reconciling them.
    expect(out.record.input_tokens_counted).not.toBe(out.record.tokens_in);
    expect(writes[0]!.values.inputTokensCounted).toBe(out.record.input_tokens_counted);
  });

  it('no intent → still computes, inputs says intent: missing, still ONE call (R21)', async () => {
    const llm = fakeLlm();
    const { container, derive } = fakeContainer({ llm: llm.provider, intent: null });
    const { repo } = fakeRepo();
    const out = await new BriefService(container, repo).compute(WS, PR, fakeLog().log);
    if (!out.ok) throw new Error(out.reason);

    expect(byId(out.record.inputs).intent?.status).toBe('missing');
    expect(byId(out.record.inputs).intent?.detail).toContain('no intent');
    expect(out.record.intent_computed_at).toBeNull();
    expect(out.record.intent_freshness).toBe('unknown');
    expect(llm.calls).toHaveLength(1);
    expect(derive).not.toHaveBeenCalled();
  });

  it('blast degraded → still computes, and the record carries the status (R22, R24, R26, R27)', async () => {
    const llm = fakeLlm();
    const { container } = fakeContainer({
      llm: llm.provider,
      blastView: blast({
        status: 'degraded',
        reason: 'the repository is not indexed',
        link_sha: null,
        index_matches_head: false,
        changed_files: [],
      }),
    });
    const { repo } = fakeRepo();
    const out = await new BriefService(container, repo).compute(WS, PR, fakeLog().log);
    if (!out.ok) throw new Error(out.reason);

    expect(out.record.blast_status).toBe('degraded');
    expect(out.record.link_sha).toBeNull();
    expect(out.record.index_matches_head).toBe(false);
    expect(byId(out.record.inputs).blast?.status).toBe('included');
    expect(llm.calls).toHaveLength(1);
  });

  /**
   * P2 step 5. The line numbers on a blast answer were recorded against
   * `link_sha` and are true at that commit and no other, so a stale index stores
   * NO number rather than a number the card would have to remember to hide. The
   * pair is written together on purpose: without the fresh case the stale one
   * passes for a feature that never derives anything at all (R16).
   */
  it('a fresh index persists the line the blast answer carried (R14)', async () => {
    const { container } = fakeContainer({
      llm: fakeLlm().provider,
      blastView: blast({
        symbols: [
          {
            name: 'run',
            kind: 'method',
            file: 'server/src/modules/brief/service.ts',
            line: 128,
            callers: [],
            caller_count: 0,
            truncated: false,
            endpoints: [],
            endpoint_count: 0,
            endpoints_truncated: false,
          },
        ],
      }),
    });
    const { repo, writes } = fakeRepo();
    const out = await new BriefService(container, repo).compute(WS, PR, fakeLog().log);
    if (!out.ok) throw new Error(out.reason);

    expect(out.record.index_matches_head).toBe(true);
    expect(writes[0]!.values.refLines).toEqual([
      { ref: 'server/src/modules/brief/service.ts', line: 128, source: 'blast_symbol' },
    ]);
    expect(out.record.ref_lines).toEqual(writes[0]!.values.refLines);
  });

  it('a stale index persists ref_lines: [] for the same answer (R16)', async () => {
    const { container } = fakeContainer({
      llm: fakeLlm().provider,
      blastView: blast({
        index_matches_head: false,
        link_sha: 'an-older-commit',
        symbols: [
          {
            name: 'run',
            kind: 'method',
            file: 'server/src/modules/brief/service.ts',
            line: 128,
            callers: [],
            caller_count: 0,
            truncated: false,
            endpoints: [],
            endpoint_count: 0,
            endpoints_truncated: false,
          },
        ],
      }),
    });
    const { repo, writes } = fakeRepo();
    const out = await new BriefService(container, repo).compute(WS, PR, fakeLog().log);
    if (!out.ok) throw new Error(out.reason);

    // The reference itself survives — it is still a name the model was shown.
    expect(out.record.risks[0]!.file_refs).toEqual(['server/src/modules/brief/service.ts']);
    expect(writes[0]!.values.refLines).toEqual([]);
    expect(out.record.ref_lines).toEqual([]);
  });

  it('no blast answer at all → computed, blast reported missing', async () => {
    const llm = fakeLlm();
    const { container, summarize } = fakeContainer({ llm: llm.provider, blastView: undefined });
    const { repo } = fakeRepo();
    const out = await new BriefService(container, repo).compute(WS, PR, fakeLog().log);
    if (!out.ok) throw new Error(out.reason);

    expect(byId(out.record.inputs).blast?.status).toBe('missing');
    expect(out.record.blast_status).toBe('degraded');
    expect(summarize).not.toHaveBeenCalled();
  });

  it('a heuristic tokenizer is recorded AND announced at warning level (R19, R44)', async () => {
    const llm = fakeLlm();
    const { container } = fakeContainer({ llm: llm.provider, tokenizerId: 'heuristic' });
    const { repo } = fakeRepo();
    const { log, warn } = fakeLog();
    const out = await new BriefService(container, repo).compute(WS, PR, log);
    if (!out.ok) throw new Error(out.reason);

    expect(out.record.tokenizer).toBe('heuristic');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toMatchObject({ prId: PR, headSha: HEAD });
    expect(String(warn.mock.calls[0]![1])).toMatch(/heuristic/i);
  });

  it('an encoder-backed tokenizer warns about nothing', async () => {
    const { container } = fakeContainer({ llm: fakeLlm().provider, tokenizerId: 'cl100k_base' });
    const { repo } = fakeRepo();
    const { log, warn } = fakeLog();
    await new BriefService(container, repo).compute(WS, PR, log);
    expect(warn).not.toHaveBeenCalled();
  });

  /**
   * The card computes on an empty read, so two tabs on one fresh state is the
   * ordinary case rather than the corner one. One call, one answer, both readers
   * get it.
   */
  it('two concurrent computes on one (prId, headSha) make ONE call (R45)', async () => {
    const llm = fakeLlm();
    const { container } = fakeContainer({ llm: llm.provider });
    const { repo, writes } = fakeRepo();
    const service = new BriefService(container, repo);

    const [a, b] = await Promise.all([
      service.compute(WS, PR, fakeLog().log),
      service.compute(WS, PR, fakeLog().log),
    ]);
    expect(llm.calls).toHaveLength(1);
    expect(writes).toHaveLength(1);
    expect(a).toEqual(b);
  });

  it('a later compute after the first settled makes a second call — the lock is not a cache', async () => {
    const llm = fakeLlm();
    const { container } = fakeContainer({ llm: llm.provider });
    const { repo } = fakeRepo();
    const service = new BriefService(container, repo);

    await service.compute(WS, PR, fakeLog().log);
    await service.compute(WS, PR, fakeLog().log);
    expect(llm.calls).toHaveLength(2);
  });

  it('grounds the model answer against the prompt inventory before persisting (R13, R14)', async () => {
    const llm = fakeLlm({
      answer: {
        ...ANSWER,
        risks: [
          { ...ANSWER.risks[0]!, file_refs: ['server/src/modules/brief/service.ts'] },
          { ...ANSWER.risks[0]!, title: 'invented', file_refs: ['src/never/printed.ts'] },
        ],
        review_focus: [
          ...ANSWER.review_focus,
          { ref: 'src/also/invented.ts', kind: 'file', reason: 'nope' },
        ],
      },
    });
    const { container } = fakeContainer({ llm: llm.provider });
    const { repo } = fakeRepo();
    const out = await new BriefService(container, repo).compute(WS, PR, fakeLog().log);
    if (!out.ok) throw new Error(out.reason);

    expect(out.record.risks.map((r) => r.title)).toEqual(['A new paid route']);
    expect(out.record.dropped_risks).toBe(1);
    expect(out.record.dropped_refs.sort()).toEqual([
      'src/also/invented.ts',
      'src/never/printed.ts',
    ]);
    expect(out.record.review_focus).toHaveLength(1);
  });

  /**
   * The same rule as `brief-allowed-refs.test.ts`, but end to end: the blast
   * block is gathered and then DROPPED by the budget, so `src/only/in/blast.ts`
   * never reaches the model — and a reference to it must be rejected rather than
   * stamped as grounded. This is the case that separates "the set is the
   * prompt's inventory" from "the set is what we considered sending".
   */
  it('a reference from a block the budget dropped is rejected end to end (R13)', async () => {
    // 40 paths of 200 characters, against a `count: s => s.length` fake and an
    // 8000 budget: the diff-stats block alone fills it, so everything droppable
    // is dropped.
    const filePaths = Array.from({ length: 40 }, (_, i) => `src/${'x'.repeat(190)}${i}.ts`);
    const llm = fakeLlm({
      answer: {
        ...ANSWER,
        risks: [{ ...ANSWER.risks[0]!, file_refs: ['src/only/in/blast.ts'] }],
        review_focus: [{ ref: 'src/only/in/blast.ts', kind: 'file', reason: 'a caller' }],
      },
    });
    const { container } = fakeContainer({
      llm: llm.provider,
      blastView: blast({
        symbols: [
          {
            name: 'thing',
            kind: 'function',
            file: 'src/changed.ts',
            line: 1,
            callers: [{ file: 'src/only/in/blast.ts', symbol: 'caller', line: 2, rank: 1 }],
            caller_count: 1,
            truncated: false,
            endpoints: [],
            endpoint_count: 0,
            endpoints_truncated: false,
          },
        ],
      }),
    });
    const { repo } = fakeRepo({ filePaths, diff: { files: 40, additions: 1, deletions: 1 } });
    const out = await new BriefService(container, repo).compute(WS, PR, fakeLog().log);
    if (!out.ok) throw new Error(out.reason);

    expect(byId(out.record.inputs).blast?.status).toBe('dropped');
    expect(out.record.risks).toEqual([]);
    expect(out.record.dropped_risks).toBe(1);
    expect(out.record.review_focus).toEqual([]);
    expect(out.record.dropped_refs).toEqual(['src/only/in/blast.ts']);
  });

  it('reads linked spec files through the git port and reports them as an input', async () => {
    const llm = fakeLlm();
    const { container } = fakeContainer({
      llm: llm.provider,
      specs: { 'plans/10.md': 'The plan body.' },
    });
    const { repo } = fakeRepo();
    const out = await new BriefService(container, repo).compute(WS, PR, fakeLog().log);
    if (!out.ok) throw new Error(out.reason);

    expect(byId(out.record.inputs).specs?.status).toBe('included');
    expect(byId(out.record.inputs).specs?.detail).toContain('plans/10.md');
  });

  it('a spec that is not in the clone is missing, not a failure', async () => {
    const llm = fakeLlm();
    const { container } = fakeContainer({ llm: llm.provider, specs: {} });
    const { repo } = fakeRepo();
    const out = await new BriefService(container, repo).compute(WS, PR, fakeLog().log);
    if (!out.ok) throw new Error(out.reason);

    expect(byId(out.record.inputs).specs?.status).toBe('missing');
    expect(llm.calls).toHaveLength(1);
  });

  it('reports every one of the six inputs, in the contract order (R33)', async () => {
    const { container } = fakeContainer({ llm: fakeLlm().provider, intent: INTENT });
    const { repo } = fakeRepo();
    const out = await new BriefService(container, repo).compute(WS, PR, fakeLog().log);
    if (!out.ok) throw new Error(out.reason);

    expect(out.record.inputs.map((row) => row.id)).toEqual([
      'diff_stats',
      'intent',
      'blast',
      'pr_text',
      'linked_issue',
      'specs',
    ]);
  });

  it('derives intent freshness from the head commit date, not from a guess (R25)', async () => {
    const { container } = fakeContainer({ llm: fakeLlm().provider, intent: INTENT });
    const { repo } = fakeRepo({ headCommittedAt: new Date('2026-08-16T10:00:00.000Z') });
    const out = await new BriefService(container, repo).compute(WS, PR, fakeLog().log);
    if (!out.ok) throw new Error(out.reason);

    expect(out.record.intent_computed_at).toBe(INTENT.computed_at);
    expect(out.record.intent_freshness).toBe('stale');
  });

  it('an intent with no pr_commits row for the head is unknown, never fresh (R25)', async () => {
    const { container } = fakeContainer({ llm: fakeLlm().provider, intent: INTENT });
    const { repo } = fakeRepo({ headCommittedAt: null });
    const out = await new BriefService(container, repo).compute(WS, PR, fakeLog().log);
    if (!out.ok) throw new Error(out.reason);
    expect(out.record.intent_freshness).toBe('unknown');
  });
});

describe('BriefService.compute — failure (R31, R42, R43)', () => {
  it('a PR outside the workspace fails before any provider is resolved (R31)', async () => {
    const llm = fakeLlm();
    const { container } = fakeContainer({ llm: llm.provider });
    const { repo, writes } = fakeRepo({ pull: undefined });
    const out = await new BriefService(container, repo).compute(WS, PR, fakeLog().log);

    expect(out).toEqual({ ok: false, reason: 'Pull request not found' });
    expect(llm.calls).toHaveLength(0);
    expect(writes).toHaveLength(0);
  });

  it('an exhausted schema repair is a result, not a throw, and writes nothing', async () => {
    const llm = fakeLlm({ throws: new Error('fixture failed schema') });
    const { container } = fakeContainer({ llm: llm.provider });
    const { repo, writes } = fakeRepo();
    const out = await new BriefService(container, repo).compute(WS, PR, fakeLog().log);

    expect(out.ok).toBe(false);
    expect(out.ok === false && out.reason).toMatch(/fixture failed schema/);
    expect(writes).toHaveLength(0);
  });

  /**
   * R42. `risk_brief` defaults to OpenAI and a fresh install has no OpenAI key,
   * so this is the out-of-the-box state, not an edge. It has to reach the route
   * as a `ConfigError` — flattening it into a 502 turns the one failure the user
   * can fix into the one they cannot diagnose.
   */
  it('a ConfigError from the provider propagates as itself, not as a business failure', async () => {
    const { container } = fakeContainer({
      llmThrows: new ConfigError('OPENAI_API_KEY is not configured'),
    });
    const { repo, writes } = fakeRepo();
    const service = new BriefService(container, repo);

    await expect(service.compute(WS, PR, fakeLog().log)).rejects.toBeInstanceOf(ConfigError);
    expect(writes).toHaveLength(0);
  });

  it('an LLM that never resolves is abandoned by the outer clock, and nothing is written (R43)', async () => {
    vi.useFakeTimers();
    try {
      const llm = fakeLlm({ hang: true });
      const { container } = fakeContainer({ llm: llm.provider });
      const { repo, writes } = fakeRepo();
      const pending = new BriefService(container, repo).compute(WS, PR, fakeLog().log);

      // Let the gather and the assembly settle, then run the clock past the
      // named timeout. `timeoutMs` on the request bounds one HTTP call and
      // OpenRouter ignores it entirely, so this outer clock is the real bound.
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(BRIEF_TIMEOUT_MS + 1000);

      const out = await pending;
      expect(out.ok).toBe(false);
      expect(out.ok === false && out.reason).toMatch(/timed out/i);
      expect(writes).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a failed compute releases the single-flight slot, so a retry really retries', async () => {
    const failing = fakeLlm({ throws: new Error('transient') });
    const { container } = fakeContainer({ llm: failing.provider });
    const { repo } = fakeRepo();
    const service = new BriefService(container, repo);

    expect((await service.compute(WS, PR, fakeLog().log)).ok).toBe(false);
    expect((await service.compute(WS, PR, fakeLog().log)).ok).toBe(false);
    expect(failing.calls).toHaveLength(2);
  });
});
