import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { Finding, LastSuccessfulRun, RunSummary, RunTrace } from '@devdigest/shared';

/**
 * A2 — review data-access. The ONLY layer touching the DB for the review
 * domain. Owns `reviews` and `findings`, and persists the observability rows
 * `agent_runs` + `run_traces` (one trace doc per run). Workspace scoping is
 * enforced via the PR (which carries workspace_id).
 *
 * `pr_intent` is NOT here: `modules/intent/repository.ts` is its single owner
 * (05). The two unused accessors this class carried were removed with it —
 * two repositories writing one table is how the two drift.
 *
 * The query implementations are colocated, split by aggregate, under
 * `./repository/` (review+findings, agent runs, pull). This class composes them
 * so its public API stays identical.
 */

import type { FindingRow, PullRow } from '../../db/rows.js';
export type { FindingRow, PullRow };

export type ReviewRow = typeof t.reviews.$inferSelect;

import * as reviewRepo from './repository/review.repo.js';
import * as runRepo from './repository/run.repo.js';
import * as pullRepo from './repository/pull.repo.js';
import * as multiRunRepo from './repository/multi-run.repo.js';

export type { MultiRunDetail, MultiRunItemDetail, MultiRunRow } from './repository/multi-run.repo.js';

export class ReviewRepository {
  constructor(private db: Db) {}

  // ---- PR lookup (workspace-scoped) --------------------------------------

  getPull(workspaceId: string, prId: string): Promise<PullRow | undefined> {
    return pullRepo.getPull(this.db, workspaceId, prId);
  }

  getRepo(repoId: string): Promise<typeof t.repos.$inferSelect | undefined> {
    return pullRepo.getRepo(this.db, repoId);
  }

  getPrFiles(prId: string): Promise<(typeof t.prFiles.$inferSelect)[]> {
    return pullRepo.getPrFiles(this.db, prId);
  }

  // ---- reviews + findings -------------------------------------------------

  insertReview(values: {
    workspaceId: string;
    prId: string;
    agentId: string | null;
    runId: string | null;
    /** WHICH STATE of the PR this review describes; null = unknown. */
    headSha: string | null;
    kind: 'summary' | 'review';
    verdict: string | null;
    summary: string | null;
    score: number | null;
    model: string | null;
  }): Promise<ReviewRow> {
    return reviewRepo.insertReview(this.db, values);
  }

  insertFindings(reviewId: string, findings: Finding[]): Promise<FindingRow[]> {
    return reviewRepo.insertFindings(this.db, reviewId, findings);
  }

  /** Reviews for a PR (newest first), each with its findings. */
  reviewsForPull(prId: string): Promise<{ review: ReviewRow; findings: FindingRow[] }[]> {
    return reviewRepo.reviewsForPull(this.db, prId);
  }

  getReview(reviewId: string): Promise<ReviewRow | undefined> {
    return reviewRepo.getReview(this.db, reviewId);
  }

  /** In-flight runs for a PR (status IN ('running','queued')) — the server-side
   *  source of truth for "which agents are working on this PR now", a multi-run's
   *  waiting agents included. Joined with the agent name. */
  activeRunsForPull(
    workspaceId: string,
    prId: string,
  ): Promise<{ run_id: string; agent_id: string | null; agent_name: string | null; ran_at: string | null }[]> {
    return runRepo.activeRunsForPull(this.db, workspaceId, prId);
  }

  /** All runs for a PR (any status), newest first — the PR run history. */
  listRunsForPull(workspaceId: string, prId: string): Promise<RunSummary[]> {
    return runRepo.listRunsForPull(this.db, workspaceId, prId);
  }

  /** Delete one agent run (+ its trace via FK cascade). Workspace-scoped. */
  deleteAgentRun(workspaceId: string, runId: string): Promise<boolean> {
    return runRepo.deleteAgentRun(this.db, workspaceId, runId);
  }

  /** Mark a still-running run as cancelled (no-op if it already finished). */
  cancelRunIfRunning(runId: string): Promise<boolean> {
    return runRepo.cancelRunIfRunning(this.db, runId);
  }

  /** On boot: any run still 'running' or 'queued' is orphaned (its process died
   *  / restarted), so mark it failed. Prevents permanently stuck runs in the UI —
   *  a multi-run's waiting column included, which has no process to resume it. */
  reapStaleRunningRuns(): Promise<number> {
    return runRepo.reapStaleRunningRuns(this.db);
  }

  /** Delete a whole review (one agent's run) + its findings (cascade), scoped
   *  to the workspace. Returns false if not found in the workspace. */
  deleteReview(workspaceId: string, reviewId: string): Promise<boolean> {
    return reviewRepo.deleteReview(this.db, workspaceId, reviewId);
  }

  // ---- finding actions ----------------------------------------------------

  getFinding(findingId: string): Promise<FindingRow | undefined> {
    return reviewRepo.getFinding(this.db, findingId);
  }

  /** Resolve workspace_id + pr_id for a finding (via review → pr). */
  findingContext(
    findingId: string,
  ): Promise<{ finding: FindingRow; review: ReviewRow; pull: PullRow } | undefined> {
    return reviewRepo.findingContext(this.db, findingId);
  }

