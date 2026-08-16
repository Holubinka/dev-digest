/**
 * P2 steps 2, 4 and 5 — **a line number is derived by code or it does not exist**
 * (R12, R14, R15, R16).
 *
 * The model is shown no line and has no field to return one in, so every number a
 * reader will see comes off the blast answer the server already computed. Which
 * makes three things load-bearing, and this file is each of them:
 *
 *  - WHICH number a path gets, when the block prints more than one fact about it;
 *  - WHICH references get one at all — a blast fact, never a changed file, never a
 *    spec path, never an endpoint label, and never anything past the caps or out
 *    of a block the budget dropped;
 *  - WHEN the whole list is thrown away — a number recorded at `link_sha` is true
 *    at that commit and at no other.
 *
 * NEGATIVE CONTROLS, each run on 2026-08-16 and each failing exactly the case
 * named beside it:
 *
 *   - drop the `!refLines.has(ref)` guard in `blastBlock`, so the LAST occurrence
 *     wins → both ordering cases fail;
 *   - `buildRefLines(buildBlocks(sources))` in `service.ts` instead of
 *     `fit.included` → only the changed-files case fails. It is the only fixture
 *     here where a reference outlives the block that carried its number, which is
 *     why that case exists at all;
 *   - delete `indexMatchesHead &&` from the gate → the stale-index case fails;
 *     delete `linkSha !== null` → the null-link case fails. Neither half is
 *     redundant and one fixture proves each;
 *   - delete the `groundedRefs` filter → the survivor case fails.
 */
import { describe, it, expect } from 'vitest';
import type {
  BlastRadiusView,
  BlastSymbol,
  RiskBrief,
  RiskBriefRefLine,
  StructuredRequest,
} from '@devdigest/shared';
import {
  buildAllowedRefs,
  buildBlocks,
  buildRefLines,
  fitToBudget,
} from '../src/modules/brief/helpers.js';
import { BriefService } from '../src/modules/brief/service.js';
import type {
  BriefContainer,
  BriefReads,
  BriefSources,
  BriefValues,
} from '../src/modules/brief/types.js';
import type { PrBriefRow } from '../src/db/rows.js';
import { MAX_BLAST_CALLERS, MAX_BLAST_SYMBOLS } from '../src/modules/brief/constants.js';

const count = (text: string) => text.length;

function symbol(over: Partial<BlastSymbol> = {}): BlastSymbol {
  return {
    name: 'thing',
    kind: 'function',
    file: 'src/thing.ts',
    line: 1,
    callers: [],
    caller_count: 0,
    truncated: false,
    endpoints: [],
    endpoint_count: 0,
    endpoints_truncated: false,
    ...over,
  };
}

function view(over: Partial<BlastRadiusView> = {}): BlastRadiusView {
  return {
    status: 'full',
    reason: null,
    repo_full_name: 'Holubinka/dev-digest',
    head_sha: 'aaa',
    link_sha: 'aaa',
    index_matches_head: true,
    changed_files: [],
    symbols: [],
    totals: { symbols: 1, callers: 1, endpoints: 1, crons: 0 },
    summary: null,
    ...over,
  };
}

function sources(blast: BlastRadiusView | null, over: Partial<BriefSources> = {}): BriefSources {
  return {
    title: 'A change',
    body: null,
    linkedIssue: null,
    intent: null,
    blast,
    diff: { files: 1, additions: 1, deletions: 0 },
    filePaths: ['src/changed.ts'],
    specs: [],
    ...over,
  };
}

/** The derivation exactly as `run()` does it: blocks → budget → the survivors. */
function fitFor(src: BriefSources, budget = 100_000) {
  return fitToBudget(buildBlocks(src), 0, budget, count);
}

function linesFor(blast: BlastRadiusView, budget = 100_000): Record<string, RiskBriefRefLine> {
  const lines = buildRefLines(fitFor(sources(blast), budget).included);
  return Object.fromEntries(lines.map((entry) => [entry.ref, entry]));
}

