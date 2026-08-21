import type { OnboardingIndexState, OnboardingRecord, OnboardingRefusal } from '@devdigest/shared';
import type { IndexSnapshot } from './types.js';

/**
 * onboarding · the gate and the staleness rule — Core. Pure functions over an
 * `IndexSnapshot`: no I/O, no container, no clock.
 *
 * They live in ONE place because both answers are served twice: `generate_blocked`
 * on every read and the 409 on every generate come from `refusalFor`, and the
 * client is deliberately not given the ingredients to re-derive either. Letting
 * it try would put this table in two places and two languages, and drift is
 * guaranteed the first time the rule changes.
 */

/**
 * Why generating is refused, or `null` when it would run.
 *
 * THE HONEST BOUNDARY, stated rather than papered over: `IndexStatus` is
 * `full | partial | degraded | failed` and has NO "building" member, so "indexing
 * has just started" and "indexing never started" are the same observation here.
 * `index_missing` is therefore a statement about the present and not a promise
 * that waiting helps — which is exactly what AC-84 requires of the id and of the
 * copy built on it.
 *
 * A fourth cause, `flag_off`, is folded into `index_missing` because AC-83 fixes
 * the count at three. That distinction is not lost: the service logs the
 * underlying `degradedReason` on every refusal, and the log is where it lives.
 *
 * The order of the checks is the table, and it is load-bearing at exactly one
 * row: the pipeline's `no_clone` early exit persists `status: 'degraded'` with
 * `degradedReason: 'no_data'`, which is "there is nothing to read yet", not "the
 * indexer fell over". Testing the reason before the degraded flag is what keeps
 * a clone that has not finished out of `index_failed`.
 */
export function refusalFor(index: IndexSnapshot): OnboardingRefusal | null {
  // Stamped by the pipeline's catch: the run crashed part-way. The previous
  // pass's sha and counters are still on the row, which is why this cannot be
  // told from a good index by the numbers alone.
  if (index.status === 'failed') return 'index_failed';

  // Nothing to read: no row at all, the feature flag off, or a clone that has
  // not finished. All three are `index_missing`; the reason survives in the log.
  if (index.degradedReason === 'no_data' || index.degradedReason === 'flag_off') {
    return 'index_missing';
  }

  // Any other degradation is the indexer reporting that the pass did not hold —
  // `index_partial`, `repo_too_large`, or a `degraded` status with no reason.
  if (index.status === 'degraded' || index.degraded === true) return 'index_failed';

  // A COMPLETED pass that indexed nothing: `walkClone` found no file with a
  // supported extension, and the pipeline persists exactly this shape —
  // `status: 'partial'`, `filesIndexed: 0`, `stats.reason: 'no_files'`. The tour
  // would have no source to describe, so this is a property of the repository's
  // languages rather than of the index.
  if (index.filesIndexed === 0) return 'language_unsupported';

  // `partial` with files is a working index, and AC-64 says it generates: what
  // was skipped travels to the reader as `files_skipped` instead of blocking.
  return null;
}

/**
 * Has the index moved past the state this tour was built from?
 *
 * The empty-string guard is load-bearing rather than defensive. A plain `!==`
 * would report a perfectly good tour as stale the moment the index row went
 * missing — `getIndexState` synthesises `lastIndexedSha: ''` for "no row" and
 * for "flag off" — which is the opposite of what AC-56 describes. An unknown
 * current sha is not evidence that the tour is behind anything.
 *
 * Seeing `true` starts NOTHING. Regenerating is always an explicit human action;
 * staleness is visible so it can be judged, not so it can trigger spend.
 */
export function isStale(record: OnboardingRecord | null, index: IndexSnapshot): boolean {
  if (!record) return false;
  if (index.lastIndexedSha === '') return false;
  return index.lastIndexedSha !== record.index_state.last_indexed_sha;
}

/**
 * Did the index row move under a generation that had already passed the gate?
 *
 * `updatedAt` IS THE COMPARISON, and `lastIndexedSha` on its own is not enough.
 * Every writer of `repo_index_state` bumps `updated_at` — `upsertIndexState`,
 * `touchIndexState` and `advanceSha` in `repo-intel/repository.ts` — while a
 * resync on the SAME HEAD rewrites the row with the sha it already had. That is
 * the dangerous case rather than the exotic one: the reindex deletes every
 * symbol and reference before it writes its state row, so a generation running
 * inside that window reads an emptied index, and a sha comparison would then
 * call the thin tour it produced perfectly fresh.
 *
 * The sha is compared as well, as a second witness that costs nothing: it is
 * the field whose change means the index points at different code, whatever a
 * clock did.
 */
export function indexMoved(before: IndexSnapshot, after: IndexSnapshot): boolean {
  if (before.updatedAt.getTime() !== after.updatedAt.getTime()) return true;
  return before.lastIndexedSha !== after.lastIndexedSha;
}

/**
 * The facade's snapshot as the contract's stamp — the one place `camelCase`
 * becomes `snake_case` in this slice.
 *
 * `files_indexed` is the facade's `filesIndexed` unmodified and not renamed
 * (AC-75): one number, one name, all the way to the screen.
 */
export function toIndexState(index: IndexSnapshot): OnboardingIndexState {
  return {
    last_indexed_sha: index.lastIndexedSha,
    files_indexed: index.filesIndexed,
    files_skipped: index.filesSkipped,
    status: index.status,
  };
}

/**
 * The same stamp plus the moment the index row was written, which the page
 * carries and the record does not: a reader comparing two states wants to know
 * how old the current one is, while a stamp on a stored tour is provenance and
 * needs no second timestamp beside `generated_at`.
 *
 * The epoch is a real answer here, not a missing one — `getIndexState`
 * synthesises `new Date(0)` precisely so nothing downstream reads a synthesised
 * row as freshly indexed.
 */
export function toPageIndex(index: IndexSnapshot): OnboardingIndexState & { updated_at: string } {
  return { ...toIndexState(index), updated_at: index.updatedAt.toISOString() };
}
