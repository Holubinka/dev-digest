import { describe, expect, it } from 'vitest';
import { ApiClient, type FetchLike } from '../src/api/client.js';
import { Resolver } from '../src/api/resolve.js';
import { ToolError, type ToolTextResult } from '../src/errors.js';
import { BLAST_CALLERS_PER_SYMBOL, BLAST_REASON_CHARS } from '../src/project.js';
import { getBlastRadius } from '../src/tools/blast-radius.js';

const BASE = 'http://127.0.0.1:3001';
const REPO = 'acme/payments-api';
const PR = 105;

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const REPOS = [{ id: 'r1', full_name: REPO }];
const PULLS = [{ id: 'p1', number: PR }];

/** The PR's head commit — the one commit the indexed line numbers are NOT valid at. */
const HEAD_SHA = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
/** The commit the index was built from, when it is behind the head. */
const INDEX_SHA = '66727c85ce06d7b16e64f888925d131d558cbe51';

interface Caller {
  file: string;
  line: number;
  rank: number;
  symbol?: string;
}

const caller = (over: Partial<Caller> = {}): Caller => ({
  file: 'src/app.ts',
  line: 83,
  rank: 0.9,
  symbol: 'buildApp',
  ...over,
});

const symbol = (over: Record<string, unknown> = {}) => ({
  name: 'ReviewService',
  kind: 'class',
  file: 'src/modules/reviews/service.ts',
  line: 21,
  callers: [caller()],
  caller_count: 1,
  truncated: false,
  endpoints: [{ label: 'GET /pulls/:id/reviews', file: 'x.ts', line: 4, depth: 1, kind: 'http' }],
  ...over,
});

/**
 * The whole `BlastRadiusView`, including the fields the projection must drop.
 * The default is the healthy case: the index sits exactly on the PR head, so
 * `link_sha === head_sha` and nothing about the commit needs saying.
 */
const view = (over: Record<string, unknown> = {}) => ({
  status: 'full',
  reason: null,
  repo_full_name: REPO,
  head_sha: HEAD_SHA,
  link_sha: HEAD_SHA,
  index_matches_head: true,
  changed_files: ['src/modules/reviews/service.ts'],
  symbols: [symbol()],
  totals: { symbols: 1, callers: 1, endpoints: 1, crons: 0 },
  summary: null,
  ...over,
});

function tool(body: unknown) {
  const calls: string[] = [];
  const fetchImpl: FetchLike = async (input) => {
    const { pathname } = new URL(String(input));
    calls.push(pathname);
    if (pathname === '/repos') return json(REPOS);
    if (pathname === '/repos/r1/pulls') return json(PULLS);
    if (pathname === '/pulls/p1/blast') return json(body);
    throw new Error(`unexpected request: ${pathname}`);
  };
  const client = new ApiClient({ baseUrl: BASE, fetchImpl });
  return { client, resolver: new Resolver(client), calls };
}

const payload = (result: ToolTextResult) =>
  JSON.parse(result.content[0]!.text) as Record<string, unknown>;

const run = async (body: unknown, args: { repo?: string; pr?: number } = {}) => {
  const t = tool(body);
  const result = await getBlastRadius(t.client, t.resolver, {
    repo: args.repo ?? REPO,
    pr: args.pr ?? PR,
  });
  return { result, body: payload(result), calls: t.calls };
};

interface ProjectedSymbol {
  symbol: string;
  at: string;
  caller_count: number;
  callers: string[];
  endpoints?: string[];
}

const symbolsOf = (body: Record<string, unknown>) => body.symbols as ProjectedSymbol[];

