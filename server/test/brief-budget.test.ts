/**
 * P2 step 4 — block assembly and the budget walk, with `count: s => s.length`.
 *
 * Hermetic by construction: `buildBlocks` and `fitToBudget` call nothing, so the
 * whole of AC-17, AC-18, AC-20 and AC-23 is decidable here with no tokenizer, no
 * clone and no database.
 */
import { describe, it, expect } from 'vitest';
import type { BlastRadiusView, RiskBriefInput, RiskBriefInputId } from '@devdigest/shared';
import { buildBlocks, fitToBudget } from '../src/modules/brief/helpers.js';
import type { BriefSources } from '../src/modules/brief/types.js';
import {
  BRIEF_TOKEN_BUDGET,
  MAX_BLAST_CALLERS,
  MAX_BLAST_ENDPOINTS,
  MAX_BLAST_SYMBOLS,
  MAX_FILE_PATHS,
  MAX_FILE_PATH_CHARS,
  MAX_PR_BODY_CHARS,
} from '../src/modules/brief/constants.js';

const count = (text: string) => text.length;

const BLAST: BlastRadiusView = {
  status: 'full',
  reason: null,
  repo_full_name: 'Holubinka/dev-digest',
  head_sha: 'de50d5c364fb',
  link_sha: 'de50d5c364fb',
  index_matches_head: true,
  changed_files: ['server/src/modules/brief/service.ts'],
  symbols: [
    {
      name: 'BriefService',
      kind: 'class',
      file: 'server/src/modules/brief/service.ts',
      line: 40,
      callers: [
        { file: 'server/src/modules/brief/routes.ts', symbol: 'briefRoutes', line: 21, rank: 90 },
      ],
      caller_count: 1,
      truncated: false,
      endpoints: [
        {
          label: 'POST /pulls/:id/brief',
          file: 'server/src/modules/brief/routes.ts',
          line: 41,
          depth: 0,
          kind: 'http',
        },
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
    title: 'Add the Risk Brief',
    body: 'Briefs a reviewer before they open the diff. Plan: `plans/10.md`',
    linkedIssue: { number: 42, title: 'Reviewers open cold', body: 'No idea what changed.', state: 'open' },
    intent: {
      intent: 'Briefs a reviewer on what a PR state changes and where to look first.',
      in_scope: ['the brief module'],
      out_of_scope: ['a second model call'],
      risk_areas: ['public API'],
      confidence: 'high',
      evidence: ['title', 'body'],
      plan_refs: ['plans/10.md'],
      provider: 'openai',
      model: 'gpt-4.1',
      computed_at: '2026-08-16T09:00:00.000Z',
    },
    blast: BLAST,
    diff: { files: 3, additions: 210, deletions: 12 },
    filePaths: [
      'server/src/modules/brief/service.ts',
      'server/src/modules/brief/routes.ts',
      'server/src/db/schema/reviews.ts',
    ],
    specs: [{ path: 'plans/10.md', text: 'The plan body.' }],
    ...over,
  };
}

function byId(inputs: RiskBriefInput[]): Record<string, RiskBriefInput> {
  return Object.fromEntries(inputs.map((row) => [row.id, row])) as Record<string, RiskBriefInput>;
}

describe('buildBlocks — one block per present input, capped before wrapping (R23)', () => {
  it('gives every block its own <untrusted> label', () => {
    const fit = fitToBudget(buildBlocks(sources()), 0, 100_000, count);
    for (const label of [
      'diff-stats',
      'derived-intent',
      'blast-facts',
      'pr-title',
      'pr-body',
      'linked-issue',
      'plan-spec',
    ]) {
      expect(fit.user).toContain(`<untrusted source="${label}">`);
    }
  });

  /**
   * The cap is applied BEFORE `wrapUntrusted`, so a body sitting exactly on its
   * ceiling still has a closing fence after it. Truncating the wrapped block
   * instead would cut `</untrusted>` off the end, and untrusted content that can
   * close its own fence speaks as the prompt.
   */
  it('a body at exactly its cap still closes its fence', () => {
    const body = 'x'.repeat(MAX_PR_BODY_CHARS);
    const fit = fitToBudget(buildBlocks(sources({ body })), 0, 100_000, count);
    const opened = fit.user.indexOf('<untrusted source="pr-body">');
    expect(opened).toBeGreaterThan(-1);
    expect(fit.user.slice(opened)).toContain('\n</untrusted>');
    expect(fit.user).toContain(body);
  });

  /** An over-long body is cut, and the fence still closes after the cut. */
  it('an over-long body is cut and still closes its fence', () => {
    const body = 'y'.repeat(MAX_PR_BODY_CHARS + 500);
    const fit = fitToBudget(buildBlocks(sources({ body })), 0, 100_000, count);
    expect(fit.user).not.toContain(body);
    expect(fit.user).toContain('y'.repeat(MAX_PR_BODY_CHARS));
    const opened = fit.user.indexOf('<untrusted source="pr-body">');
    expect(fit.user.slice(opened)).toContain('\n</untrusted>');
  });

  /**
   * AC-17: no hunk, no patch body. The cheapest check from the outside is that
   * no line of the assembled input looks like a diff line, which is why this
   * file's own renderer uses `*` bullets and never `-`.
   */
  it('no line of the assembled input looks like a diff line (R17)', () => {
    const fit = fitToBudget(buildBlocks(sources()), 0, 100_000, count);
    const offenders = fit.user
      .split('\n')
      .filter((line) => line.startsWith('+') || line.startsWith('-') || line.startsWith('@@'));
    expect(offenders).toEqual([]);
  });

  it('prints at most MAX_FILE_PATHS paths and says how many it left out', () => {
    const paths = Array.from({ length: MAX_FILE_PATHS }, (_, i) => `src/f${i}.ts`);
    const blocks = buildBlocks(sources({ filePaths: paths, diff: { files: 400, additions: 1, deletions: 1 } }));
    const diff = blocks.find((b) => b.id === 'diff_stats')!;
    expect(diff.refs).toHaveLength(MAX_FILE_PATHS);
    expect(diff.text).toContain('(360 further changed file(s) not listed.)');
  });

  it('caps the blast fact list at symbols × callers × endpoints', () => {
    const symbols = Array.from({ length: MAX_BLAST_SYMBOLS + 4 }, (_, s) => ({
      ...BLAST.symbols[0]!,
      name: `sym${s}`,
      file: `src/s${s}.ts`,
      callers: Array.from({ length: MAX_BLAST_CALLERS + 3 }, (_, c) => ({
        file: `src/c${s}-${c}.ts`,
        symbol: `caller${c}`,
        line: c,
        rank: 1,
      })),
      caller_count: MAX_BLAST_CALLERS + 3,
      endpoints: Array.from({ length: MAX_BLAST_ENDPOINTS + 2 }, (_, e) => ({
        label: `GET /e${s}-${e}`,
        file: `src/e${s}-${e}.ts`,
        line: e,
        depth: 0 as const,
        kind: 'http' as const,
      })),
      endpoint_count: MAX_BLAST_ENDPOINTS + 2,
    }));
    const blocks = buildBlocks(sources({ blast: { ...BLAST, symbols } }));
    const blast = blocks.find((b) => b.id === 'blast')!;

    expect(blast.text).toContain('sym0');
    expect(blast.text).not.toContain(`sym${MAX_BLAST_SYMBOLS}`);
    expect(blast.text).toContain(`(4 further symbol(s) not listed.)`);
    expect(blast.refs).toContain('src/c0-0.ts');
    expect(blast.refs).not.toContain(`src/c0-${MAX_BLAST_CALLERS}.ts`);
    expect(blast.refs).toContain('GET /e0-0');
    expect(blast.refs).not.toContain(`GET /e0-${MAX_BLAST_ENDPOINTS}`);
  });
});

describe('fitToBudget — what fits, what is cut, what is dropped (R18, R20)', () => {
  it('all six inputs fit → every status is included', () => {
    const fit = fitToBudget(buildBlocks(sources()), 0, 100_000, count);
    const rows = byId(fit.inputs);
    for (const id of ['diff_stats', 'intent', 'blast', 'pr_text', 'linked_issue', 'specs']) {
      expect(rows[id]?.status).toBe('included');
    }
    expect(count(fit.user)).toBeLessThanOrEqual(100_000);
  });

  /**
   * The fixed blocks are dropped in REVERSE priority — linked issue, then PR
   * text, then blast, then intent — and diff stats are never dropped, because a
   * brief that does not know which files changed is a different answer, not a
   * degraded one.
   */
  it('drops in reverse priority and never drops diff stats', () => {
    const blocks = buildBlocks(sources());
    const diffTokens = count(blocks.find((b) => b.id === 'diff_stats')!.text);

    // A budget that fits the diff stats and nothing else.
    const fit = fitToBudget(blocks, 0, diffTokens + 10, count);
    const rows = byId(fit.inputs);
    expect(rows.diff_stats?.status).toBe('included');
    expect(rows.linked_issue?.status).toBe('dropped');
    expect(rows.pr_text?.status).toBe('dropped');
    expect(rows.blast?.status).toBe('dropped');
    expect(rows.intent?.status).toBe('dropped');
    expect(fit.included.map((b) => b.id)).toEqual(['diff_stats']);
  });

  it('drops only as far down the reverse order as it has to', () => {
    const blocks = buildBlocks(sources());
    const size = (id: RiskBriefInputId) =>
      count(blocks.filter((b) => b.id === id).map((b) => b.text).join(''));
    // Everything but the linked issue, plus slack for the joins and the fence.
    const budget = size('diff_stats') + size('intent') + size('blast') + size('pr_text') + 40;

    const rows = byId(fitToBudget(blocks, 0, budget, count).inputs);
    expect(rows.linked_issue?.status).toBe('dropped');
    expect(rows.pr_text?.status).toBe('included');
    expect(rows.blast?.status).toBe('included');
    expect(rows.intent?.status).toBe('included');
  });

  it('counts the system prompt against the same budget (R18)', () => {
    const blocks = buildBlocks(sources());
    const budget = count(blocks.map((b) => b.text).join('\n\n')) + 200;
    const withoutSystem = byId(fitToBudget(blocks, 0, budget, count).inputs);
    expect(withoutSystem.linked_issue?.status).toBe('included');

    const withSystem = byId(fitToBudget(blocks, budget, budget, count).inputs);
    expect(withSystem.linked_issue?.status).toBe('dropped');
  });

  /**
   * The specs are the only ELASTIC input, and they get the one cut point: the
   * walk takes them in order, stops at the first that does not fit, and
   * truncates the first only when it alone exceeds the remainder.
   */
  it('specs alone exceed the remainder → first truncated, the rest dropped (R20)', () => {
    const blocks = buildBlocks(
      sources({
        specs: [
          { path: 'plans/a.md', text: 'A'.repeat(4000) },
          { path: 'plans/b.md', text: 'B'.repeat(4000) },
        ],
      }),
    );
    const fixed = count(blocks.filter((b) => b.id !== 'specs').map((b) => b.text).join('\n\n'));

    const fit = fitToBudget(blocks, 0, fixed + 900, count);
    const specs = byId(fit.inputs).specs!;
    expect(specs.status).toBe('truncated');
    expect(specs.detail).toContain('plans/a.md (truncated)');
    expect(specs.detail).toContain('plans/b.md (dropped)');

    // The truncated first spec is still an included block, because the path leads
    // the section and a prefix cut cannot reach it.
    expect(fit.included.filter((b) => b.id === 'specs').map((b) => b.refs[0])).toEqual([
      'plans/a.md',
    ]);
    expect(fit.user).toContain('plans/a.md');
    expect(fit.user).not.toContain('plans/b.md');
  });

  it('a second spec that fits is included whole', () => {
    const blocks = buildBlocks(
      sources({
        specs: [
          { path: 'plans/a.md', text: 'A'.repeat(200) },
          { path: 'plans/b.md', text: 'B'.repeat(200) },
        ],
      }),
    );
    const fit = fitToBudget(blocks, 0, 100_000, count);
    expect(byId(fit.inputs).specs?.detail).toBe('plans/a.md (included), plans/b.md (included)');
    expect(fit.included.filter((b) => b.id === 'specs')).toHaveLength(2);
  });

  /**
   * The `plan-spec` fence is paid for BEFORE the walk. Measuring the inner text
   * and wrapping afterwards would put the assembled input over the ceiling by
   * exactly the overhead nobody counted — which is the one number AC-18 is about.
   */
  it('never exceeds the budget, fence included, at the boundary', () => {
    const blocks = buildBlocks(sources({ specs: [{ path: 'plans/a.md', text: 'A'.repeat(3000) }] }));
    const fixed = count(blocks.filter((b) => b.id !== 'specs').map((b) => b.text).join('\n\n'));
    for (let slack = 0; slack <= 120; slack += 7) {
      const budget = fixed + slack;
      const fit = fitToBudget(blocks, 0, budget, count);
      expect(count(fit.user)).toBeLessThanOrEqual(budget);
    }
  });

  it('drops the specs entirely when nothing is left for them', () => {
    const blocks = buildBlocks(sources({ specs: [{ path: 'plans/a.md', text: 'A'.repeat(3000) }] }));
    const diffTokens = count(blocks.find((b) => b.id === 'diff_stats')!.text);
    const fit = fitToBudget(blocks, 0, diffTokens + 10, count);
    expect(byId(fit.inputs).specs?.status).toBe('dropped');
    expect(fit.included.some((b) => b.id === 'specs')).toBe(false);
    expect(fit.user).not.toContain('plan-spec');
  });
});

/* -------------------------------------------- the budget as a BOUND (AC-18) */

/**
 * `diff_stats` is exempt from `DROP_ORDER`, and until 2026-08-16 exempt meant
 * UNBOUNDED: once every other block was dropped, `fitToBudget` returned whatever
 * that block rendered and `run()` sent it — `input_tokens_counted` recorded the
 * overflow and nothing refused it.
 *
 * The only cap on it is `MAX_FILE_PATHS` (40) x `MAX_FILE_PATH_CHARS` (400)
 * counted in CODE POINTS, and code points are not tokens. Reachable rather than
 * theoretical: `pr_files.path` is GitHub's `filename` inserted verbatim with no
 * length or charset bound (`modules/pulls/routes.ts:238`) and git permits any
 * non-NUL byte in a name. Measured against the real encoder and the real system
 * prompt on 2026-08-16 — 40 x 400 ASCII = 3167 tokens, 40 x 400 U+1F600 = 32949,
 * 40 x 400 U+2A6B2 = 64949, i.e. 8.1x the declared 8000.
 *
 * `count` here is `s => s.length`, UTF-16 units, which UNDERSTATES astral text
 * against the encoder by roughly four — and the budget is still blown by 4x, so
 * the case needs no tokenizer to be real.
 */
describe('fitToBudget — the block that is never dropped is still bounded', () => {
  /** A plausible system prompt's share of the ceiling. */
  const SYSTEM = 500;

  /** 40 paths, each over `MAX_FILE_PATH_CHARS` astral code points, all distinct. */
  const ASTRAL_PATHS = Array.from(
    { length: MAX_FILE_PATHS },
    (_, i) => `${i}/${'\u{1F600}'.repeat(MAX_FILE_PATH_CHARS)}`,
  );

  function astralFit(budget = BRIEF_TOKEN_BUDGET, systemTokens = SYSTEM) {
    const blocks = buildBlocks(
      sources({ filePaths: ASTRAL_PATHS, diff: { files: 400, additions: 900, deletions: 12 } }),
    );
    return fitToBudget(blocks, systemTokens, budget, count);
  }

  function diffBlock(fit: ReturnType<typeof astralFit>) {
    return fit.included.find((b) => b.id === 'diff_stats')!;
  }

  it('system + user stays within BRIEF_TOKEN_BUDGET on 40 astral paths (AC-18, AC-20)', () => {
    const fit = astralFit();
    expect(SYSTEM + count(fit.user)).toBeLessThanOrEqual(BRIEF_TOKEN_BUDGET);
    // Non-vacuous: the block is still sent, and it still names files.
    expect(diffBlock(fit).refs.length).toBeGreaterThan(0);
    expect(diffBlock(fit).refs.length).toBeLessThan(MAX_FILE_PATHS);
  });

  /** What the model reads and what `refs` licenses are one list, not two. */
  it('prints exactly the paths it kept, and counts the rest accurately', () => {
    const diff = diffBlock(astralFit());
    const printed = diff.text.split('\n').filter((line) => line.startsWith('* '));

    expect(printed.map((line) => line.slice(2))).toEqual(diff.refs);
    expect(diff.text).toContain(`(${400 - diff.refs.length} further changed file(s) not listed.)`);
  });

  /** A cut input says so on the card: four statuses exist and this is what `truncated` is for. */
  it('records the shortened block as truncated, with the surviving count', () => {
    const fit = astralFit();
    const row = byId(fit.inputs).diff_stats!;
    expect(row.status).toBe('truncated');
    expect(row.detail).toBe(`${diffBlock(fit).refs.length} path(s) of 400`);
  });

  /**
   * The floor. Below the width of one astral path line the list empties rather
   * than the budget breaking: the block still says 400 files changed and that it
   * listed none of them, and it licenses nothing.
   */
  it('empties the list rather than exceeding the budget', () => {
    const fit = astralFit(400, 0);
    expect(count(fit.user)).toBeLessThanOrEqual(400);
    expect(diffBlock(fit).refs).toEqual([]);
    expect(fit.user).toContain('(400 further changed file(s) not listed.)');
  });

  /** And an ordinary PR is untouched — the shrink is a ceiling, not a policy. */
  it('leaves an ASCII path list whole and still reports included', () => {
    const paths = Array.from({ length: MAX_FILE_PATHS }, (_, i) => `server/src/f${i}.ts`);
    const fit = fitToBudget(
      buildBlocks(sources({ filePaths: paths, diff: { files: 400, additions: 9, deletions: 1 } })),
      SYSTEM,
      BRIEF_TOKEN_BUDGET,
      count,
    );
    const row = byId(fit.inputs).diff_stats!;
    expect(row.status).toBe('included');
    expect(fit.included.find((b) => b.id === 'diff_stats')!.refs).toHaveLength(MAX_FILE_PATHS);
  });
});
