import { z } from 'zod';
import { OnboardingDraft } from './knowledge.js';

/**
 * onboarding · the wire — what the two routes answer with.
 *
 *   GET  /repos/:id/onboarding          → OnboardingPage    (zero model calls, always)
 *   POST /repos/:id/onboarding/generate → OnboardingRecord  (one generation)
 *
 * Four declarations and no more. Everything the tour itself is made of — the
 * sections, the packages, the drop counters, the five numbers of the one call —
 * is declared ONCE in `knowledge.ts`, beside the pipeline that produces it, and
 * arrives here whole as `OnboardingDraft`. This file adds the two facts only the
 * persisting half knows: the index state its gate approved, and the moment it
 * wrote.
 *
 * PARSE-ON-READ IS LOAD-BEARING HERE. The record is stored in a jsonb column and
 * this schema is what turns that untyped value back into the contract, so every
 * field added to it later needs a `.default(...)` — a count `.default(0)`, an
 * array `.default([])`. Without one, every row written before the field existed
 * fails to parse, and the failure is reported against the caller who merely read
 * it (`server/INSIGHTS.md`, "a contract field removed later is a 422 blamed on
 * the caller"). The same obligation runs through `OnboardingDraft`, and it is
 * stated there too.
 */

/**
 * The index the tour was built from — a snapshot, stamped by the write, never
 * recomputed on read.
 *
 * `status` RESTATES the four values of `IndexStatus`
 * (`server/src/modules/repo-intel/types.ts`) as a local enum rather than
 * importing it, and that is deliberate: the client compiles only against its
 * vendored copy of this folder and cannot see a server module at all. Do not
 * "fix" it into an import — it would break the client build while the server
 * kept type-checking, which is exactly the drift the `repo · vendor` gate
 * exists to catch and the type system cannot.
 *
 * The field names are `snake_case` like every other contract key here. The
 * `camelCase` shape the facade hands over (`filesIndexed`, `lastIndexedSha`)
 * stops at the service — this is where it becomes the wire.
 */
export const OnboardingIndexState = z.object({
  /** `''` when there is no index row at all. Load-bearing for staleness. */
  last_indexed_sha: z.string().default(''),
  /** The facade's `filesIndexed`, unmodified and not renamed (AC-75). */
  files_indexed: z.number().int().default(0),
  files_skipped: z.number().int().default(0),
  status: z.enum(['full', 'partial', 'degraded', 'failed']),
});
export type OnboardingIndexState = z.infer<typeof OnboardingIndexState>;

/**
 * Why generating is refused, when it is. Exactly three, because `IndexStatus`
 * can express exactly three (AC-83).
 *
 * `index_missing` is a statement about the present and NOT a promise about the
 * future: `IndexStatus` has no "building" member, so "indexing has just started"
 * and "indexing never started" are the same observation, and neither this id nor
 * the copy built on it may claim that waiting helps (AC-84).
 *
 * Each one is also an `error.code` on the POST, prefixed `onboarding_` — the
 * client already surfaces `code` as `ApiError.code`, where `details` would have
 * to be parsed and validated a second time.
 */
export const OnboardingRefusal = z.enum([
  'index_missing',
  'index_failed',
  'language_unsupported',
]);
export type OnboardingRefusal = z.infer<typeof OnboardingRefusal>;

/**
 * Why a GENERATION was refused — the three gate reasons above, plus the one
 * that cannot be known until the model has already answered.
 *
 * `index_changed` is a fourth identifier because none of the three fits by
 * meaning: the index is not missing (it is there), it did not fail (the pass
 * may well have succeeded), and the repository's languages never changed. What
 * happened is that `repo_index_state` was REWRITTEN between the gate and the
 * generator's answer — and a reindex erases `symbols` and `references` long
 * before it writes that row, so the draft was assembled from an emptied index.
 *
 * It is declared HERE rather than as a fourth member of `OnboardingRefusal`,
 * and the split is the honest one. `OnboardingRefusal` is the gate's
 * vocabulary, answered on every read as `generate_blocked`; this reason exists
 * only inside a generation window and can never be answered on a read.
 * Widening that enum would make the page contract admit a value the gate can
 * never produce and oblige the screen to carry copy for a state it can never
 * show — while AC-83 fixes the reader's vocabulary at three.
 *
 * On the wire it is the POST's `error.code`, prefixed like the others:
 * `onboarding_index_changed`, HTTP 409. Nothing was saved; the previous tour is
 * untouched and generating again is the whole remedy.
 */
export const OnboardingGenerateRefusal = z.enum([
  ...OnboardingRefusal.options,
  'index_changed',
]);
export type OnboardingGenerateRefusal = z.infer<typeof OnboardingGenerateRefusal>;

/**
 * One saved tour: the draft exactly as generated, plus two stamps.
 *
 * The `.extend()` is collision-free BY CONSTRUCTION rather than by agreement —
 * `OnboardingDraft` carries no stamp of its own, so there is nothing here for it
 * to silently overwrite. That property is worth a test on its own
 * (`test/onboarding-contract.test.ts`) because breaking it produces a VALID
 * schema and no error anywhere: each package compiles against its own vendored
 * copy, and the client does not validate responses at runtime.
 *
 * Nothing in the draft is restated here, renamed here, or recomputed here. The
 * numbers AC-52 names (`attempts`, `input_tokens_counted`, `tokenizer`,
 * `tokens_in`, `cost_usd`) and the five drop counters ride through untouched.
 */
export const OnboardingRecord = OnboardingDraft.extend({
  /**
   * The state the gate approved AND the write re-verified. `generate` reads the
   * index state a second time when the generator returns and refuses to save at
   * all if it moved (`onboarding_index_changed`, 409), so this stamp names a
   * state that was still current at the moment the row was written.
   *
   * That is what lets `stale` be read as a fact about the index rather than
   * about a race: a tour stamped with a state that had already been replaced
   * mid-generation would report itself fresh while describing an index that was
   * being erased as it was read.
   */
  index_state: OnboardingIndexState,
  /** ISO-8601, stamped by the write. */
  generated_at: z.string(),
});
export type OnboardingRecord = z.infer<typeof OnboardingRecord>;

/**
 * What the screen reads. One primary-key row, plus tenancy, plus the facade's
 * current index state — and no model call, however many times it is read
 * (AC-46).
 */
export const OnboardingPage = z.object({
  /** `null` means "nothing generated yet", never an error (AC-62). */
  tour: OnboardingRecord.nullable(),
  /**
   * The CURRENT index, read fresh on every request — not the stamp on the tour.
   * The two together are what make staleness visible.
   */
  index: OnboardingIndexState.extend({ updated_at: z.string() }),
  /**
   * `true` when the index has moved past the state the tour was built from.
   * Computed on the server and NEVER derived on the client: the empty-sha guard
   * behind it would otherwise live in two languages (AC-56).
   *
   * Seeing it starts nothing. Regenerating is always an explicit human action.
   */
  stale: z.boolean(),
  /**
   * Why the Generate button would be refused, or `null` when it would run. The
   * gate is the server's rule and is answered here so the client never rebuilds
   * it from `index`.
   *
   * A refusal blocks GENERATING only. A saved tour is still served beside it —
   * reading is never blocked (AC-60).
   */
  generate_blocked: OnboardingRefusal.nullable(),
});
export type OnboardingPage = z.infer<typeof OnboardingPage>;