describe('get_blast_radius', () => {
  it('resolves the pull id and reads the blast route, projecting what it returns', async () => {
    const { result, body, calls } = await run(view());

    expect(result.isError).toBe(false);
    expect(calls).toEqual(['/repos', '/repos/r1/pulls', '/pulls/p1/blast']);
    expect(body).toMatchObject({
      repo: REPO,
      pr: PR,
      status: 'full',
      changed_files: ['src/modules/reviews/service.ts'],
      totals: { symbols: 1, callers: 1, endpoints: 1, crons: 0 },
    });
    expect(symbolsOf(body)).toEqual([
      {
        symbol: 'ReviewService',
        at: 'src/modules/reviews/service.ts:21',
        caller_count: 1,
        callers: ['src/app.ts:83'],
        endpoints: ['GET /pulls/:id/reviews'],
      },
    ]);
  });

  it('drops the fields the card needs and a model does not', async () => {
    const { body } = await run(view());

    // `repo_full_name` and `summary` are already the caller's own arguments, or
    // a paid paragraph this tool never asks for. `head_sha` is the PR's identity
    // and the one commit the line numbers below are NOT valid at, so it stays out
    // — the commit that survives is `link_sha`, under the name a model can act on.
    expect(body).not.toHaveProperty('repo_full_name');
    expect(body).not.toHaveProperty('summary');
    expect(body).not.toHaveProperty('head_sha');
    expect(body).not.toHaveProperty('link_sha');
    expect(body).not.toHaveProperty('index_matches_head');
    // `reason` is absent, not null, when the index is complete.
    expect(body).not.toHaveProperty('reason');
    expect(body).not.toHaveProperty('note');
    for (const dropped of ['kind', 'truncated', 'rank', 'depth', 'name', 'file', 'line']) {
      expect(symbolsOf(body)[0]!).not.toHaveProperty(dropped);
    }
  });

  it('orders callers by rank descending, then file, then line', async () => {
    const { body } = await run(
      view({
        symbols: [
          symbol({
            callers: [
              // The unimportant file sorts FIRST alphabetically, so this fixture
              // discriminates: drop the rank key and it leads the list.
              caller({ file: 'src/aaa-low.ts', line: 5, rank: 0.1 }),
              caller({ file: 'src/zzz-high.ts', line: 30, rank: 0.9 }),
              caller({ file: 'src/zzz-high.ts', line: 4, rank: 0.9 }),
              caller({ file: 'src/mmm-high.ts', line: 12, rank: 0.9 }),
            ],
            caller_count: 4,
          }),
        ],
        totals: { symbols: 1, callers: 4, endpoints: 0, crons: 0 },
      }),
    );

    expect(symbolsOf(body)[0]!.callers).toEqual([
      'src/mmm-high.ts:12',
      'src/zzz-high.ts:4',
      'src/zzz-high.ts:30',
      'src/aaa-low.ts:5',
    ]);
  });

  it('orders symbols by their best caller, and breaks a full tie on the name', async () => {
    const shared = { file: 'src/same.ts', line: 1, callers: [caller({ rank: 0.4 })] };
    const { body } = await run(
      view({
        symbols: [
          symbol({ name: 'zeta', ...shared }),
          symbol({ name: 'alpha', ...shared }),
          symbol({ name: 'uncalled', file: 'src/aaa.ts', line: 1, callers: [], caller_count: 0 }),
          symbol({ name: 'coldest', file: 'src/zzz.ts', line: 1, callers: [caller({ rank: 0 })] }),
          symbol({
            name: 'hottest',
            file: 'src/z-last.ts',
            line: 9,
            callers: [caller({ rank: 0.95 })],
          }),
        ],
        totals: { symbols: 5, callers: 4, endpoints: 0, crons: 0 },
      }),
    );

    // "uncalled" sorts BELOW "coldest" despite the alphabetically first file:
    // rank 0 is a real percentile, so no callers has to rank lower than it.
    expect(symbolsOf(body).map((s) => s.symbol)).toEqual([
      'hottest',
      'alpha',
      'zeta',
      'coldest',
      'uncalled',
    ]);
  });

  it('is stable: the same facts in a different order project identically', async () => {
    const symbols = [
      symbol({ name: 'a', file: 'src/a.ts', line: 1, callers: [caller({ rank: 0.5 })] }),
      symbol({ name: 'b', file: 'src/b.ts', line: 2, callers: [caller({ rank: 0.5 })] }),
      symbol({ name: 'c', file: 'src/c.ts', line: 3, callers: [caller({ rank: 0.5 })] }),
    ];
    const totals = { symbols: 3, callers: 3, endpoints: 0, crons: 0 };
    const files = ['b.ts', 'a.ts', 'c.ts'];

    const forwards = await run(view({ symbols, totals, changed_files: files }));
    const backwards = await run(
      view({ symbols: [...symbols].reverse(), totals, changed_files: [...files].reverse() }),
    );

    expect(backwards.body).toEqual(forwards.body);
    expect(forwards.body.changed_files).toEqual(['a.ts', 'b.ts', 'c.ts']);
  });

  it('caps callers per symbol while caller_count keeps the true number', async () => {
    const many = Array.from({ length: BLAST_CALLERS_PER_SYMBOL + 3 }, (_, i) =>
      caller({ file: `src/${String(i).padStart(2, '0')}.ts`, line: i + 1, rank: 0.5 }),
    );
    const { body } = await run(
      view({
        symbols: [symbol({ callers: many, caller_count: many.length, truncated: true })],
        totals: { symbols: 1, callers: many.length, endpoints: 0, crons: 0 },
      }),
    );

    const projected = symbolsOf(body)[0]!;
    expect(projected.callers).toHaveLength(BLAST_CALLERS_PER_SYMBOL);
    expect(projected.caller_count).toBe(BLAST_CALLERS_PER_SYMBOL + 3);
    // The cap keeps the head of the order, not an arbitrary slice.
    expect(projected.callers[0]).toBe('src/00.ts:1');
  });

  it('turns a degraded index into a note that forbids reading [] as "no impact"', async () => {
    const { result, body } = await run(
      view({
        status: 'degraded',
        reason: 'The repository has never been indexed',
        symbols: [],
        totals: { symbols: 0, callers: 0, endpoints: 0, crons: 0 },
      }),
    );

    // Not an error: an incomplete answer is still an answer with a next step.
    expect(result.isError).toBe(false);
    expect(body.status).toBe('degraded');
    expect(body.reason).toBe('The repository has never been indexed');
    expect(body.note).toContain('DEGRADED');
    expect(body.note).toContain('The repository has never been indexed.');
    expect(body.note).toContain('NOT that nothing depends on the change');
    expect(body.note).toContain('DevDigest UI');
  });

  it('names the partial state as partial, not as degraded', async () => {
    const { body } = await run(
      view({ status: 'partial', reason: 'Only 40% of files are indexed.' }),
    );
    expect(body.note).toContain('PARTIAL');
    // No doubled full stop when the API already wrote a sentence.
    expect(body.note).toContain('Only 40% of files are indexed. A short or empty list');
  });

  it('says an empty answer is real when the index is complete', async () => {
    const empty = await run(
      view({ symbols: [], totals: { symbols: 0, callers: 0, endpoints: 0, crons: 0 } }),
    );
    expect(empty.body.note).toContain('no changed symbols');

    const noCallers = await run(
      view({
        symbols: [symbol({ callers: [], caller_count: 0 })],
        totals: { symbols: 1, callers: 0, endpoints: 1, crons: 0 },
      }),
    );
    expect(noCallers.body.note).toContain('no callers of the changed symbols');
  });

  it('names the commit the line numbers belong to, not the pull request head', async () => {
    // The discriminating fixture: the two shas DIFFER, so projecting the wrong
    // one — or defaulting to the head, which is what a model does when told
    // nothing — produces a different answer. This is the live case on
    // Holubinka/dev-digest PR #12: a full index, built before the head moved.
    const { body } = await run(view({ link_sha: INDEX_SHA, index_matches_head: false }));

    expect(body.lines_at_commit).toBe(INDEX_SHA);
    expect(JSON.stringify(body)).not.toContain(HEAD_SHA);
  });

  it('says so in the note when the index is behind the head, even under a full status', async () => {
    const { body } = await run(view({ link_sha: INDEX_SHA, index_matches_head: false }));

    // A `full` index is not a current one, and this is exactly where the caveat
    // would be lost if it were attached to the non-`full` branch.
    expect(body.status).toBe('full');
    const note = body.note as string;
    expect(note).toContain('lines_at_commit');
    expect(note).toContain("NOT at this pull request's head commit");
    expect(note).toContain('git show <lines_at_commit>:<file>');
  });

  it('stays silent about the commit when the index sits on the head', async () => {
    const { body } = await run(view());

    expect(body.lines_at_commit).toBe(HEAD_SHA);
    // Nothing to warn about, and a note that fires every time is one a model
    // learns to skip.
    expect(body).not.toHaveProperty('note');
  });

  it('keeps both caveats when a degraded index ALSO points at a stale commit', async () => {
    const { body } = await run(
      view({
        status: 'degraded',
        reason: 'The repository has never been fully indexed',
        link_sha: INDEX_SHA,
        index_matches_head: false,
      }),
    );

    const note = body.note as string;
    // Neither sentence may overwrite the other: one says the answer is
    // incomplete, the other says its line numbers are from another commit.
    expect(note).toContain('DEGRADED');
    expect(note).toContain('NOT that nothing depends on the change');
    expect(note).toContain('lines_at_commit');
    expect(note).toContain("NOT at this pull request's head commit");
    expect(body.lines_at_commit).toBe(INDEX_SHA);
  });

  it('omits the commit rather than falling back to head when the index knows none', async () => {
    const { body } = await run(
      view({ status: 'degraded', reason: 'Never indexed', link_sha: null, index_matches_head: false }),
    );

    expect(body).not.toHaveProperty('lines_at_commit');
    expect(JSON.stringify(body)).not.toContain(HEAD_SHA);
    expect(body.note).toContain('recorded no commit');
    // The stale-commit sentence names a field that is absent here, so it must
    // not be the one that fired.
    expect(body.note).not.toContain('git show <lines_at_commit>:<file>');
  });

  it('truncates a long reason by code point, never mid-surrogate-pair', async () => {
    // The leading 'A' makes UTF-16 unit 300 land inside a surrogate pair, so a
    // `String.slice` implementation really would break on this fixture.
    const long = `A${'\u{1D4B3}'.repeat(BLAST_REASON_CHARS + 50)}`;
    const { body } = await run(view({ status: 'degraded', reason: long }));

    const reason = body.reason as string;
    expect([...reason]).toHaveLength(BLAST_REASON_CHARS + 1);
    expect(reason.endsWith('…')).toBe(true);
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(reason)).toBe(false);
  });

  it('fails loudly when the API stops sending a field this tool projects', async () => {
    const { status, ...withoutStatus } = view() as Record<string, unknown>;
    void status;
    await expect(run(withoutStatus)).rejects.toMatchObject({ kind: 'contract_mismatch' });

    // Same guard over the commit fields: unknown keys are stripped, so a field
    // this tool NAMES going missing is the only API drift the schema can catch.
    const { link_sha, ...withoutLinkSha } = view() as Record<string, unknown>;
    void link_sha;
    await expect(run(withoutLinkSha)).rejects.toMatchObject({ kind: 'contract_mismatch' });

    const { index_matches_head, ...withoutMatch } = view() as Record<string, unknown>;
    void index_matches_head;
    await expect(run(withoutMatch)).rejects.toMatchObject({ kind: 'contract_mismatch' });
  });

  it('rejects a malformed repo or pr before touching the API', async () => {
    const t = tool(view());

    await expect(
      getBlastRadius(t.client, t.resolver, { repo: 'not-a-slug', pr: PR }),
    ).rejects.toBeInstanceOf(ToolError);
    await expect(
      getBlastRadius(t.client, t.resolver, { repo: REPO, pr: -3 }),
    ).rejects.toBeInstanceOf(ToolError);
    expect(t.calls).toEqual([]);
  });
});
