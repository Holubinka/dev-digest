import type {
  GitClient,
  LLMProvider,
  OnboardingDraft,
  OnboardingDropped,
  OnboardingPackageManager,
  OnboardingPackageScan,
  OnboardingTokenizer,
  PromptTemplates,
  Provider,
} from '@devdigest/shared';
import type { SettingsReader } from '../_shared/feature-models.js';

/**
 * onboarding · generation — the ports and the shapes this half of the slice
 * codes against.
 *
 * NOTHING here is imported from `modules/repo-intel/**`. That is the binding
 * constraint, not a preference: `no-cross-module` follows `import type` too
 * (`.dependency-cruiser.cjs` sets `tsPreCompilationDeps: true`), so
 * `import type { RepoIntel }` would be a violation exactly like a value import.
 * The facade arrives through the container and its shape is restated
 * structurally below — the move `modules/brief/types.ts` documents.
 *
 * `Container` is not imported either: the composition root constructs the graph,
 * and naming it from inside a slice closes a cycle `no-circular` rejects.
 * Contract types from `@devdigest/shared` are fine — they are the innermost ring.
 */

/**
 * The slice of the composition root the generation pipeline needs, stated
 * structurally.
 *
 * `repoIntel` names ONLY the three reads. That is the whole point of writing it
 * out rather than importing `RepoIntel`:
 *
 *  - `indexRepo` and `refreshIndex` are absent because this feature must never
 *    index — a port that cannot express indexing cannot accidentally index;
 *  - `getIndexState` is absent because this pipeline has no business reading it
 *    at all. It neither gates on the index nor stamps what it was generated
 *    against; the slice that persists does both. Nothing here can therefore
 *    produce half of a stamp that looks authoritative.
 *
 * That second point survived the input budget becoming a function of
 * `files_indexed`: the number arrives as a PARAMETER on
 * `OnboardingGenerateInput`, from the snapshot the caller has already read, and
 * is not fetched here. A port that could answer "how big is the index" is a port
 * that could be asked to make one bigger.
 *
 * There is deliberately no `db` and no repository: this half writes nothing.
 */
export interface OnboardingGenerationContainer extends SettingsReader {
  readonly git: GitClient;
  readonly prompts: PromptTemplates;
  /**
   * `id` is read AFTER counting, and it is required rather than optional: the
   * encoder degrades to `ceil(chars/4)` silently and irreversibly on its first
   * failure, and a run that records 23 900 counted tokens against a budget of
   * 24 000 is a different claim depending on which counter produced it.
   */
  readonly tokenizer: { count(text: string): number; readonly id: OnboardingTokenizer };
  readonly repoIntel: {
    getRepoMap(
      repoId: string,
      tokenBudget?: number,
    ): Promise<{ text: string; tokens: number; degraded?: boolean }>;
    getCriticalPaths(repoId: string): Promise<string[][]>;
    getTopFilesByRank(repoId: string, n: number, opts?: { exclude?: string[] }): Promise<string[]>;
  };
  llm(id: Provider): Promise<LLMProvider>;
}

/**
 * Just enough of `repos` to read a clone and name it. `id` is the repo-intel
 * key; `owner`/`name` are what `GitClient` resolves a clone from. A `*Row` never
 * crosses this boundary.
 */
export interface OnboardingRepoRef {
  id: string;
  owner: string;
  name: string;
  fullName: string;
}

/**
 * The logger the pipeline is handed, PER CALL rather than per instance: the
 * caller that owns a request id is the request, and it is the one that has a
 * logger. Required, not optional — an optional port nobody remembers to pass is
 * a silence, not a default.
 */
export interface OnboardingLogger {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
}

/**
 * One `package.json` found by the walk, with the evidence beside it.
 *
 * `manager` is `null` when the lock files present do not name exactly one — none
 * of them, or two different ones. `lockfiles` keeps the names that were actually
 * found, so the null can be explained rather than merely reported.
 */
export interface DiscoveredPackage {
  name: string;
  /** Repo-relative directory, posix, `.` for the root package. */
  path: string;
  manager: OnboardingPackageManager | null;
  /** Script names from the manifest — the keys, never the command bodies. */
  scripts: string[];
  lockfiles: string[];
}

/**
 * Everything the model is allowed to see, gathered through ports.
 *
 * `package_scan` is snake_case because it is the contract's own key, carried
 * through unchanged; the fields that never reach the contract keep the ordinary
 * camelCase of a TypeScript field.
 *
 * `knownPaths` is every path a read or the walk returned successfully, i.e. the
 * set that is already proven to exist. Grounding intersects the model's claims
 * with it before anything else is probed.
 */
export interface OnboardingSources {
  repoMap: { text: string; tokens: number };
  /** Import chains from the facade. A flow step outside these is not a flow step. */
  chains: string[][];
  ranked: string[];
  packages: DiscoveredPackage[];
  package_scan: OnboardingPackageScan;
  envSources: { path: string; text: string }[];
  /**
   * Compose files found at the clone root (`COMPOSE_FILES`), read WHOLE rather
   * than probed. A setup command's authorisation needs the text, not the path: a
   * `docker compose up -d postgres redis` is grounded only when the file declares
   * both services, and a path alone cannot answer that.
   */
  composeSources: { path: string; text: string }[];
  samples: { path: string; text: string }[];
  docs: { path: string; text: string }[];
  knownPaths: Set<string>;
}

/**
 * What one generation dropped, for the log line.
 *
 * The five contract counters are inherited rather than restated, so a rename in
 * the contract cannot leave a second vocabulary behind here. The extras are
 * deliberately NOT in the contract: `off_chain` and `unknown_env` are "we could
 * not confirm this claim" facts that the five reasons of the record do not name,
 * and `probes`/`samples` describe the run rather than the answer.
 */
export interface OnboardingAudit extends OnboardingDropped {
  /**
   * Claims whose path EXISTS in the clone but lies outside the set that claim
   * was allowed to draw from: a flow step off the critical-path chains (AC-14),
   * a reading step outside chains ∪ ranked (AC-28).
   *
   * One number for both because it is one fact — the file is real and the model
   * was not shown it here. `unknown_path` would be a lie about either, and a
   * sixth contract counter is not available (AC-40).
   */
  off_chain: number;
  /** Env vars that occur in no config file this run read. */
  unknown_env: number;
  /** Existence probes spent against the clone. */
  probes: number;
  /** The sampled paths, for the one log line the generation writes. */
  samples: string[];
}

/**
 * The outcome of one generation: the draft the caller persists, and the audit it
 * logs. Nothing is written here — persistence, timing and the index stamp all
 * belong to the caller.
 */
export interface OnboardingGenerationResult {
  draft: OnboardingDraft;
  audit: OnboardingAudit;
}
