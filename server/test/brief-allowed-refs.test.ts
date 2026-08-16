/**
 * P2 step 4 — **the allowed set is the PROMPT's inventory, not the gatherer's**
 * (R13, AC-13: "з входу цього ж виклику").
 *
 * The budget walk sits between the sources and the prompt. Building the set from
 * the sources would license a reference to a blast answer the budget dropped, a
 * spec it dropped, or one of the 360 file paths a 400-file PR never printed — so
 * the model could hand back a reference to a document it never saw and grounding
 * would confirm it. Every case below is that difference.
 *
 * NEGATIVE CONTROL: feed `buildAllowedRefs` the raw blocks instead of
 * `fit.included` and every assertion here flips. Verified by hand on 2026-08-16.
 */
import { describe, it, expect } from 'vitest';
import type { BlastRadiusView } from '@devdigest/shared';
import { buildAllowedRefs, buildBlocks, fitToBudget } from '../src/modules/brief/helpers.js';
import type { BriefSources } from '../src/modules/brief/types.js';
import { MAX_FILE_PATHS } from '../src/modules/brief/constants.js';

const count = (text: string) => text.length;

const BLAST: BlastRadiusView = {
  status: 'full',
  reason: null,
  repo_full_name: 'Holubinka/dev-digest',
  head_sha: 'aaa',
  link_sha: 'aaa',
  index_matches_head: true,
  changed_files: ['src/changed.ts'],
  symbols: [
    {
      name: 'thing',
      kind: 'function',
      file: 'src/changed.ts',
      line: 1,
      callers: [{ file: 'src/caller.ts', symbol: 'callsThing', line: 9, rank: 80 }],
      caller_count: 1,
      truncated: false,
      endpoints: [
        { label: 'GET /widgets', file: 'src/route.ts', line: 4, depth: 0, kind: 'http' },
      ],
      endpoint_count: 1,
      endpoints_truncated: false,
    },
  ],
  totals: { symbols: 1, callers: 1, endpoints: 1, crons: 0 },
  summary: null,
};

function sources(over: Partial<BriefSources> = {}): BriefSources {
  return {
    title: 'A change',
    body: 'Because.',
    linkedIssue: null,
    intent: null,
    blast: BLAST,
    diff: { files: 1, additions: 1, deletions: 0 },
    filePaths: ['src/changed.ts'],
    specs: [],
    ...over,
  };
}

function allowedFor(src: BriefSources, budget: number): Set<string> {
  const blocks = buildBlocks(src);
  return buildAllowedRefs(fitToBudget(blocks, 0, budget, count).included);
}

describe('buildAllowedRefs — membership follows what actually reached the prompt', () => {
  it('an INCLUDED blast block contributes its caller files and endpoint labels (R13)', () => {
    const allowed = allowedFor(sources(), 100_000);
    expect(allowed.has('src/changed.ts')).toBe(true);
    expect(allowed.has('src/caller.ts')).toBe(true);
    expect(allowed.has('src/route.ts')).toBe(true);
    expect(allowed.has('GET /widgets')).toBe(true);
  });

  /**
   * The case the whole parameter change exists for. The blast block is gathered,
   * then dropped by the budget walk — so the model never sees `src/caller.ts` or
   * `GET /widgets`, and must not be allowed to name them.
   */
  it('a DROPPED blast block contributes nothing — no caller file, no endpoint label', () => {
    const blocks = buildBlocks(sources());
    const diffTokens = count(blocks.find((b) => b.id === 'diff_stats')!.text);
    const fit = fitToBudget(blocks, 0, diffTokens + 10, count);

    expect(fit.inputs.find((row) => row.id === 'blast')?.status).toBe('dropped');
    const allowed = buildAllowedRefs(fit.included);
    expect(allowed.has('src/caller.ts')).toBe(false);
    expect(allowed.has('GET /widgets')).toBe(false);
    // `src/changed.ts` survives, but through the diff-stats block that was NOT
    // dropped — membership follows the block, not the source.
    expect(allowed.has('src/changed.ts')).toBe(true);
  });

  it('a TRUNCATED first spec still contributes its own path — a prefix cut cannot reach it', () => {
    const src = sources({
      specs: [
        { path: 'plans/first.md', text: 'F'.repeat(4000) },
        { path: 'plans/second.md', text: 'S'.repeat(4000) },
      ],
    });
    const blocks = buildBlocks(src);
    const fixed = count(blocks.filter((b) => b.id !== 'specs').map((b) => b.text).join('\n\n'));
    const fit = fitToBudget(blocks, 0, fixed + 900, count);

    expect(fit.inputs.find((row) => row.id === 'specs')?.status).toBe('truncated');
    const allowed = buildAllowedRefs(fit.included);
    expect(allowed.has('plans/first.md')).toBe(true);
    expect(allowed.has('plans/second.md')).toBe(false);
  });

  it('a spec the walk dropped contributes nothing', () => {
    const src = sources({ specs: [{ path: 'plans/only.md', text: 'O'.repeat(4000) }] });
    const blocks = buildBlocks(src);
    const diffTokens = count(blocks.find((b) => b.id === 'diff_stats')!.text);
    const fit = fitToBudget(blocks, 0, diffTokens + 10, count);

    expect(fit.inputs.find((row) => row.id === 'specs')?.status).toBe('dropped');
    expect(buildAllowedRefs(fit.included).has('plans/only.md')).toBe(false);
  });

  /**
   * On a 400-file PR only the 40 paths the block PRINTED are members. The other
   * 360 were never in front of the model, and a reference to one of them is a
   * guess we would otherwise stamp as grounded.
   */
  it('on a 400-file PR only the printed paths are members', () => {
    const paths = Array.from({ length: 400 }, (_, i) => `src/f${i}.ts`);
    // The repository caps at MAX_FILE_PATHS, so this is what the service passes.
    const src = sources({
      filePaths: paths.slice(0, MAX_FILE_PATHS),
      diff: { files: 400, additions: 1, deletions: 1 },
      blast: null,
    });
    const allowed = allowedFor(src, 100_000);
    expect(allowed.has('src/f0.ts')).toBe(true);
    expect(allowed.has(`src/f${MAX_FILE_PATHS - 1}.ts`)).toBe(true);
    expect(allowed.has(`src/f${MAX_FILE_PATHS}.ts`)).toBe(false);
    expect(allowed.has('src/f399.ts')).toBe(false);
    expect(allowed.size).toBe(MAX_FILE_PATHS);
  });

  it('prose blocks contribute no references at all', () => {
    const src = sources({
      blast: null,
      filePaths: [],
      diff: { files: 0, additions: 0, deletions: 0 },
      linkedIssue: { number: 7, title: 'src/pretend.ts is broken', body: null, state: 'open' },
      intent: {
        intent: 'Fixes src/imagined.ts',
        in_scope: [],
        out_of_scope: [],
        risk_areas: [],
        confidence: 'low',
        evidence: [],
        plan_refs: [],
        provider: 'openai',
        model: 'gpt-4.1',
        computed_at: '2026-08-16T09:00:00.000Z',
      },
    });
    expect(allowedFor(src, 100_000).size).toBe(0);
  });
});