describe('buildRefLines — which fact the number comes off (R14)', () => {
  /**
   * The block prints symbol 0, then its callers, then symbol 1. `src/shared.ts`
   * appears first as a CALLER, so the caller's line is the one a reader sees —
   * the rule is the printed order, not a ranking of the three sources.
   */
  it('the first occurrence of a path wins: a caller printed before the symbol keeps the caller line', () => {
    const lines = linesFor(
      view({
        symbols: [
          symbol({
            name: 'api',
            file: 'src/api.ts',
            line: 10,
            callers: [{ file: 'src/shared.ts', symbol: 'callsApi', line: 9, rank: 80 }],
            caller_count: 1,
          }),
          symbol({ name: 'shared', file: 'src/shared.ts', line: 100 }),
        ],
      }),
    );

    expect(lines['src/shared.ts']).toEqual({
      ref: 'src/shared.ts',
      line: 9,
      source: 'blast_caller',
    });
    expect(lines['src/api.ts']).toEqual({ ref: 'src/api.ts', line: 10, source: 'blast_symbol' });
  });

  /** The converse of the same rule, so a passing pair cannot mean "symbols always win". */
  it('and the symbol line when the symbol is printed first', () => {
    const lines = linesFor(
      view({
        symbols: [
          symbol({ name: 'shared', file: 'src/shared.ts', line: 100 }),
          symbol({
            name: 'api',
            file: 'src/api.ts',
            line: 10,
            callers: [{ file: 'src/shared.ts', symbol: 'callsApi', line: 9, rank: 80 }],
            caller_count: 1,
          }),
        ],
      }),
    );

    expect(lines['src/shared.ts']).toEqual({
      ref: 'src/shared.ts',
      line: 100,
      source: 'blast_symbol',
    });
  });

  /**
   * An endpoint label is a member of the allowed set — a focus item may name
   * `POST /pulls/:id/brief` — and it is not a path. `POST /pulls/:id/brief:45` is
   * not a thing that exists, so the label gets no entry while the FILE the
   * endpoint sits in gets one.
   */
  it('an endpoint label is an allowed reference with no line; its file gets one', () => {
    const fit = fitFor(
      sources(
        view({
          symbols: [
            symbol({
              file: 'src/api.ts',
              line: 3,
              endpoints: [
                {
                  label: 'POST /pulls/:id/brief',
                  file: 'src/route.ts',
                  line: 44,
                  depth: 0,
                  kind: 'http',
                },
              ],
              endpoint_count: 1,
            }),
          ],
        }),
      ),
    );
    const allowed = buildAllowedRefs(fit.included);
    const lines = buildRefLines(fit.included);

    expect(allowed.has('POST /pulls/:id/brief')).toBe(true);
    expect(lines.map((entry) => entry.ref)).not.toContain('POST /pulls/:id/brief');
    expect(lines).toContainEqual({ ref: 'src/route.ts', line: 44, source: 'blast_endpoint' });
  });

  /**
   * Not a hypothetical. Every one of the 125 endpoints in the real blast answer
   * for `Holubinka/dev-digest` PR #20 reports `line: 0` (measured 2026-08-16):
   * the indexer knows which file an endpoint sits in and not where. `path:0` is a
   * placeholder wearing a number — AC-62 wants a suffix only where the number is
   * valid — so the reference keeps its place and loses its line.
   */
  it('a fact whose indexed line is 0 contributes no entry, and its file stays an allowed ref', () => {
    const fit = fitFor(
      sources(
        view({
          symbols: [
            symbol({
              file: 'src/api.ts',
              line: 3,
              endpoints: [
                { label: 'GET /items', file: 'src/route.ts', line: 0, depth: 0, kind: 'http' },
              ],
              endpoint_count: 1,
            }),
          ],
        }),
      ),
    );

    expect(buildAllowedRefs(fit.included).has('src/route.ts')).toBe(true);
    expect(buildRefLines(fit.included).map((entry) => entry.ref)).toEqual(['src/api.ts']);
  });

  /** So the guard is per FACT, not per file: a later fact may still supply the number. */
  it('a later fact about the same file still supplies one', () => {
    const lines = linesFor(
      view({
        symbols: [
          symbol({
            name: 'api',
            file: 'src/api.ts',
            line: 3,
            endpoints: [
              { label: 'GET /items', file: 'src/route.ts', line: 0, depth: 0, kind: 'http' },
            ],
            endpoint_count: 1,
          }),
          symbol({ name: 'route', file: 'src/route.ts', line: 88 }),
        ],
      }),
    );

    expect(lines['src/route.ts']).toEqual({
      ref: 'src/route.ts',
      line: 88,
      source: 'blast_symbol',
    });
  });

  it('a symbol past MAX_BLAST_SYMBOLS contributes no line, exactly as it contributes no ref', () => {
    const symbols = Array.from({ length: MAX_BLAST_SYMBOLS + 2 }, (_, i) =>
      symbol({ name: `s${i}`, file: `src/s${i}.ts`, line: i + 1 }),
    );
    const fit = fitFor(sources(view({ symbols })));
    const allowed = buildAllowedRefs(fit.included);
    const lines = Object.fromEntries(
      buildRefLines(fit.included).map((entry) => [entry.ref, entry]),
    );

    expect(lines['src/s0.ts']).toEqual({ ref: 'src/s0.ts', line: 1, source: 'blast_symbol' });
    expect(lines[`src/s${MAX_BLAST_SYMBOLS - 1}.ts`]).toBeDefined();
    // The two lists cut at the same place, because they are filled in one loop.
    expect(lines[`src/s${MAX_BLAST_SYMBOLS}.ts`]).toBeUndefined();
    expect(allowed.has(`src/s${MAX_BLAST_SYMBOLS}.ts`)).toBe(false);
  });

  it('a caller past MAX_BLAST_CALLERS contributes no line either', () => {
    const callers = Array.from({ length: MAX_BLAST_CALLERS + 2 }, (_, j) => ({
      file: `src/c${j}.ts`,
      symbol: `c${j}`,
      line: j + 1,
      rank: 1,
    }));
    const fit = fitFor(
      sources(view({ symbols: [symbol({ callers, caller_count: callers.length })] })),
    );
    const allowed = buildAllowedRefs(fit.included);
    const lines = Object.fromEntries(
      buildRefLines(fit.included).map((entry) => [entry.ref, entry]),
    );

    expect(lines['src/c0.ts']).toEqual({ ref: 'src/c0.ts', line: 1, source: 'blast_caller' });
    expect(lines[`src/c${MAX_BLAST_CALLERS - 1}.ts`]).toBeDefined();
    expect(lines[`src/c${MAX_BLAST_CALLERS}.ts`]).toBeUndefined();
    expect(allowed.has(`src/c${MAX_BLAST_CALLERS}.ts`)).toBe(false);
  });
});

