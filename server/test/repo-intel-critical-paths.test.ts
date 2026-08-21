import { describe, it, expect } from 'vitest';
import { RepoIntelService } from '../src/modules/repo-intel/service.js';
import { BFS_DEPTH, CRITICAL_PATH_CHAINS } from '../src/modules/repo-intel/constants.js';

/**
 * Supply properties of `getCriticalPaths` — the chains the onboarding reading
 * path is generated from. Hand-built edge and rank sets, no Postgres and no
 * container beyond the flag: the service's repository is patched the way
 * `repo-intel-facade-degraded.test.ts` patches it.
 *
 * The measurement these cases encode ran against the real index of
 * `Holubinka/dev-digest` (656 ranked files, 1113 edges) on 2026-08-18: seeding
 * from the top 20 ranked files yields 7 chains because 13 of those 20 import
 * nothing, while walking the rank list until 20 chains are collected yields 20,
 * the longest of them 5 files.
 */

type Edge = { fromFile: string; toFile: string };

interface Reads {
  edges: Edge[];
  ranked: Array<{ path: string; rank: number }>;
}

/** Highest rank first — the order `getRankedPaths` returns rows in. */
function ranksFor(paths: string[]): Array<{ path: string; rank: number }> {
  return paths.map((path, i) => ({ path, rank: 10_000 - i }));
}

function buildService(reads: Reads): { svc: RepoIntelService; calls: string[] } {
  const calls: string[] = [];
  const container = { config: { repoIntelEnabled: true }, db: {} as never } as never;
  const svc = new RepoIntelService(container);
  (svc as unknown as { repo: Record<string, unknown> }).repo = {
    getEdges: async (repoId: string) => {
      calls.push(`getEdges:${repoId}`);
      return reads.edges;
    },
    getRankedPaths: async (repoId: string, limit: number) => {
      calls.push(`getRankedPaths:${repoId}:${limit}`);
      return reads.ranked;
    },
  };
  return { svc, calls };
}

const seq = (n: number, make: (i: string) => string): string[] =>
  Array.from({ length: n }, (_, i) => make(String(i).padStart(2, '0')));

/**
 * `leafCount` top-ranked files that import nothing, then `importerCount` files
 * that each import one distinct dependency. The shape the real index has.
 */
function leavesThenImporters(leafCount: number, importerCount: number): Reads {
  const leaves = seq(leafCount, (i) => `src/leaf-${i}.ts`);
  const importers = seq(importerCount, (i) => `src/importer-${i}.ts`);
  const deps = seq(importerCount, (i) => `src/dep-${i}.ts`);
  return {
    edges: importers.map((fromFile, i) => ({ fromFile, toFile: deps[i] })),
    ranked: ranksFor([...leaves, ...importers, ...deps]),
  };
}

function isPrefixOf(a: string[], b: string[]): boolean {
  return a.length < b.length && a.every((v, i) => v === b[i]);
}

