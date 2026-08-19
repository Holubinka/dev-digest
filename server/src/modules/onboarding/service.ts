import type {
  OnboardingDraft,
  OnboardingGenerateRefusal,
  OnboardingPage,
  OnboardingRecord,
} from '@devdigest/shared';
import { AppError, ConfigError, ExternalServiceError } from '../../platform/errors.js';
import { indexMoved, isStale, refusalFor, toIndexState, toPageIndex } from './status.js';
import type {
  OnboardingContainer,
  OnboardingLogger,
  OnboardingReader,
  OnboardingReads,
  OnboardingRepo,
} from './types.js';

/**
 * What each refusal says. The machine-readable half is the `error.code`; this is
 * the sentence beside it.
 *
 * `index_missing` promises nothing about waiting, and that is the whole
 * discipline of AC-84: `IndexStatus` cannot express "building", so a message
 * saying "try again shortly" would be a claim this server has no way to check.
 *
 * The first three are the GATE's vocabulary and are answered on every read as
 * `generate_blocked`. `index_changed` never is: it cannot be known until the
 * model has already answered. Hence `OnboardingGenerateRefusal` here rather
 * than `OnboardingRefusal` — and hence the only refusal in this file that
 * arrives after money has been spent.
 */
const REFUSAL_MESSAGES: Record<OnboardingGenerateRefusal, string> = {
  index_missing: 'This repository has no ready index yet, so there is nothing to build a tour from.',
  index_failed: 'The last indexing pass failed. Look at why it failed, then index again.',
  language_unsupported:
    'Indexing completed but found no files in a supported language, so there is no source to describe.',
  index_changed:
    'The index was rebuilt while this tour was being generated, so the tour describes a state that no longer exists. Nothing was saved — generate it again.',
};

/**
 * onboarding · read the saved tour, or spend once to make a new one.
 *
 * The two halves are deliberately asymmetric. `page` is a cached read that must
 * never cost money however many times it is opened (AC-46), so nothing on its
 * path can even reach a model — its container port has no `llm`. `generate` is
 * the paid action, and it is a human's explicit choice every time: nothing here
 * regenerates on a stale read, on an empty read, or on a schedule.
 *
 * Reading is NEVER blocked. A repo whose index has since failed still serves the
 * tour it has; only the Generate button is refused, and the refusal travels
 * beside the tour rather than instead of it.
 */
export class OnboardingService implements OnboardingReader {
  /**
   * The single-flight map (AC-74), keyed by `repoId` ALONE.
   *
   * Per INSTANCE, so it is a lock exactly as long as there is one instance —
   * which is why `platform/container.ts` memoises this service and nobody `new`s
   * it. A second instance gets a fresh empty Map and the guarantee silently
   * stops holding, with `pnpm arch` green throughout
   * (`server/INSIGHTS.md`, the brief's "lock by registration count").
   *
   * `repoId` and not `${repoId}:${sha}`, unlike the brief: there is exactly one
   * row per repo, so two runs on different shas would race to write the same
   * row. AC-74 asks for "already running for this repository", and `repoId` is
   * that. It carries no locale either — the language is fixed in code precisely
   * so the cache stays one row (AC-88).
   */
  private inFlight = new Map<string, Promise<OnboardingRecord>>();

  constructor(
    private container: OnboardingContainer,
    private repo: OnboardingReads,
  ) {}

  /**
   * The saved tour, the CURRENT index state, whether one has moved past the
   * other, and why generating would be refused.
   *
   * ZERO model calls, always (AC-46). The row and the facade read go out
   * together because neither needs the other's answer, which is what keeps this
   * inside the sub-150 ms budget the NFR sets.
   *
   * `undefined` means "not this workspace's repo"; the route turns it into the
   * same 404 an unknown id gets.
   */
  async page(
    workspaceId: string,
    repoId: string,
    log: OnboardingLogger,
  ): Promise<OnboardingPage | undefined> {
    const repo = await this.repo.getRepo(workspaceId, repoId);
    if (!repo) return undefined;

    const [tour, index] = await Promise.all([
      this.repo.get(repoId, log),
      this.container.repoIntel.getIndexState(repoId),
    ]);

    return {
      tour,
      index: toPageIndex(index),
      stale: isStale(tour, index),
      generate_blocked: refusalFor(index),
    };
  }

