import type { OnboardingPage, OnboardingRecord } from '@devdigest/shared';
import type {
  OnboardingGenerationResult,
  OnboardingLogger,
  OnboardingRepoRef,
} from './generation-types.js';

/**
 * onboarding · the HTTP-and-persistence half — the ports this side codes
 * against.
 *
 * NOTHING here is imported from `modules/repo-intel/**`, and that is the binding
 * constraint rather than a preference: `no-cross-module` follows `import type`
 * too (`.dependency-cruiser.cjs` sets `tsPreCompilationDeps: true`), so
 * `import type { IndexState }` would be a violation exactly like a value import.
 * The facade arrives through the container and its shape is restated
 * structurally below — the move `modules/brief/types.ts` documents.
 *
 * `Container` is not imported either: the composition root constructs this
 * graph, and naming it from inside a slice closes a cycle `no-circular` rejects.
 * Contract types from `@devdigest/shared` are fine — they are the innermost ring.
 *
 * `./generation-types.js` IS imported, because it is this same module: the
 * generation half sits in `modules/onboarding/` beside this file, and re-stating
 * its logger or its result here would be a second declaration of a type that
 * already has one.
 */

/** The logger and the repo shape are the generation half's; one declaration each. */
export type { OnboardingLogger, OnboardingRepoRef };

/**
 * The index state, stated STRUCTURALLY so this slice never imports
 * `modules/repo-intel/types.ts`. An `IndexState` from the facade satisfies it by
 * construction, so `container.repoIntel.getIndexState` needs no adapter.
 *
 * The names stay `camelCase` and are NOT "corrected" to the contract's
 * `snake_case`: this type's whole purpose is to be satisfied by `IndexState`
 * without a mapping, and renaming a key here would break that structurally while
 * typecheck reported it as an unrelated error at the call site. `snake_case`
 * governs `contracts/**` — what goes over the wire — and `index_state` is where
 * this snapshot becomes snake, in `service.ts`.
 *
 * The two unions are restated for the same reason the whole interface is. They
 * are the members of `IndexStatus` and `DegradedReason`, and the gate table in
 * `status.ts` is the only thing that reads them.
 */
export interface IndexSnapshot {
  status: 'full' | 'partial' | 'degraded' | 'failed';
  /** True when the layer answered from a fallback rather than from the index. */
  degraded?: boolean;
  degradedReason?: 'flag_off' | 'index_failed' | 'index_partial' | 'repo_too_large' | 'no_data';
  filesIndexed: number;
  filesSkipped: number;
  /** `''` when nothing has ever been indexed. */
  lastIndexedSha: string;
  updatedAt: Date;
  reason?: string;
}

/**
 * What one generation is handed: `workspaceId`, `repo`, and one number off the
 * index state.
 *
 * THERE IS STILL NO `index` FIELD, deliberately: the generator neither reads the
 * index state nor produces one. This slice gates on it and stamps it, so nothing
 * on the other side of the seam can produce half a stamp that looks
 * authoritative. `filesIndexed` is the exception that proves the rule — it is a
 * VALUE, taken from the snapshot this slice already read at the gate and already
 * stamps as `index_state`, so the budget on the record and the `files_indexed`
 * beside it agree by construction rather than by a second read (AC-60). A number
 * passed as a parameter costs one field; teaching the generation container to
 * read the index would cost it the property that it cannot.
 *
 * `repo` rather than `repoId` — diverging from `ContextScanExecutor`, which
 * takes ids because a job handler starts with nothing else. This slice has
 * already read the row to prove tenancy, so passing it hands over a fact that is
 * in memory; re-reading it inside the executor would be a second query and would
 * put the tenancy proof in two places.
 */
export interface OnboardingGenerateInput {
  workspaceId: string;
  repo: OnboardingRepoRef;
  /** From the gate's own `IndexSnapshot`. The budget and the clock are computed from it. */
  filesIndexed: number;
}

/**
 * The A↔B seam: everything between "here is the repo" and a grounded draft,
 * implemented by `OnboardingGenerateExecutor`.
 *
 * The port keeps its role name rather than the class's: `platform/container.ts`
 * imports both, and two identical names in one file is a collision. That
 * port-named-for-the-role / class-named-for-the-work pair is the existing shape
 * — `BriefReader` implemented by `BriefService`.
 *
 * `log` is a second positional argument rather than a field of the input: the
 * composition root that builds the executor has no logger, and the caller that
 * does is the request.
 */