describe('getCriticalPaths — chain supply', () => {
  it('yields 20 chains when the 20 top-ranked files import nothing and the next 20 do', async () => {
    const { svc } = buildService(leavesThenImporters(20, 20));

    const chains = await svc.getCriticalPaths('r1');

    expect(chains).toHaveLength(20);
    // Every chain is rooted in the second block — never in a top-ranked leaf.
    expect(chains.map((c) => c[0])).toEqual(seq(20, (i) => `src/importer-${i}.ts`));
    expect(chains.every((c) => c.length === 2)).toBe(true);
  });

  it('stops at CRITICAL_PATH_CHAINS — the ceiling counts chains kept, not roots tried', async () => {
    const { svc } = buildService(leavesThenImporters(20, 30));

    const chains = await svc.getCriticalPaths('r1');

    expect(chains).toHaveLength(20);
  });

  it('returns no chain that is a prefix of another, on a graph built to tempt it', async () => {
    // `b` is both the second file of a's chain and a root in its own right.
    const { svc } = buildService({
      edges: [
        { fromFile: 'src/a.ts', toFile: 'src/b.ts' },
        { fromFile: 'src/b.ts', toFile: 'src/c.ts' },
      ],
      ranked: ranksFor(['src/a.ts', 'src/b.ts', 'src/c.ts']),
    });

    const chains = await svc.getCriticalPaths('r1');

    expect(chains).toEqual([['src/a.ts', 'src/b.ts', 'src/c.ts']]);
    // The guard means nothing unless it can fire.
    expect(isPrefixOf(['src/a.ts'], ['src/a.ts', 'src/b.ts'])).toBe(true);
    for (const a of chains) {
      expect(chains.some((b) => isPrefixOf(a, b))).toBe(false);
    }
  });

  /**
   * The SUFFIX case, which is the one the exact-duplicate key could never see.
   * Measured on the real method 2026-08-19: before the covered-root skip this
   * same graph returned five chains — `[a,b,c,d,e] [b,c,d,e,f] [c,d,e,f]
   * [d,e,f] [e,f]` — so one import line spent five of the twenty supply slots
   * on one flow, and `MAX_FLOWS = 20` then let the model draw twenty
   * near-identical flows on the page.
   */
  it('spends ONE slot on one import line, not one slot per file in it', async () => {
    const line = ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts', 'src/e.ts', 'src/f.ts'];
    const { svc } = buildService({
      edges: line.slice(0, -1).map((fromFile, i) => ({ fromFile, toFile: line[i + 1] })),
      ranked: ranksFor(line),
    });

    const chains = await svc.getCriticalPaths('r1');

    expect(chains).toEqual([['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts', 'src/e.ts']]);
  });

  /**
   * The skip is on the ROOT and on nothing else. Two entry points that meet at
   * one shared dependency are two flows a reader has to know about, and
   * suppressing the second would be the same defect with the sign flipped.
   */
  it('keeps a second chain into a file an earlier chain already carried', async () => {
    const { svc } = buildService({
      edges: [
        { fromFile: 'src/http.ts', toFile: 'src/db.ts' },
        { fromFile: 'src/worker.ts', toFile: 'src/db.ts' },
      ],
      ranked: ranksFor(['src/http.ts', 'src/worker.ts', 'src/db.ts']),
    });

    expect(await svc.getCriticalPaths('r1')).toEqual([
      ['src/http.ts', 'src/db.ts'],
      ['src/worker.ts', 'src/db.ts'],
    ]);
  });

  it('reaches 5 files in one chain when the graph allows one', async () => {
    const line = ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts', 'src/e.ts', 'src/f.ts'];
    const { svc } = buildService({
      edges: line.slice(0, -1).map((fromFile, i) => ({ fromFile, toFile: line[i + 1] })),
      ranked: ranksFor(line),
    });

    const chains = await svc.getCriticalPaths('r1');

    expect(chains[0]).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts', 'src/e.ts']);
    expect(chains[0]).toHaveLength(5);
  });

  it('seeds no chain on a junk path or on a file that imports nothing', async () => {
    const { svc } = buildService({
      edges: [
        { fromFile: 'src/foo.test.ts', toFile: 'src/foo.ts' },
        { fromFile: 'src/app.ts', toFile: 'src/util.ts' },
      ],
      // The junk file and the import-less leaf outrank the one real root.
      ranked: ranksFor(['src/foo.test.ts', 'src/leaf.ts', 'src/app.ts', 'src/util.ts']),
    });

    const chains = await svc.getCriticalPaths('r1');

    expect(chains).toEqual([['src/app.ts', 'src/util.ts']]);
    expect(chains.map((c) => c[0])).not.toContain('src/foo.test.ts');
    expect(chains.map((c) => c[0])).not.toContain('src/leaf.ts');
  });

  it('adds no query: getEdges once, getRankedPaths once at 100_000', async () => {
    const { svc, calls } = buildService(leavesThenImporters(20, 30));

    await svc.getCriticalPaths('r1');

    expect(calls).toEqual(['getEdges:r1', 'getRankedPaths:r1:100000']);
  });

  it('holds the two numbers the onboarding module restates without importing', () => {
    expect(CRITICAL_PATH_CHAINS).toBe(20);
    expect(BFS_DEPTH).toBe(4);
  });
});
