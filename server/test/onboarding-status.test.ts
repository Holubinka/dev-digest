/**
 * P1.10 — the gate and the staleness rule, over hand-built snapshots.
 *
 * `status.ts` is Core: no I/O, no container, no clock. That is what lets the
 * whole refusal table be exercised here in milliseconds, including the two rows
 * that are expensive to reach for real — a crashed indexing pass and a
 * repository written in a language the walk does not index.
 *
 * The snapshots below are the SHAPES THE PIPELINE ACTUALLY PERSISTS, not shapes
 * invented to satisfy the branches. Each names where it comes from, because a
 * gate tested against imaginary input is a gate tested against nothing.
 */
import { describe, it, expect } from 'vitest';
import {
  indexMoved,
  isStale,
  refusalFor,
  toIndexState,
  toPageIndex,
} from '../src/modules/onboarding/status.js';
import type { IndexSnapshot } from '../src/modules/onboarding/types.js';
import type { OnboardingRecord } from '@devdigest/shared';

const base: IndexSnapshot = {
  status: 'full',
  filesIndexed: 412,
  filesSkipped: 3,
  lastIndexedSha: 'a1b2c3d4',
  updatedAt: new Date('2026-08-18T09:00:00.000Z'),
};

const snapshot = (over: Partial<IndexSnapshot>): IndexSnapshot => ({ ...base, ...over });

/** Only `index_state` is read by these two functions; the tour itself is irrelevant here. */
const tourBuiltOn = (sha: string) =>
  ({ index_state: { last_indexed_sha: sha } }) as unknown as OnboardingRecord;

describe('onboarding gate — the five rows of the refusal table (AC-83)', () => {
  /** `repo-intel/service.ts` synthesises this when `tryGetIndexState` finds no row. */
  it('no index row at all is index_missing', () => {
    expect(
      refusalFor(
        snapshot({
          status: 'degraded',
          degraded: true,
          degradedReason: 'no_data',
          filesIndexed: 0,
          filesSkipped: 0,
          lastIndexedSha: '',
          updatedAt: new Date(0),
        }),
      ),
    ).toBe('index_missing');
  });

  /**
   * `REPO_INTEL_ENABLED=false`. A FOURTH cause folded into the third reason,
   * because AC-83 fixes the count at three — the distinction survives in the
   * service's log line, not in the id.
   */
  it('the feature flag being off is index_missing too', () => {
    expect(
      refusalFor(
        snapshot({
          status: 'degraded',
          degraded: true,
          degradedReason: 'flag_off',
          filesIndexed: 0,
          lastIndexedSha: '',
        }),
      ),
    ).toBe('index_missing');
  });

  /**
   * The pipeline's `no_clone` early exit: `status: 'degraded'` with
   * `degradedReason: 'no_data'` and `reason: 'no_clone'`. It is the row that
   * makes the ORDER of the checks load-bearing — a clone that has not finished
   * is "nothing to read yet", never "the indexer fell over".
   */
  it('a clone that has not finished is index_missing, not index_failed', () => {
    expect(
      refusalFor(
        snapshot({
          status: 'degraded',
          degraded: true,
          degradedReason: 'no_data',
          reason: 'no_clone',
          filesIndexed: 0,
          filesSkipped: 0,
          lastIndexedSha: '',
        }),
      ),
    ).toBe('index_missing');
  });

  /**
   * The row P1.9 made reachable. Before that step nothing in the repository ever
   * wrote `status: 'failed'` to `repo_index_state`, so this branch was live on
   * read and dead on write — an index that crashed was indistinguishable from
   * one that never ran. Note the carried-forward sha and counters: the stamp
   * costs the STATUS only.
   */
  it('a crashed indexing pass is index_failed, previous facts and all', () => {
    expect(
      refusalFor(
        snapshot({
          status: 'failed',
          degraded: true,
          degradedReason: 'index_failed',
          reason: 'index_failed',
          filesIndexed: 412,
          lastIndexedSha: 'a1b2c3d4',
        }),
      ),
    ).toBe('index_failed');
  });

  it('any other degradation is index_failed as well', () => {
    expect(
      refusalFor(snapshot({ status: 'degraded', degraded: true, degradedReason: 'repo_too_large' })),
    ).toBe('index_failed');
  });

  /**
   * `pipeline/full.ts` persists exactly this when `walkClone` returns no file
   * with a supported extension: a COMPLETED pass, `partial`, zero files,
   * `stats.reason: 'no_files'`. Nothing is degraded — the index is fine, the
   * repository simply has nothing this indexer reads.
   */
  it('a completed pass that indexed zero files is language_unsupported (AC-73)', () => {
    expect(
      refusalFor(
        snapshot({ status: 'partial', filesIndexed: 0, filesSkipped: 2, reason: 'no_files' }),
      ),
    ).toBe('language_unsupported');
  });

  it('a full index generates', () => {
    expect(refusalFor(base)).toBeNull();
  });

  /** AC-64: `partial` is a working index. What was skipped travels, it does not block. */
  it('a PARTIAL index with files generates, and does not refuse (AC-64)', () => {
    expect(refusalFor(snapshot({ status: 'partial', filesIndexed: 40, filesSkipped: 900 }))).toBeNull();
  });
});