export interface OnboardingGenerator {
  run(input: OnboardingGenerateInput, log: OnboardingLogger): Promise<OnboardingGenerationResult>;
}

/**
 * The slice of the composition root the service needs, stated structurally.
 *
 * `repoIntel` names ONLY `getIndexState`. That is the whole point of writing it
 * out rather than importing `RepoIntel`: this feature must never index and never
 * reindex (`POST /repos/:id/resync` already exists and nothing here calls it),
 * and a port that cannot express indexing cannot accidentally index.
 *
 * There is deliberately no `db` and no `jobs`: the repository arrives as a
 * constructor parameter, and generation runs inside the request rather than
 * through `JobRunner` — a port that cannot reach the queue cannot leak a
 * `running` row into it.
 */
export interface OnboardingContainer {
  readonly repoIntel: {
    getIndexState(repoId: string): Promise<IndexSnapshot>;
    /**
     * The true file count, which `IndexSnapshot.filesIndexed` is not — that one
     * accumulates across incremental passes. The budget is sized with this;
     * `index_state` on the record still reports the indexer's counter.
     */
    countIndexedFiles(repoId: string): Promise<number>;
  };
  readonly onboardingGenerator: OnboardingGenerator;
}

/**
 * Just enough of `repos` to prove tenancy and name the clone. A `*Row` never
 * crosses this boundary.
 *
 * It is a superset of `OnboardingRepoRef`, so the whole value is handed to the
 * generator unchanged.
 */
export interface OnboardingRepo extends OnboardingRepoRef {
  defaultBranch: string;
  clonePath: string | null;
}

/**
 * The repository seam, declared as an INTERFACE rather than as the class.
 *
 * `OnboardingRepository` holds `private db: Db`, and a private member makes a
 * plain object literal unassignable to the class type — which is precisely why
 * three services in this repo have no hermetic tests (`onion-architecture` →
 * testing-the-rings §3). Typing the seam here is what lets
 * `test/onboarding-service.test.ts` run with no Docker.
 */
export interface OnboardingReads {
  /** Workspace-scoped. `undefined` is the IDOR gate: "not yours", not "no tour". */
  getRepo(workspaceId: string, repoId: string): Promise<OnboardingRepo | undefined>;
  /**
   * The one saved tour, or `null`. A stored document that no longer parses
   * against the contract is `null` too — "nothing saved yet, press Generate" —
   * never an error blamed on the caller who read it.
   *
   * `log` is per call, and required, because the read path is the ONLY place a
   * document that outlived its contract is ever met. A warning the read cannot
   * emit is not a warning.
   */
  get(repoId: string, log: OnboardingLogger): Promise<OnboardingRecord | null>;
  /** Replaces the one row for this repo. There is no history and no second write path. */
  upsert(repoId: string, record: OnboardingRecord): Promise<void>;
}

/**
 * The port `platform/container.ts` exposes for this slice — the shape
 * `modules/brief/types.ts` declares as `BriefReader`, for the same reason.
 *
 * A route is Infrastructure, and naming an Application class and reaching
 * `container.db` from one is composition-root work done outside the composition
 * root. The argument is stronger here than for a stateless service, because
 * `OnboardingService` carries INSTANCE STATE: the single-flight map is a lock
 * only while exactly one instance exists. Any second construction — a second
 * `app.register`, or the first non-HTTP caller — gets a fresh empty Map, and
 * AC-74 (two concurrent generations pay for one) silently stops holding.
 * Memoising the instance in the container makes that a property of the graph
 * rather than of how many times a module is registered.
 */
export interface OnboardingReader {
  /** `undefined` = not this workspace's repo; the route turns it into 404. */
  page(
    workspaceId: string,
    repoId: string,
    log: OnboardingLogger,
  ): Promise<OnboardingPage | undefined>;
  generate(
    workspaceId: string,
    repoId: string,
    log: OnboardingLogger,
  ): Promise<OnboardingRecord | undefined>;
}
