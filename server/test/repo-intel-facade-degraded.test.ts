import { describe, it, expect } from 'vitest';
import { RepoIntelService } from '../src/modules/repo-intel/service.js';
import type { RepoBasics } from '../src/modules/repo-intel/repository.js';
import type { IndexState } from '../src/modules/repo-intel/types.js';

/**
 * T1.4 — Facade degraded contract (acceptance #10).
 *
 * When `repoIntelEnabled=false` (opt-out; the default is now ON), every facade
 * method MUST return a safe degraded value WITHOUT throwing. Consumers (run-executor,
 * blast, hooks) downgrade to their pre-T1.3 behavior on these returns; if any
 * method threw or returned malformed shape, every consumer would crash.
 *
 * No Postgres, no clone. The service's `repo` (RepoIntelRepository) is patched
 * to return null/[] so we exercise the degraded paths cleanly.
 */

function buildDegradedService(opts: {
  flag: boolean;
  basics?: RepoBasics | null;
  indexStateRow?: IndexState | null;
  codeIndex?: { symbols: () => Promise<unknown[]>; references: (ref: unknown, name: string) => Promise<unknown[]> };
}): RepoIntelService {
  const container = {
    config: { repoIntelEnabled: opts.flag },
    db: {} as never,
    // codeIndex is reached by getBlastRadius; we stub minimal behaviour.
    codeIndex: (opts.codeIndex ?? {
      symbols: async () => [],
      references: async () => [],
    }) as never,
  } as never;
  const svc = new RepoIntelService(container);
  (svc as unknown as { repo: Record<string, unknown> }).repo = {
    getRepoBasics: async () => opts.basics ?? null,
    tryGetIndexState: async () => opts.indexStateRow ?? null,
    getCachedSymbols: async () => [],
    getCachedSymbolsForFiles: async () => [],
    getCachedReferencesTo: async () => [],
  };
  return svc;
}

