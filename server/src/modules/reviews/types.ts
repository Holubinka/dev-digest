import type { Provider, UnifiedDiff } from '@devdigest/shared';

/**
 * The shapes `modules/reviews` needs to run one agent, declared here rather
 * than borrowed from `db/`.
 *
 * `onion-architecture` §3.5 keeps a `*Row` inside its own module, and these
 * three fields are the case it is aimed at: `AgentRow` belongs to
 * `modules/agents`, and a `repos` row belongs to `db/schema`. Stating the
 * minimal shape instead means a column added over there does not silently widen
 * what a review may read, and a column renamed surfaces as a type error at the
 * one mapping site in `executeRuns` rather than propagating.
 *
 * The fields are written out rather than `Pick`ed from the row on purpose:
 * a `Pick` still names the row type, so it moves the coupling without removing
 * it, and it re-exports the row's own nullability as though this module had
 * chosen it.
 */

/** The `pull_requests` columns a review reads. `title` and `author` are the PR author's. */
export interface ReviewPull {
  id: string;
  repoId: string;
  number: number;
  title: string;
  author: string;
  /** The PR description. Untrusted on a public repo; the engine wraps and truncates it. */
  body: string | null;
  /** The two refs `loadDiff` asks git for: `git diff base...headSha`. */
  base: string;
  headSha: string;
}

/** The `repos` columns a review reads — only enough to name the session. */
export interface ReviewRepo {
  owner: string;
  name: string;
}

/** The `agents` columns a review reads: its identity, its model, and its four policies. */
export interface ReviewAgent {
  id: string;
  name: string;
  version: number;
  provider: Provider;
  model: string;
  systemPrompt: string;
  /** Whole diff in one call, one call per file, or let the engine decide. */
  strategy: 'single-pass' | 'map-reduce' | 'auto';
  /** Severity at or above which this agent's findings block CI. */
  ciFailOn: 'never' | 'critical' | 'warning' | 'any';
  /** Per-agent opt-out from repo-intel enrichment, independent of the global flag. */
  repoIntel: boolean;
}

/**
 * Repo-intel enrichment for one PR.
 *
 * Derived once per batch, not once per agent: all three come from the repo
 * index keyed on `(repoId, diff)`, and no agent is an input to any of them. Per
 * agent they were not only three extra queries each but a consistency hazard —
 * two agents reviewing the same PR could see different callers if the indexer
 * wrote between their runs, which is the same reason `diff` is loaded once.
 *
 * The per-agent `repoIntel` flag still applies; it selects between this and
 * nothing, rather than deciding whether to query.
 */
export interface RepoIntelContext {
  readonly callers: string | undefined;
  readonly repoMap: string | undefined;
  /** Appended to the task line, so `''` rather than `undefined` — it concatenates. */
  readonly rankNote: string;
  /**
   * What was resolved, one line per part, for the run log.
   *
   * Carried rather than logged where it is produced: these lines assert what
   * went into A PROMPT, and the batch logger fans out to every queued run — so
   * emitting them at resolution time told an agent with `repoIntel: false` that
   * enrichment it never received had been attached. The caller emits them, per
   * run, only when that agent actually uses this context. Failures are the
   * other way round and stay at the batch: they describe an attempt, and the
   * attempt really was shared.
   */
  readonly summary: readonly string[];
}

/**
 * Everything one agent's run needs.
 *
 * `executeRuns` resolves `diff`, `intentSection` and `repoIntel` once and hands
 * the same three to every agent — the fields that make this a struct rather
 * than an argument list, since a positional `(…, diff, intentSection, agent, …)`
 * puts three same-shaped values in a row and offers no way to notice they were
 * swapped.
 */
export interface AgentRun {
  workspaceId: string;
  pull: ReviewPull;
  repo: ReviewRepo;
  diff: UnifiedDiff;
  /** The rendered `## Intent` section, or undefined when derivation failed. */
  intentSection: string | undefined;
  /**
   * Shared BY REFERENCE with every sibling `AgentRun` in the batch, and with the
   * process-wide `NO_REPO_INTEL` when an agent opts out — hence `readonly` on it
   * and on every field of `RepoIntelContext`. One write here would reach every
   * other run in the batch, and every later batch that skipped enrichment.
   */
  readonly repoIntel: RepoIntelContext;
  agent: ReviewAgent;
  runId: string;
}