describe('buildRefLines — only the blocks that reached the prompt (R14, R15)', () => {
  const BLAST = view({
    symbols: [
      symbol({
        file: 'src/api.ts',
        line: 12,
        callers: [{ file: 'src/caller.ts', symbol: 'calls', line: 34, rank: 9 }],
        caller_count: 1,
      }),
    ],
  });

  /** The control: with room for everything, this same view does produce numbers. */
  it('an included blast block licenses its own lines', () => {
    expect(buildRefLines(fitFor(sources(BLAST)).included)).toHaveLength(2);
  });

  it('a blast block the budget DROPPED licenses no number, as it licenses no reference', () => {
    const blocks = buildBlocks(sources(BLAST));
    const diffTokens = count(blocks.find((b) => b.id === 'diff_stats')!.text);
    const fit = fitToBudget(blocks, 0, diffTokens + 10, count);

    expect(fit.inputs.find((row) => row.id === 'blast')?.status).toBe('dropped');
    expect(buildAllowedRefs(fit.included).has('src/caller.ts')).toBe(false);
    expect(buildRefLines(fit.included)).toEqual([]);
  });

  /**
   * The changed-file list and the spec files are the other half of the allowed
   * set, and neither knows an offset into anything. A reference admitted only
   * through them is shown with no number at all (R15) — there is no placeholder
   * and no `pr_files.patch` read to invent one.
   */
  it('diff-stats and spec blocks license references and NO numbers', () => {
    const fit = fitFor(
      sources(null, {
        filePaths: ['src/changed.ts', 'src/other.ts'],
        diff: { files: 2, additions: 3, deletions: 1 },
        specs: [{ path: 'plans/11.md', text: 'The plan body.' }],
      }),
    );

    expect(buildAllowedRefs(fit.included).size).toBe(3);
    expect(buildRefLines(fit.included)).toEqual([]);
  });
});