describe('onboarding staleness (AC-56)', () => {
  it('is false when there is no tour to be stale', () => {
    expect(isStale(null, base)).toBe(false);
  });

  it('is false while the index still names the sha the tour was built from', () => {
    expect(isStale(tourBuiltOn('a1b2c3d4'), base)).toBe(false);
  });

  it('is true once the index has moved past it', () => {
    expect(isStale(tourBuiltOn('a1b2c3d4'), snapshot({ lastIndexedSha: 'ffff0000' }))).toBe(true);
  });

  /**
   * THE EDGE THE GUARD EXISTS FOR. `getIndexState` synthesises
   * `lastIndexedSha: ''` for "no row" and for "flag off", so a plain `!==` would
   * report a perfectly good tour as stale the moment the index row went missing
   * — the opposite of what AC-56 describes. An unknown current sha is not
   * evidence that anything moved.
   */
  it('is FALSE when the index row has gone missing, not true', () => {
    expect(
      isStale(
        tourBuiltOn('a1b2c3d4'),
        snapshot({ status: 'degraded', degraded: true, degradedReason: 'no_data', lastIndexedSha: '' }),
      ),
    ).toBe(false);
  });
});

describe('onboarding — the snapshot becomes the wire', () => {
  it('renames camelCase to snake_case and changes no number (AC-75)', () => {
    expect(toIndexState(base)).toEqual({
      last_indexed_sha: 'a1b2c3d4',
      files_indexed: 412,
      files_skipped: 3,
      status: 'full',
    });
  });

  it('the page carries the moment the index row was written; the epoch is a real answer', () => {
    expect(toPageIndex(snapshot({ updatedAt: new Date(0) })).updated_at).toBe(
      '1970-01-01T00:00:00.000Z',
    );
  });
});

/**
 * The window between the gate and the generator's answer. `isStale` compares a
 * tour against the index; this compares the index against ITSELF, either side
 * of a generation that nothing held still.
 */
describe('onboarding — did the index move under a running generation', () => {
  it('is false when both reads answered with the same row', () => {
    expect(indexMoved(base, snapshot({}))).toBe(false);
  });

  /**
   * THE CASE A SHA COMPARISON MISSES, and the reason `updated_at` is the
   * comparison: a resync on the same HEAD rewrites `repo_index_state` with the
   * sha it already had, having first deleted every symbol and reference for the
   * repo. A tour built in that window is thin and, judged by sha alone, fresh.
   */
  it('is TRUE for a reindex on the same HEAD, where the sha never changed', () => {
    expect(
      indexMoved(base, snapshot({ updatedAt: new Date('2026-08-18T09:02:00.000Z') })),
    ).toBe(true);
  });

  it('is true when the index advanced to a new sha', () => {
    expect(
      indexMoved(
        base,
        snapshot({ lastIndexedSha: 'ffff0000', updatedAt: new Date('2026-08-18T09:02:00.000Z') }),
      ),
    ).toBe(true);
  });

  /** The row went missing mid-generation: `getIndexState` answers the epoch. */
  it('is true when the index row disappeared under the generation', () => {
    expect(
      indexMoved(
        base,
        snapshot({ status: 'degraded', degraded: true, degradedReason: 'no_data', lastIndexedSha: '', updatedAt: new Date(0) }),
      ),
    ).toBe(true);
  });
});
