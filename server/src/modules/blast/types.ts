import type {
  BlastRadiusView,
  BlastSummaryResponse,
  LLMProvider,
  Provider,
} from '@devdigest/shared';
import type { SettingsReader } from '../_shared/feature-models.js';

/**
 * blast — the ports this slice codes against.
 *
 * NOTHING here is imported from `modules/repo-intel/**`. That is the binding
 * constraint, not a preference: `no-cross-module` follows `import type` too
 * (`.dependency-cruiser.cjs` sets `tsPreCompilationDeps: true` with no
 * `dependencyTypesNot` on that rule), so `import type { BlastResult }` would be
 * a violation exactly like a value import. `Container` is not imported either,
 * for the reason `modules/intent/types.ts:22-38` records: the composition root
 * knows the concrete graph, and naming it from inside a slice closes a cycle
 * `no-circular` rejects.
 *
 * Every shape below is therefore declared structurally, naming ONLY the fields
 * this module reads. Return types are covariant, so the real `BlastResult` /
 * `IndexState` / `DownstreamFile` satisfy the narrower shapes by construction and
 * `new BlastService(container, repo)` needs no adapter — `test/blast-service.
 * test.ts` builds both by hand, which is the proof that they are narrow enough.
 */

/** What `deriveStatus` and `toView` read off `RepoIntel.getIndexState`. */
export interface BlastIndexState {
  /** Widened from `IndexStatus` — `failed` is mapped onto `degraded` by the view. */
  status: string;
  degraded?: boolean;
  /** Widened from `DegradedReason`, which is a repo-intel type we may not name. */
  degradedReason?: string;
  /** Free-form cause the indexer stamped (e.g. `no_clone`). */
  reason?: string;
  /**
   * The commit the index was built from. This — not the PR head — is the commit
   * every `line` in the answer is valid at, so it is what the view links against.
   * Empty string when the index knows no commit; the view maps that to `null`.
   */
  lastIndexedSha?: string;
}

/** One cross-file call site, as `RepoIntel.getBlastRadius` reports it. */
export interface BlastFactsCaller {
  file: string;
  symbol: string;
  /** Which changed symbol this caller reaches — the grouping key. */
  viaSymbol: string;
  line: number;
  rank: number;
}

/** What this module reads off `RepoIntel.getBlastRadius`. */
export interface BlastFacts {
  changedSymbols: { file: string; name: string; kind: string; line: number }[];
  /** ALREADY capped per symbol upstream; `callerCounts` holds the pre-cap size. */
  callers: BlastFactsCaller[];
  callerCounts?: Record<string, number>;
  factsByFile?: Record<string, { endpoints: string[]; crons: string[] }>;
  degraded?: boolean;
  reason?: string;
}

/** One file downstream of the change, as `RepoIntel.getDownstream` reports it. */
export interface DownstreamFile {
  file: string;
  depth: number;
  endpoints: string[];
  crons: string[];
}

/**
 * The slice of the composition root this module needs.
 *
 * `repoIntel` names three methods and no more. Widening it is not free: every
 * method here is one the request path may spend time in, and `getBlastRadius`
 * is only safe to call because `getIndexState` gates it (see `service.ts`).
 *
 * There is deliberately no `db`: the repository arrives as a constructor
 * parameter instead, so this interface carries no data layer across the ring
 * boundary (`onion-architecture` §3.5).
 */
export interface BlastContainer extends SettingsReader {
  readonly repoIntel: {
    getIndexState(repoId: string): Promise<BlastIndexState>;
    getBlastRadius(repoId: string, changedFiles: string[]): Promise<BlastFacts>;
    getDownstream(repoId: string, files: string[], maxDepth: number): Promise<DownstreamFile[]>;
  };
  llm(id: Provider): Promise<LLMProvider>;
}

/**
 * The port `platform/container.ts` exposes for this slice.
 *
 * `modules/brief/**` may not import `modules/blast/**` (`no-cross-module`), so
 * the brief reaches this interface as `container.blastService` with no import
 * statement at all — the route `container.intentService` already takes.
 *
 * It names BOTH methods even though the brief only needs `getBlast`: the getter
 * replaces `blast/routes.ts`'s own `new BlastService(...)`, and a port that
 * dropped `summarize` would leave that route constructing a second instance —
 * which is exactly the drift `container.intentService` exists to prevent.
 */
export interface BlastReader {
  getBlast(workspaceId: string, prId: string): Promise<BlastRadiusView | undefined>;
  summarize(workspaceId: string, prId: string): Promise<BlastSummaryResponse | undefined>;
}

/** The PR row the view is built from, flattened across `pull_requests` → `repos`. */
export interface BlastPull {
  repoId: string;
  headSha: string;
  repoFullName: string;
}

/**
 * The repository, as an INTERFACE rather than the class.
 *
 * `BlastRepository` holds `private db: Db`, and a private member makes a plain
 * object literal unassignable to the class type — which is precisely why
 * `AgentsService`, `RepoService` and `ReviewService` have no hermetic tests
 * (`onion-architecture` → testing-the-rings §3). Typing the seam as this
 * interface is what lets `blast-service.test.ts` run with no Docker: the class
 * satisfies it structurally, and the fake satisfies it too.
 */
export interface BlastReads {
  getPullForBlast(workspaceId: string, prId: string): Promise<BlastPull | undefined>;
  getChangedFiles(prId: string): Promise<string[]>;
}