describe('RepoIntel facade — degraded contract (flag off)', () => {
  it('getUnresolvedReferences → [] when repoIntelEnabled=false', async () => {
    const svc = buildDegradedService({ flag: false });
    await expect(svc.getUnresolvedReferences('r1', ['a.ts'])).resolves.toEqual([]);
  });

  it('getCallerSignatures → [] when repoIntelEnabled=false', async () => {
    const svc = buildDegradedService({ flag: false });
    await expect(svc.getCallerSignatures('r1', ['a.ts'])).resolves.toEqual([]);
  });

  it('getBlastRadius → degraded-but-valid shape (never throws)', async () => {
    const svc = buildDegradedService({ flag: false, basics: null });
    const blast = await svc.getBlastRadius('r1', ['a.ts']);
    // Shape (every key present, arrays where arrays go) — consumers assume this.
    expect(Array.isArray(blast.changedSymbols)).toBe(true);
    expect(Array.isArray(blast.callers)).toBe(true);
    expect(Array.isArray(blast.impactedEndpoints)).toBe(true);
    expect(blast.degraded).toBe(true);
    // reason is one of the documented DegradedReason values
    expect(['flag_off', 'no_data', 'index_failed', 'index_partial', 'repo_too_large'])
      .toContain(blast.reason);
  });

  it('getIndexState → degraded row (never throws) when no row exists', async () => {
    const svc = buildDegradedService({ flag: false, indexStateRow: null });
    const state = await svc.getIndexState('r1');
    // Always-present fields the UI / dashboard rely on (client bind).
    expect(state.repoId).toBe('r1');
    expect(state.status).toBe('degraded');
    expect(state.filesIndexed).toBe(0);
    expect(state.filesSkipped).toBe(0);
    expect(state.lastIndexedSha).toBe(''); // empty string, not undefined — JSON-safe
    expect(state.indexerVersion).toBeGreaterThanOrEqual(1);
    expect(state.updatedAt instanceof Date).toBe(true);
    expect(state.degraded).toBe(true);
  });

  /**
   * The flag beats the row, and this is the one degraded answer that is load
   * bearing rather than cosmetic: `blast/service.ts` GATES on this status before
   * calling `getBlastRadius`, whose fallback reads the clone and parses it. A
   * repo indexed last week still has `status: 'full'` in Postgres, so reporting
   * the row here while `getBlastRadius` separately refuses the index (service.ts:
   * 225) is what opened the request path onto that AST work.
   */
  it('getIndexState → degraded/flag_off even when a FULL row is persisted', async () => {
    const row: IndexState = {
      repoId: 'r1',
      status: 'full',
      filesIndexed: 312,
      filesSkipped: 0,
      durationMs: 4200,
      lastIndexedSha: '66727c85ce06d7b16e64f888925d131d558cbe51',
      indexerVersion: 2,
      updatedAt: new Date('2026-07-28T19:08:16Z'),
    };
    const svc = buildDegradedService({ flag: false, indexStateRow: row });

    const state = await svc.getIndexState('r1');

    expect(state.status).toBe('degraded');
    expect(state.degraded).toBe(true);
    expect(state.degradedReason).toBe('flag_off');
    expect(state.reason).toBe('flag_off');
    // No sha either: with the flag off nothing is served from that commit, so a
    // consumer must not link line numbers to it.
    expect(state.lastIndexedSha).toBe('');
  });

  it('getIndexState → the persisted row untouched when the flag is ON', async () => {
    const row: IndexState = {
      repoId: 'r1',
      status: 'full',
      filesIndexed: 312,
      filesSkipped: 0,
      durationMs: 4200,
      lastIndexedSha: '66727c85ce06d7b16e64f888925d131d558cbe51',
      indexerVersion: 2,
      updatedAt: new Date('2026-07-28T19:08:16Z'),
    };
    const svc = buildDegradedService({ flag: true, indexStateRow: row });

    await expect(svc.getIndexState('r1')).resolves.toEqual(row);
  });

  it('getRepoMap → degraded ({ text:"", tokens:0, cached:false, degraded:true })', async () => {
    const svc = buildDegradedService({ flag: false });
    const map = await svc.getRepoMap('r1');
    expect(map.text).toBe('');
    expect(map.tokens).toBe(0);
    expect(map.cached).toBe(false);
    expect(map.degraded).toBe(true);
  });

  it('getFileRank / getSymbolsInFiles / getConventionSamples / getTopFilesByRank / getCriticalPaths → []', async () => {
    const svc = buildDegradedService({ flag: false });
    await expect(svc.getFileRank('r1', ['a.ts'])).resolves.toEqual([]);
    await expect(svc.getSymbolsInFiles('r1', ['a.ts'])).resolves.toEqual([]);
    await expect(svc.getConventionSamples('r1', 12)).resolves.toEqual([]);
    await expect(svc.getTopFilesByRank('r1', 7)).resolves.toEqual([]);
    await expect(svc.getCriticalPaths('r1')).resolves.toEqual([]);
  });

  it('indexRepo / refreshIndex → degraded T1 skeleton (never throws)', async () => {
    const svc = buildDegradedService({ flag: false });
    const a = await svc.indexRepo('r1');
    const b = await svc.refreshIndex('r1');
    expect(a.status).toBe('degraded');
    expect(b.status).toBe('degraded');
    expect(a.filesIndexed).toBe(0);
    expect(b.filesIndexed).toBe(0);
  });
});

