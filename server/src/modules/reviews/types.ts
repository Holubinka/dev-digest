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
 * Everything one agent's run needs.
 *
 * `executeRuns` resolves `diff` and `intentSection` once and hands the same pair
 * to every agent — the two fields that make this a struct rather than an
 * argument list, since a positional `(…, diff, intentSection, agent, …)` puts
 * three same-shaped values in a row and offers no way to notice they were
 * swapped.
 */
export interface AgentRun {
  workspaceId: string;
  pull: ReviewPull;
  repo: ReviewRepo;
  diff: UnifiedDiff;
  /** The rendered `## Intent` section, or undefined when derivation failed. */
  intentSection: string | undefined;
  agent: ReviewAgent;
  runId: string;
}