  /**
   * One generation: gate, spend, re-check, stamp, store — in that order and no
   * other.
   *
   * `undefined` means "not this workspace's repo", and it is answered BEFORE
   * anything is spent or joined: answering 502 for someone else's repo would be
   * both wrong and a confirmation that the id exists.
   */
  async generate(
    workspaceId: string,
    repoId: string,
    log: OnboardingLogger,
  ): Promise<OnboardingRecord | undefined> {
    const repo = await this.repo.getRepo(workspaceId, repoId);
    if (!repo) return undefined;

    const running = this.inFlight.get(repoId);
    if (running) return running;

    const attempt = this.run(workspaceId, repo, log);
    this.inFlight.set(repoId, attempt);
    try {
      return await attempt;
    } finally {
      this.inFlight.delete(repoId);
    }
  }

  /**
   * The whole generation. Throws; `generate` is what turns that into one shared
   * promise.
   *
   * The order below is the guarantee. The gate runs before the generator is even
   * reached, so a refusal costs zero model calls (AC-63); the write happens only
   * at the end, so every earlier throw leaves the previously stored tour exactly
   * as it was (AC-60).
   *
   * The RE-CHECK is the one refusal here that costs a model call, and it has to
   * be: whether the index held still is not knowable until the generation is
   * over.
   */
  private async run(
    workspaceId: string,
    repo: OnboardingRepo,
    log: OnboardingLogger,
  ): Promise<OnboardingRecord> {
    const index = await this.container.repoIntel.getIndexState(repo.id);
    const refusal = refusalFor(index);
    if (refusal) {
      // The underlying `degradedReason` is logged and not returned: AC-83 fixes
      // the reader's vocabulary at three reasons, and `flag_off` is a fourth
      // cause folded into `index_missing`. This line is where that distinction
      // lives, so an operator can tell "the feature is off" from "nothing has
      // been indexed" without the screen inventing a fourth state.
      log.warn(
        {
          repoId: repo.id,
          refusal,
          status: index.status,
          degradedReason: index.degradedReason,
          reason: index.reason,
          filesIndexed: index.filesIndexed,
        },
        'onboarding tour: generation refused by the index gate',
      );
      throw new AppError(`onboarding_${refusal}`, REFUSAL_MESSAGES[refusal], 409);
    }

    // The budget is sized to how big the repository IS, so it reads the true
    // file count rather than `index.filesIndexed` — that one accumulates across
    // incremental passes, and a repository refreshed often would drift to the
    // ceiling for ever while holding the same files. The record still stamps the
    // indexer's own counter in `index_state`: the two answer different questions
    // and are deliberately allowed to disagree.
    const filesIndexed = await this.container.repoIntel.countIndexedFiles(repo.id);

    let draft: OnboardingDraft;
    try {
      // Two arguments, `run` not `generate`, and no index SNAPSHOT: the
      // generator neither reads the index state nor stamps one.
      // Its `audit` is dropped here on purpose: the executor already writes it as
      // one line through this same logger, and the five contract counters it
      // carries are on the draft too.
      ({ draft } = await this.container.onboardingGenerator.run(
        { workspaceId, repo, filesIndexed },
        log,
      ));
    } catch (err) {
      // A ConfigError reaches the route as itself. "No key for the provider this
      // feature is pointed at" is a first-class state with its own copy and its
      // own link to Settings (AC-53); flattening it into a 502 turns the one
      // fault a user can fix into the one they cannot diagnose.
      if (err instanceof ConfigError) throw err;
      throw new ExternalServiceError((err as Error).message);
    }

    // Nothing held the index still while the generator worked, so the gate's
    // approval is verified against the CURRENT state before anything is
    // written. A reindex landing inside that window deletes every symbol and
    // reference for the repo (`repo-intel/pipeline/full.ts`, `deleteAllForRepo`)
    // long before it writes its new state row, so a draft assembled in there
    // describes an index that was being emptied as it was read.
    //
    // `updated_at` is what is compared, and the sha alone would not do: a
    // resync on the same HEAD rewrites the row with the sha it already had, so
    // `isStale` would answer false and the thin tour would look fresh and
    // authoritative to everyone who opened it. One discarded generation is the
    // price, named and accepted (human decision, 2026-08-18).
    const after = await this.container.repoIntel.getIndexState(repo.id);
    if (indexMoved(index, after)) {
      log.warn(
        {
          repoId: repo.id,
          gate: toIndexState(index),
          gateUpdatedAt: index.updatedAt.toISOString(),
          current: toIndexState(after),
          currentUpdatedAt: after.updatedAt.toISOString(),
        },
        'onboarding tour: the index moved during generation, discarding the draft',
      );
      throw new AppError('onboarding_index_changed', REFUSAL_MESSAGES.index_changed, 409);
    }

    // The stamp is the state both reads agreed on.
    const record: OnboardingRecord = {
      ...draft,
      index_state: toIndexState(index),
      generated_at: new Date().toISOString(),
    };
    await this.repo.upsert(repo.id, record);
    return record;
  }
}