  setFindingAccepted(findingId: string, at: Date | null): Promise<FindingRow | undefined> {
    return reviewRepo.setFindingAccepted(this.db, findingId, at);
  }

  setFindingDismissed(findingId: string, at: Date | null): Promise<FindingRow | undefined> {
    return reviewRepo.setFindingDismissed(this.db, findingId, at);
  }

  // ---- observability: agent_runs + run_traces ----------------------------

  /** Create an agent_runs row; `running` unless a multi-run asks for `queued`.
   *  Returns its id (= the runId). */
  createAgentRun(values: {
    workspaceId: string;
    agentId: string | null;
    prId: string;
    provider: string | null;
    model: string | null;
    status?: 'running' | 'queued';
  }): Promise<string> {
    return runRepo.createAgentRun(this.db, values);
  }

  /** Promote a queued run to `running` when the pool frees a slot. A no-op on
   *  the single-run path, where the row was inserted `running` already. */
  startAgentRun(runId: string): Promise<boolean> {
    return runRepo.startAgentRun(this.db, runId);
  }

  /** The newest `done` run of each agent — the pre-run estimate's only input. */
  lastSuccessfulRunPerAgent(workspaceId: string): Promise<LastSuccessfulRun[]> {
    return runRepo.lastSuccessfulRunPerAgent(this.db, workspaceId);
  }

  completeAgentRun(
    runId: string,
    values: {
      status: 'done' | 'failed' | 'cancelled';
      durationMs: number;
      tokensIn: number;
      tokensOut: number;
      /** USD cost; omit/null when unknown (failed run, or an unpriced model). */
      costUsd?: number | null;
      findingsCount: number;
      grounding: string;
      /** Review score (0-100); null on failed/cancelled runs. */
      score?: number | null;
      /** Findings that tripped the agent's gate; 0 on failed/cancelled runs. */
      blockers?: number | null;
      /** Failure reason (status='failed') / cancellation note. Null clears it. */
      error?: string | null;
    },
  ): Promise<void> {
    return runRepo.completeAgentRun(this.db, runId, values);
  }

  /** Record the head SHA a review ran against (PR-list freshness derivation). */
  markReviewed(prId: string, sha: string): Promise<void> {
    return pullRepo.markReviewed(this.db, prId, sha);
  }

  /** Persist the WHOLE run log as ONE document. PK = runId → agent_runs. */
  saveRunTrace(runId: string, trace: RunTrace): Promise<void> {
    return runRepo.saveRunTrace(this.db, runId, trace);
  }

  getRunTrace(runId: string): Promise<RunTrace | undefined> {
    return runRepo.getRunTrace(this.db, runId);
  }
}

/**
 * SPEC-05 — data access for the multi-agent slice, a class beside
 * `ReviewRepository` rather than more methods on it.
 *
 * Two aggregates, two seams: `MultiRunService` takes this one as a constructor
 * parameter and never sees the review repository's fifty methods, and a test of
 * the service fakes five methods instead of stubbing a class that also owns
 * reviews, findings, traces and pulls.
 */
export class MultiRunRepository {
  constructor(private db: Db) {}

  /** Create the multi-run, its queued agent runs and its items in ONE
   *  transaction — either all of it exists or none does (AC-27/AC-28/AC-30). */
  createMultiRun(values: {
    workspaceId: string;
    prId: string;
    headSha: string | null;
    concurrency: number;
    items: { agentId: string; agentName: string; provider: string; model: string }[];
  }): Promise<{ multiRunId: string; runIds: string[] }> {
    return multiRunRepo.createMultiRun(this.db, values);
  }

  /** Record that this multi-run's last run reached a terminal state — the second
   *  half of the measured summary duration (AC-155). Writes once. */
  markMultiRunFinished(multiRunId: string): Promise<void> {
    return multiRunRepo.markMultiRunFinished(this.db, multiRunId);
  }

  /** The whole multi-run in one read: its PR, its items in position order, each
   *  joined to its run, its agent, its review and that review's findings. */
  getMultiRun(
    workspaceId: string,
    multiRunId: string,
  ): Promise<multiRunRepo.MultiRunDetail | undefined> {
    return multiRunRepo.getMultiRun(this.db, workspaceId, multiRunId);
  }

  /** Newest multi-run of a repo, or undefined when it has never had one. */
  latestMultiRunForRepo(
    workspaceId: string,
    repoId: string,
  ): Promise<{ multiRun: multiRunRepo.MultiRunRow; prNumber: number } | undefined> {
    return multiRunRepo.latestMultiRunForRepo(this.db, workspaceId, repoId);
  }

  /** Newest multi-run of one PR (R54) — what makes the PR page's link survive a
   *  reload instead of living only in the response that created it. */
  latestMultiRunForPull(
    workspaceId: string,
    prId: string,
  ): Promise<{ multiRun: multiRunRepo.MultiRunRow; prNumber: number } | undefined> {
    return multiRunRepo.latestMultiRunForPull(this.db, workspaceId, prId);
  }

  /** The stored agent set + its PR, in position order — the re-run's input. */
  agentIdsOfMultiRun(
    workspaceId: string,
    multiRunId: string,
  ): Promise<{ prId: string; agents: { agentId: string; agentName: string }[] } | undefined> {
    return multiRunRepo.agentIdsOfMultiRun(this.db, workspaceId, multiRunId);
  }
}