/* ------------------------------------------- the gate, where run() applies it */

const WS = 'ws-1';
const PR = 'pr-1';
const HEAD = 'a1b2c3d4e5f6';

/** Both refs are printed by the blast block below, so both survive grounding. */
const ANSWER: RiskBrief = {
  what: 'Adds a limiter.',
  why: 'The public API is unmetered.',
  risk_level: 'medium',
  risks: [
    {
      kind: 'public API',
      title: 'A new paid route',
      explanation: 'It spends money.',
      severity: 'medium',
      file_refs: ['src/api.ts'],
    },
  ],
  review_focus: [{ ref: 'src/caller.ts', kind: 'file', reason: 'the call site' }],
};

function gateBlast(over: Partial<BlastRadiusView> = {}): BlastRadiusView {
  return view({
    head_sha: HEAD,
    link_sha: HEAD,
    symbols: [
      symbol({
        name: 'api',
        file: 'src/api.ts',
        line: 12,
        callers: [{ file: 'src/caller.ts', symbol: 'callsApi', line: 34, rank: 9 }],
        caller_count: 1,
      }),
    ],
    ...over,
  });
}

/**
 * `BriefService` on three object literals — its ports are structural and its
 * repository is a constructor parameter, so no composition root and no Docker.
 */
function serviceFor(
  blast: BlastRadiusView,
  answer: RiskBrief = ANSWER,
  reads: Partial<BriefReads> = {},
) {
  const writes: BriefValues[] = [];
  const repo: BriefReads = {
    getPull: async () => ({
      id: PR,
      repoId: 'repo-1',
      headSha: HEAD,
      title: 'Add rate limiting',
      body: null,
      linkedIssue: null,
    }),
    getRepo: async () => ({ owner: 'acme', name: 'payments-api' }),
    getFilePaths: async () => ['src/changed.ts'],
    getDiffStats: async () => ({ files: 1, additions: 1, deletions: 0 }),
    getBriefFor: async () => undefined,
    getHeadCommittedAt: async () => null,
    upsertBrief: async (prId, headSha, values): Promise<PrBriefRow> => {
      writes.push(values);
      return { prId, headSha, ...values, computedAt: new Date(), evictedCount: 0 };
    },
    ...reads,
  };
  const container = {
    settingsRepo: { value: async () => null },
    git: {
      readFile: async () => {
        throw new Error('nothing is linked from the body');
      },
    },
    prompts: { render: async () => 'SYSTEM PROMPT' },
    tokenizer: { count, id: 'cl100k_base' },
    intentService: { get: async () => null },
    blastService: { getBlast: async () => blast },
    llm: async () => ({
      id: 'openai',
      listModels: async () => [],
      complete: async () => {
        throw new Error('complete() must never be called on this path');
      },
      completeStructured: (async (req: StructuredRequest<unknown>) => ({
        data: answer,
        model: req.model,
        tokensIn: 100,
        tokensOut: 20,
        costUsd: 0.001,
        raw: '{}',
        attempts: 1,
      })) as never,
      embed: async () => [],
    }),
  } as unknown as BriefContainer;
  return { service: new BriefService(container, repo), writes };
}

async function refLinesOf(blast: BlastRadiusView, answer: RiskBrief = ANSWER) {
  const { service, writes } = serviceFor(blast, answer);
  const out = await service.compute(WS, PR, { warn: () => {} });
  if (!out.ok) throw new Error(out.reason);
  // The persisted column and the served record, which are two different reads of
  // one decision: `refLines` goes into jsonb and `ref_lines` comes back through
  // `toRiskBriefRecord`'s parse.
  return { stored: writes[0]!.refLines, served: out.record.ref_lines };
}

