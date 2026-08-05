import type {
  GitClient,
  IntentRecord,
  IssueMeta,
  LLMProvider,
  Provider,
} from '@devdigest/shared';
import type { SettingsReader } from '../_shared/feature-models.js';

/**
 * intent — the port the composition root exposes.
 *
 * `modules/reviews/**` may not import `modules/intent/**` (`no-cross-module`),
 * so the review pre-pass reaches this interface as `container.intentService`
 * with no import statement at all — the same route `container.repoIntel` takes.
 * Everything here is therefore expressed in primitives and contract types: no
 * `PullRow`, no Drizzle, nothing that would carry the data layer across a ring
 * boundary (`onion-architecture` §3.5).
 */

/**
 * The slice of the composition root `IntentService` needs, stated structurally.
 *
 * `Container` is deliberately not imported. `platform/container.ts` constructs
 * `IntentService` for its `intentService` getter, so naming `Container` from
 * the service closes a two-file require cycle — verified, not assumed:
 * `pnpm arch` reported `no-circular: intent/service.ts → platform/container.ts
 * → intent/service.ts` on 2026-08-05. This is the same move `run-executor.ts`
 * makes for its `Logger`. A `Container` satisfies the shape by construction, so
 * `new IntentService(container, repo)` needs no adapter.
 *
 * It describes BEHAVIOUR only — the ports the service reaches through the
 * composition root. There is deliberately no `db` here: the repository is
 * supplied by `container.ts`, which is the one place allowed to name a concrete
 * type, and a `Db` on this interface would carry the data layer across a ring
 * boundary in a file whose whole point is that it does not.
 */
export interface IntentContainer extends SettingsReader {
  readonly git: GitClient;
  llm(id: Provider): Promise<LLMProvider>;
}

/** Everything the classifier is allowed to read. Gathered from the DB and the clone — never GitHub. */
export interface IntentSources {
  title: string;
  body: string | null;
  /** The contract type, not a copy of it: a field added to `IssueMeta` arrives here. */
  linkedIssue: IssueMeta | null;
  planFiles: { path: string; text: string }[];
  commitMessages: string[];
  filePaths: string[];
}

/**
 * The outcome of one derivation.
 *
 * `section` is the rendered `## Intent` text: it lives here so the review
 * executor never has to import a helper out of this slice. `tokensIn` /
 * `tokensOut` / `costUsd` are echoed back for the run log; they are also
 * persisted on `pr_intent`, which is the one place the number means one thing.
 */
export type IntentDerivation =
  | {
      ok: true;
      record: IntentRecord;
      section: string;
      tokensIn: number;
      tokensOut: number;
      costUsd: number | null;
    }
  | { ok: false; reason: string };

export interface IntentDeriver {
  /**
   * Compute + persist, for a PR resolved through `workspaceId`. NEVER throws:
   * failure arrives as `{ ok: false }` and nothing is written. That is what
   * lets one method serve a route which must report the failure and a review
   * pre-pass which must ignore it.
   */
  derive(input: {
    workspaceId: string;
    prId: string;
    onEvent?: (kind: 'info' | 'tool' | 'error', msg: string) => void;
  }): Promise<IntentDerivation>;

  /**
   * The cached record, workspace-scoped.
   *
   *   `undefined` → no such PR in this workspace; the route answers 404.
   *   `null`      → the PR exists, nothing has been derived yet; 200 + null.
   *
   * The two are distinct on purpose: collapsing them answers 200 for a PR that
   * belongs to someone else, which is the IDOR this scoping exists to stop.
   */
  get(workspaceId: string, prId: string): Promise<IntentRecord | null | undefined>;
}
