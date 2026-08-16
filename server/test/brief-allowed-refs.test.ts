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
 * Second control, same date: seed `blastBlock`'s `refs` from `view.changed_files`
 * again — the shape round one shipped — and "a blast changed_file the block never
 * prints is NOT a member" fails. It could not fail before, because the fixture
 * pointed `changed_files` at the one path a symbol already named.
 */
import { describe, it, expect } from 'vitest';
import type { BlastRadiusView } from '@devdigest/shared';
import {
  buildAllowedRefs,
  buildBlocks,
  fitToBudget,
  groundBrief,
} from '../src/modules/brief/helpers.js';
import type { BriefFit, BriefSources } from '../src/modules/brief/types.js';
import {
  MAX_BLAST_CALLERS,
  MAX_BLAST_ENDPOINTS,
  MAX_BLAST_FACT_CHARS,
  MAX_BLAST_SYMBOLS,
  MAX_FILE_PATHS,
  MAX_FILE_PATH_CHARS,
} from '../src/modules/brief/constants.js';

const count = (text: string) => text.length;

const BLAST: BlastRadiusView = {
  status: 'full',
  reason: null,
  repo_full_name: 'Holubinka/dev-digest',
  head_sha: 'aaa',
  link_sha: 'aaa',
  index_matches_head: true,
  // `src/unprinted.ts` is the whole point of this fixture: the blast view knows a
  // changed file that no symbol names and that the diff-stats cap never printed —
  // `getChangedFiles` has no limit, `MAX_FILE_PATHS` does. Point `changed_files`
  // at the same path a symbol names and the two sources become indistinguishable,
  // which is what made the assertion below pass while the block was seeding from it.
  changed_files: ['src/changed.ts', 'src/unprinted.ts'],
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

function fitFor(src: BriefSources, budget: number): BriefFit {
  return fitToBudget(buildBlocks(src), 0, budget, count);
}

function allowedFor(src: BriefSources, budget: number): Set<string> {
  return buildAllowedRefs(fitFor(src, budget).included);
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
   * A changed file the blast block KNOWS but does not print is not a member. The
   * block renders status, commit, totals and symbols; `view.changed_files` reaches
   * the model through the diff-stats block or not at all, and that block caps at
   * `MAX_FILE_PATHS` while `getChangedFiles` caps at nothing.
   */
  it('a blast changed_file the block never prints is NOT a member (AC-13)', () => {
    const allowed = allowedFor(sources({ filePaths: ['src/changed.ts'] }), 100_000);
    expect(allowed.has('src/unprinted.ts')).toBe(false);
  });

  /** The same path IS a member once diff-stats prints it — the block decides, not the source. */
  it('the same path becomes a member when diff-stats prints it', () => {
    const src = sources({
      filePaths: ['src/changed.ts', 'src/unprinted.ts'],
      diff: { files: 2, additions: 1, deletions: 0 },
    });
    expect(allowedFor(src, 100_000).has('src/unprinted.ts')).toBe(true);
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

  /**
   * P2 step 3, against a REAL set rather than a hand-written one: the suffix is
   * cut before membership, and the set it is tested against is the same set. So
   * `src/config.ts:12` is admitted because the diff-stats block printed
   * `src/config.ts`, and `evil.ts:1` is admitted by nothing — the cut can only
   * remove a claim, never create a member (R13).
   */
  it('a line suffix is cut before membership, and cannot widen it', () => {
    const allowed = allowedFor(
      sources({ blast: null, filePaths: ['src/config.ts'], diff: { files: 1, additions: 1, deletions: 0 } }),
      100_000,
    );
    const out = groundBrief(
      {
        what: 'w',
        why: 'y',
        risk_level: 'medium',
        risks: [
          {
            kind: 'secret',
            title: 'A live key',
            explanation: 'committed in plaintext',
            severity: 'high',
            file_refs: ['src/config.ts:12', 'evil.ts:1'],
          },
        ],
        review_focus: [{ ref: 'src/config.ts:12', kind: 'file', reason: 'the key' }],
      },
      allowed,
    );

    expect(allowed.has('src/config.ts')).toBe(true);
    expect(allowed.has('src/config.ts:12')).toBe(false);
    expect(out.risks[0]!.file_refs).toEqual(['src/config.ts']);
    expect(out.review_focus[0]!.ref).toBe('src/config.ts');
    expect(out.dropped_refs).toEqual(['evil.ts:1']);
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

/* ------------------------------------------------- the invariant, enforced */

/**
 * `server/INSIGHTS.md` writes the whole contract of `buildAllowedRefs` down —
 * and writes it down as a diagnostic to run by hand:
 *
 *   [...buildAllowedRefs(fit.included)].filter(r => !fit.user.includes(r))  // empty
 *
 * Maintained by hand it broke three times, in three places, found by three
 * different readers: refs built from the raw sources before the budget walk cut
 * anything; refs seeded from `view.changed_files`, which no block prints; and
 * `refs.add(...)` running BEFORE `clamp()` cut the line the name sat in. Each fix
 * revealed the next one down, because nothing tested the rule itself.
 *
 * Below it is a test, and the fixture is hostile ON PURPOSE. Every name in
 * `BLAST` above is short, which is exactly why the cases above stayed green
 * through two of those three holes: a fixture that cannot express the failure
 * turns a green test into evidence of nothing.
 */
describe('buildAllowedRefs — the allowed set is a SUBSET of what the prompt printed', () => {
  /** Longer than one whole rendered fact line, so any line-level cut severs every name in it. */
  const OVERLONG = MAX_BLAST_FACT_CHARS + 100;

  const long = (prefix: string) => prefix + 'x'.repeat(OVERLONG - prefix.length);

  /**
   * Every string a blast fact line interpolates is repository content of unbounded
   * length: a symbol name (multi-line declarations put newlines in it —
   * `client/INSIGHTS.md`), the indexer's `kind`, a path, an endpoint label built in
   * a loop. So all of them are overlong here, and none of the files a symbol names
   * is one `diff_stats` prints — a fixture whose blast paths are also changed-file
   * paths cannot tell the two blocks apart, which is the mistake that hid the
   * `changed_files` hole.
   */
  function hostileBlast(over: Partial<BlastRadiusView> = {}): BlastRadiusView {
    const symbols = Array.from({ length: MAX_BLAST_SYMBOLS + 2 }, (_, i) => ({
      name: long(`sym${i}_`),
      kind: long(`kind${i}_`),
      // Symbol 1's own path outruns a fact line by itself, with no help from the name.
      file: i === 1 ? long('src/never/shown-symbol-1-') + '.ts' : `src/never/shown-symbol-${i}.ts`,
      line: i + 1,
      callers: Array.from({ length: i === 0 ? MAX_BLAST_CALLERS + 1 : 1 }, (_, j) => ({
        file: `src/never/shown-caller-${i}-${j}.ts`,
        symbol: long(`caller${i}_${j}_`),
        line: j + 1,
        rank: 80,
      })),
      caller_count: i === 0 ? MAX_BLAST_CALLERS + 1 : 1,
      truncated: false,
      endpoints: Array.from({ length: i === 0 ? MAX_BLAST_ENDPOINTS + 1 : 1 }, (_, j) => ({
        label: long(`GET /e${i}-${j}/`),
        file: `src/never/shown-endpoint-${i}-${j}.ts`,
        line: j + 1,
        depth: 0 as const,
        kind: 'http' as const,
      })),
      endpoint_count: i === 0 ? MAX_BLAST_ENDPOINTS + 1 : 1,
      endpoints_truncated: false,
    }));
    return {
      status: 'full',
      reason: null,
      repo_full_name: 'Holubinka/dev-digest',
      head_sha: 'bbb',
      link_sha: 'bbb',
      index_matches_head: true,
      changed_files: Array.from({ length: 400 }, (_, i) => `src/f${i}.ts`),
      symbols,
      totals: { symbols: symbols.length, callers: 99, endpoints: 99, crons: 0 },
      summary: null,
      ...over,
    };
  }

  function hostile(over: Partial<BriefSources> = {}): BriefSources {
    return sources({
      // What the repository hands over: the first MAX_FILE_PATHS of 400, one of
      // them longer than a path may be printed at.
      filePaths: [
        long('src/overlong-changed-') + '.ts',
        ...Array.from({ length: MAX_FILE_PATHS - 1 }, (_, i) => `src/f${i}.ts`),
      ],
      diff: { files: 400, additions: 900, deletions: 12 },
      blast: hostileBlast(),
      ...over,
    });
  }

  /** THE invariant. Empty means every allowed name is one the model actually read. */
  function neverPrinted(fit: BriefFit): string[] {
    return [...buildAllowedRefs(fit.included)].filter((ref) => !fit.user.includes(ref));
  }

  it('a blast view whose every name outruns one fact line licenses nothing unprinted', () => {
    const fit = fitFor(hostile(), 1_000_000);

    expect(fit.inputs.find((row) => row.id === 'blast')?.status).toBe('included');
    // Guards against a vacuous pass: an empty allowed set satisfies any subset test.
    expect(buildAllowedRefs(fit.included).size).toBeGreaterThan(MAX_FILE_PATHS);
    expect(neverPrinted(fit)).toEqual([]);
  });

  it('what the caps did NOT list is not a member either', () => {
    const allowed = buildAllowedRefs(fitFor(hostile(), 1_000_000).included);

    expect(allowed.has(`src/never/shown-symbol-${MAX_BLAST_SYMBOLS}.ts`)).toBe(false);
    expect(allowed.has(`src/never/shown-caller-0-${MAX_BLAST_CALLERS}.ts`)).toBe(false);
    expect(allowed.has(`src/never/shown-endpoint-0-${MAX_BLAST_ENDPOINTS}.ts`)).toBe(false);
  });

  it('holds on a 400-file PR, where the unprinted tail is in the blast view', () => {
    const fit = fitFor(hostile(), 1_000_000);
    const allowed = buildAllowedRefs(fit.included);

    expect(allowed.has('src/f0.ts')).toBe(true);
    expect(allowed.has('src/f399.ts')).toBe(false);
    expect(neverPrinted(fit)).toEqual([]);
  });

  /**
   * The case the round-4 budget fix could have broken. `diff_stats` is exempt
   * from `DROP_ORDER`, so holding the 8000-token ceiling means re-rendering it
   * from fewer paths — and the naive shape of that fix shortens the TEXT while
   * leaving `refs` at the full list, which licenses every path the cut removed.
   * The invariant below is the only thing that says so.
   */
  it('holds when the budget shortens the diff-stats path list', () => {
    const astral = Array.from(
      { length: MAX_FILE_PATHS },
      (_, i) => `${i}/${'\u{1F600}'.repeat(MAX_FILE_PATH_CHARS)}`,
    );
    const fit = fitFor(hostile({ filePaths: astral }), 4000);
    const diff = fit.included.find((b) => b.id === 'diff_stats')!;

    expect(fit.inputs.find((row) => row.id === 'diff_stats')?.status).toBe('truncated');
    // Non-vacuous in both directions: some paths survived, and some did not.
    expect(diff.refs.length).toBeGreaterThan(0);
    expect(diff.refs.length).toBeLessThan(MAX_FILE_PATHS);
    expect(neverPrinted(fit)).toEqual([]);
  });

  it('holds when the budget walk drops one spec and truncates another', () => {
    const src = hostile({
      specs: [
        { path: 'plans/first.md', text: 'F'.repeat(4000) },
        { path: 'plans/second.md', text: 'S'.repeat(4000) },
      ],
    });
    const blocks = buildBlocks(src);
    const fixed = count(blocks.filter((b) => b.id !== 'specs').map((b) => b.text).join('\n\n'));
    const fit = fitToBudget(blocks, 0, fixed + 900, count);

    const specs = fit.inputs.find((row) => row.id === 'specs');
    expect(specs?.status).toBe('truncated');
    expect(specs?.detail).toContain('plans/second.md (dropped)');
    expect(fit.inputs.find((row) => row.id === 'blast')?.status).toBe('included');
    expect(neverPrinted(fit)).toEqual([]);
  });

  it('holds on a blast view whose status is not full', () => {
    const fit = fitFor(
      hostile({
        blast: hostileBlast({
          status: 'degraded',
          reason: long('the index is stale because '),
          link_sha: null,
          index_matches_head: false,
        }),
      }),
      1_000_000,
    );

    expect(buildAllowedRefs(fit.included).size).toBeGreaterThan(MAX_FILE_PATHS);
    expect(neverPrinted(fit)).toEqual([]);
  });

  /**
   * The other half of clamping the parts instead of the line: the line must still
   * have a ceiling. Per-part caps have to SUM to one, or `MAX_BLAST_FACT_CHARS`
   * stops bounding anything and a repository with long identifiers writes the
   * prompt.
   */
  it('and no rendered fact line is longer than MAX_BLAST_FACT_CHARS', () => {
    const text = buildBlocks(hostile()).find((b) => b.id === 'blast')!.text;
    const facts = text
      .split('\n')
      .filter((line) => line.startsWith('* ') || line.startsWith('    '));

    expect(facts.length).toBeGreaterThan(MAX_BLAST_SYMBOLS);
    for (const line of facts) expect([...line].length).toBeLessThanOrEqual(MAX_BLAST_FACT_CHARS);
  });

  /** A path is truncated to a path-shaped ceiling before it becomes a reference. */
  it('an overlong changed-file path is a member only in the form diff-stats printed', () => {
    const allowed = buildAllowedRefs(fitFor(hostile({ blast: null }), 1_000_000).included);
    const printed = [...allowed].filter((ref) => ref.startsWith('src/overlong-changed-'));

    expect(printed).toHaveLength(1);
    expect([...printed[0]!]).toHaveLength(MAX_FILE_PATH_CHARS);
  });
});