describe('BriefService.run — a number outlives the commit it was measured at, so it is gated (R16)', () => {
  /** The control. Without it, every "is empty" case below could pass vacuously. */
  it('a fresh index persists the derived lines, and serves them back', async () => {
    const { stored, served } = await refLinesOf(gateBlast());

    expect(stored).toEqual([
      { ref: 'src/api.ts', line: 12, source: 'blast_symbol' },
      { ref: 'src/caller.ts', line: 34, source: 'blast_caller' },
    ]);
    expect(served).toEqual(stored);
  });

  it('index_matches_head false persists [] — the numbers describe a tree nobody is reading', async () => {
    const { stored, served } = await refLinesOf(
      gateBlast({ index_matches_head: false, link_sha: 'an-older-commit' }),
    );

    expect(stored).toEqual([]);
    expect(served).toEqual([]);
  });

  /**
   * `link_sha: null` with `index_matches_head` true cannot come out of the blast
   * route — `index_matches_head` is false whenever `link_sha` is null. It is
   * asserted anyway, and only this shape asserts it: with a view that fails both
   * halves, either half of the gate could be deleted and nothing would fail.
   */
  it('link_sha null persists [] on its own — there is no commit at which the number was true', async () => {
    const { stored, served } = await refLinesOf(
      gateBlast({ link_sha: null, index_matches_head: true }),
    );

    expect(stored).toEqual([]);
    expect(served).toEqual([]);
  });

  it('no blast answer at all persists []', async () => {
    const { service, writes } = serviceFor(undefined as unknown as BlastRadiusView, {
      ...ANSWER,
      risks: [{ ...ANSWER.risks[0]!, file_refs: ['src/changed.ts'] }],
      review_focus: [],
    });
    const out = await service.compute(WS, PR, { warn: () => {} });
    if (!out.ok) throw new Error(out.reason);

    expect(out.record.risks).toHaveLength(1);
    expect(writes[0]!.refLines).toEqual([]);
  });

  /**
   * The dropped-block rule where the mistake is actually MAKEABLE. `buildRefLines`
   * takes `included` and the unit case above proves it honours it — but the
   * service is what chooses the argument, and `buildRefLines(buildBlocks(sources))`
   * type-checks, runs, and is wrong.
   *
   * The fixture is the only shape that can tell the two apart: the blast block is
   * dropped by the budget while `src/api.ts` stays grounded through the
   * changed-file list. So the reference survives and its number must not — which
   * is R15 exactly, a reference admitted any way other than through blast is shown
   * with no line.
   */
  it('a reference kept through the CHANGED FILES gets no line when the blast block was dropped', async () => {
    // 40 paths at the path cap, against `count: s => s.length` and an 8000 budget:
    // everything droppable goes, and `src/api.ts` leads the list so the elastic
    // re-render of diff-stats keeps it.
    const filler = Array.from({ length: 39 }, (_, i) => `src/${'x'.repeat(390)}${i}.ts`);
    const { service, writes } = serviceFor(gateBlast(), ANSWER, {
      getFilePaths: async () => ['src/api.ts', ...filler],
      getDiffStats: async () => ({ files: 40, additions: 1, deletions: 1 }),
    });

    const out = await service.compute(WS, PR, { warn: () => {} });
    if (!out.ok) throw new Error(out.reason);

    expect(out.record.inputs.find((row) => row.id === 'blast')?.status).toBe('dropped');
    expect(out.record.risks[0]!.file_refs).toEqual(['src/api.ts']);
    expect(writes[0]!.refLines).toEqual([]);
  });

  /**
   * A number for a reference the grounding filter removed belongs to nothing on
   * the record: `ref_lines` is matched by exact `ref` value, so an orphan entry is
   * dead weight at best and a number rendered against the wrong row at worst.
   */
  it('keeps only the entries whose ref survived on a risk or a focus item', async () => {
    const { stored } = await refLinesOf(gateBlast(), {
      ...ANSWER,
      review_focus: [],
    });

    expect(stored).toEqual([{ ref: 'src/api.ts', line: 12, source: 'blast_symbol' }]);
  });
});
