/**
 * Step 4 — the reverse import-graph walk behind `RepoIntel.getDownstream`.
 *
 * Unit only: `collectDownstream` takes the two repository reads as a parameter,
 * so the whole walk runs over a hand-built edge set with no Db, no container and
 * no Docker. What a fake CANNOT pin is that the SQL reads the column pair the
 * right way round — that lives in `getDependents` and in the schema comment
 * (`file_edges.from_file` IMPORTS `file_edges.to_file`). The fake below mirrors
 * that query exactly, so if someone inverts the SQL the fake stops matching it
 * and `dependents, not dependencies` is the assertion that says so.
 */
import { describe, it, expect } from 'vitest';
import { collectDownstream } from '../src/modules/repo-intel/service.js';
import type {
  IndexerEdgeRow,
  IndexerFileFactsRow,
} from '../src/modules/repo-intel/repository.js';

const REPO = 'repo-1';

/**
 * "from imports to". Changed file under test is `repository.ts`:
 *
 *   db.ts        <- repository.ts     (a DEPENDENCY — must never be returned)
 *   repository.ts <- service.ts, helpers.ts, cli.ts        depth 1
 *                 <- routes.ts (via service.ts AND helpers.ts)   depth 2, once
 *                 <- cli.ts   (again, via service.ts)      already depth 1
 *                 <- app.ts   (via routes.ts)              depth 3 — absent
 *                 <- index.ts (via app.ts)                 depth 4 — absent
 */
const EDGES: IndexerEdgeRow[] = [
  { fromFile: 'repository.ts', toFile: 'db.ts' },
  { fromFile: 'service.ts', toFile: 'repository.ts' },
  { fromFile: 'helpers.ts', toFile: 'repository.ts' },
  { fromFile: 'cli.ts', toFile: 'repository.ts' },
  { fromFile: 'cli.ts', toFile: 'service.ts' },
  { fromFile: 'routes.ts', toFile: 'service.ts' },
  { fromFile: 'routes.ts', toFile: 'helpers.ts' },
  { fromFile: 'app.ts', toFile: 'routes.ts' },
  { fromFile: 'index.ts', toFile: 'app.ts' },
];

const FACTS: IndexerFileFactsRow[] = [
  { filePath: 'routes.ts', endpoints: ['GET /pulls/:id'], crons: [] },
  { filePath: 'cli.ts', endpoints: [], crons: ['0 3 * * *'] },
  { filePath: 'app.ts', endpoints: ['GET /health'], crons: [] },
];

/**
 * Stands in for `RepoIntelRepository`. `getDependents` reproduces
 * `SELECT DISTINCT from_file WHERE repo_id = ? AND to_file IN (?)` — reverse
 * lookup, deduped, ordered — and records the files each level was seeded with.
 */
function fakeRepo(edges: IndexerEdgeRow[], facts: IndexerFileFactsRow[]) {
  const seeds: string[][] = [];
  return {
    seeds,
    getDependents: async (_repoId: string, files: string[]): Promise<string[]> => {
      seeds.push([...files]);
      const wanted = new Set(files);
      const rows = edges.filter((e) => wanted.has(e.toFile)).map((e) => e.fromFile);
      return [...new Set(rows)].sort();
    },
    getFileFacts: async (
      _repoId: string,
      files: string[],
    ): Promise<IndexerFileFactsRow[]> => facts.filter((f) => files.includes(f.filePath)),
  };
}

describe('collectDownstream', () => {
  it('walks dependents, never dependencies', async () => {
    const out = await collectDownstream(fakeRepo(EDGES, FACTS), REPO, ['repository.ts'], 2);
    const files = out.map((r) => r.file);

    // service/helpers/cli import repository.ts → they break when it changes.
    expect(files).toContain('service.ts');
    expect(files).toContain('helpers.ts');
    expect(files).toContain('cli.ts');
    // repository.ts imports db.ts. db.ts is upstream, not downstream.
    expect(files).not.toContain('db.ts');
  });

  it('stops at depth 2 — a node reachable only at depth 3 is absent', async () => {
    const out = await collectDownstream(fakeRepo(EDGES, FACTS), REPO, ['repository.ts'], 2);
    const files = out.map((r) => r.file);

    expect(files).toContain('routes.ts'); // depth 2, present
    expect(files).not.toContain('app.ts'); // depth 3
    expect(files).not.toContain('index.ts'); // depth 4
    expect(Math.max(...out.map((r) => r.depth))).toBe(2);
  });

  it('clamps a caller asking for more than 2 back down to 2', async () => {
    const repo = fakeRepo(EDGES, FACTS);
    const out = await collectDownstream(repo, REPO, ['repository.ts'], 99);

    expect(out.map((r) => r.file)).not.toContain('app.ts');
    expect(repo.seeds).toHaveLength(2); // exactly two levels queried, not 99
  });

  it('dedupes a file reachable twice, keeping the smallest depth', async () => {
    const out = await collectDownstream(fakeRepo(EDGES, FACTS), REPO, ['repository.ts'], 2);

    // cli.ts imports repository.ts directly (1) AND service.ts (2).
    const cli = out.filter((r) => r.file === 'cli.ts');
    expect(cli).toHaveLength(1);
    expect(cli[0]!.depth).toBe(1);

    // routes.ts arrives via service.ts and via helpers.ts in the same level.
    expect(out.filter((r) => r.file === 'routes.ts')).toHaveLength(1);
  });

  it('excludes the changed files themselves', async () => {
    const changed = ['repository.ts', 'service.ts'];
    const out = await collectDownstream(fakeRepo(EDGES, FACTS), REPO, changed, 2);
    const files = out.map((r) => r.file);

    expect(files).not.toContain('repository.ts');
    // service.ts is a dependent of repository.ts AND is itself changed → still out.
    expect(files).not.toContain('service.ts');
    expect(files).toContain('routes.ts');
  });

  it('seeds each level with the previous level only', async () => {
    const repo = fakeRepo(EDGES, FACTS);
    await collectDownstream(repo, REPO, ['repository.ts'], 2);

    expect(repo.seeds[0]).toEqual(['repository.ts']);
    // Level 2 asks about the depth-1 files, not the changed set again.
    expect([...repo.seeds[1]!].sort()).toEqual(['cli.ts', 'helpers.ts', 'service.ts']);
  });

  it('enriches from file_facts and leaves unknown files with empty arrays', async () => {
    const out = await collectDownstream(fakeRepo(EDGES, FACTS), REPO, ['repository.ts'], 2);
    const byFile = new Map(out.map((r) => [r.file, r]));

    expect(byFile.get('routes.ts')).toEqual({
      file: 'routes.ts',
      depth: 2,
      endpoints: ['GET /pulls/:id'],
      crons: [],
    });
    expect(byFile.get('cli.ts')!.crons).toEqual(['0 3 * * *']);
    expect(byFile.get('helpers.ts')).toEqual({
      file: 'helpers.ts',
      depth: 1,
      endpoints: [],
      crons: [],
    });
  });

  it('returns [] and reads nothing when the changed set has no dependents', async () => {
    const repo = fakeRepo(EDGES, FACTS);
    // Nothing imports index.ts — it is the top of this graph.
    const out = await collectDownstream(repo, REPO, ['index.ts'], 2);

    expect(out).toEqual([]);
    expect(repo.seeds).toHaveLength(1); // level 2 never ran on an empty frontier
  });
});