describe('RepoIntel facade — degraded contract (flag on, but no data)', () => {
  it('getCallerSignatures with no clone → [] (graceful degrade, no throw)', async () => {
    const svc = buildDegradedService({ flag: true, basics: { id: 'r1', owner: 'a', name: 'b', clonePath: null } });
    await expect(svc.getCallerSignatures('r1', ['a.ts'])).resolves.toEqual([]);
  });

  it('getUnresolvedReferences with no clone → []', async () => {
    const svc = buildDegradedService({ flag: true, basics: { id: 'r1', owner: 'a', name: 'b', clonePath: null } });
    await expect(svc.getUnresolvedReferences('r1', ['a.ts'])).resolves.toEqual([]);
  });

  it('getCallerSignatures with empty changedFiles → []', async () => {
    const svc = buildDegradedService({ flag: true, basics: { id: 'r1', owner: 'a', name: 'b', clonePath: '/tmp' } });
    await expect(svc.getCallerSignatures('r1', [])).resolves.toEqual([]);
  });
});

/**
 * The RIPGREP path of `getBlastRadius` — reached when the flag is on but no
 * `repo_index_state` row exists, so `tryPersistentBlast` declines.
 *
 * It used to cap nothing and report no `callerCounts`, which made the contract
 * unable to tell the truth: `contracts/blast.ts` promises `caller_count` is the
 * PRE-cap number, and a consumer with only the array can derive `truncated`
 * exactly once — as `false`. Meanwhile an unbounded caller array went out over
 * the wire to the card and to MCP.
 */
describe('getBlastRadius — the degraded path caps per symbol too', () => {
  const DECL = 'src/service.ts';
  const RAW_CALLERS = 21;

  /**
   * 21 files calling `ReviewService`, plus 2 calling `reapStaleRuns`, so the cap
   * is visibly per symbol. `symbols` doubles as the enclosing-symbol lookup, so
   * every caller file declares one.
   */
  const codeIndex = () => ({
    symbols: async () => [
      { path: DECL, name: 'ReviewService', kind: 'class', line: 41 },
      { path: DECL, name: 'reapStaleRuns', kind: 'method', line: 118 },
      ...Array.from({ length: RAW_CALLERS }, (_, i) => ({
        path: `src/caller-${String(i).padStart(2, '0')}.ts`,
        name: `handler${i}`,
        kind: 'function',
        line: 1,
      })),
    ],
    references: async (_ref: unknown, name: string) =>
      name === 'ReviewService'
        ? Array.from({ length: RAW_CALLERS }, (_, i) => ({
            fromPath: `src/caller-${String(i).padStart(2, '0')}.ts`,
            line: 10 + i,
          }))
        : [
            { fromPath: 'src/caller-00.ts', line: 200 },
            { fromPath: 'src/caller-01.ts', line: 201 },
          ],
  });

  const service = () =>
    buildDegradedService({
      flag: true,
      basics: { id: 'r1', owner: 'a', name: 'b', clonePath: '/nonexistent-clone' },
      indexStateRow: null, // no persistent index → the ripgrep path
      codeIndex: codeIndex(),
    });

  it('returns 20 callers and a pre-cap count of 21, not 21 uncapped rows', async () => {
    const blast = await service().getBlastRadius('r1', [DECL]);

    expect(blast.degraded).toBe(true);
    expect(blast.callers.filter((c) => c.viaSymbol === 'ReviewService')).toHaveLength(20);
    expect(blast.callerCounts?.ReviewService).toBe(RAW_CALLERS);
    // Per symbol, not global: the second symbol keeps both of its callers.
    expect(blast.callerCounts?.reapStaleRuns).toBe(2);
    expect(blast.callers.filter((c) => c.viaSymbol === 'reapStaleRuns')).toHaveLength(2);
  });

  it('orders what survives the cap by file then line, since every rank here is 0', async () => {
    const blast = await service().getBlastRadius('r1', [DECL]);
    const kept = blast.callers.filter((c) => c.viaSymbol === 'ReviewService');

    expect(kept.every((c) => c.rank === 0)).toBe(true);
    expect(kept.map((c) => c.file)).toEqual([...kept.map((c) => c.file)].sort());
    // Alphabetical, so the dropped one is the last filename — deterministic, and
    // NOT a claim that it is the least important.
    expect(kept.map((c) => c.file)).not.toContain('src/caller-20.ts');
  });
});
