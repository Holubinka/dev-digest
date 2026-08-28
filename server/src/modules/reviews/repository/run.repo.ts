import { and, asc, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import type { Db } from '../../../db/client.js';
import * as t from '../../../db/schema.js';
import { stripNulDeep } from '../../../db/text.js';
import { RunTrace } from '@devdigest/shared';
import type { LastSuccessfulRun, RunSummary } from '@devdigest/shared';

/**
 * The two states a run occupies before it is terminal.
 *
 * `queued` only ever exists inside a multi-run, where a run row is created up
 * front and starts when the bounded pool frees a slot (SPEC-05 § AC-33). Every
 * read that used to mean "not finished yet" therefore has to cover both, or the
 * multi-run's waiting agents read as absent rather than as waiting.
 */
const IN_FLIGHT = ['running', 'queued'] as const;

// ---- in-flight / history --------------------------------------------------

/** In-flight runs for a PR (status IN ('running','queued')) — the server-side
 *  source of truth for "which agents are working on this PR now", including a
 *  multi-run's agents still waiting for a slot. Joined with the agent name.
 *  No existing caller sees a change: only a multi-run ever writes `queued`. */
export async function activeRunsForPull(
  db: Db,
  workspaceId: string,
  prId: string,
): Promise<{ run_id: string; agent_id: string | null; agent_name: string | null; ran_at: string | null }[]> {
  const rows = await db
    .select({
      id: t.agentRuns.id,
      agentId: t.agentRuns.agentId,
      ranAt: t.agentRuns.ranAt,
      agentName: t.agents.name,
    })
    .from(t.agentRuns)
    .leftJoin(t.agents, eq(t.agents.id, t.agentRuns.agentId))
    .where(
      and(
        eq(t.agentRuns.workspaceId, workspaceId),
        eq(t.agentRuns.prId, prId),
        inArray(t.agentRuns.status, [...IN_FLIGHT]),
      ),
    );
  return rows.map((r) => ({
    run_id: r.id,
    agent_id: r.agentId,
    agent_name: r.agentName ?? null,
    ran_at: r.ranAt ? r.ranAt.toISOString() : null,
  }));
}

/** All runs for a PR (any status), newest first — the PR run history. */
export async function listRunsForPull(
  db: Db,
  workspaceId: string,
  prId: string,
): Promise<RunSummary[]> {
  const rows = await db
    .select({ run: t.agentRuns, agentName: t.agents.name })
    .from(t.agentRuns)
    .leftJoin(t.agents, eq(t.agents.id, t.agentRuns.agentId))
    .where(and(eq(t.agentRuns.workspaceId, workspaceId), eq(t.agentRuns.prId, prId)))
    .orderBy(desc(t.agentRuns.ranAt));
  return rows.map(({ run, agentName }) => ({
    run_id: run.id,
    agent_id: run.agentId,
    agent_name: agentName ?? null,
    provider: run.provider,
    model: run.model,
    status: run.status,
    error: run.error,
    duration_ms: run.durationMs,
    tokens_in: run.tokensIn,
    tokens_out: run.tokensOut,
    cost_usd: run.costUsd,
    findings_count: run.findingsCount,
    grounding: run.grounding,
    ran_at: run.ranAt ? run.ranAt.toISOString() : null,
    score: run.score,
    blockers: run.blockers,
  }));
}

/**
 * Delete one agent run (+ its trace via FK cascade) AND the review it produced.
 * Workspace-scoped. `reviews.run_id` has no FK to `agent_runs`, so the review
 * (and its findings, which DO cascade from `reviews`) must be removed explicitly
 * here — otherwise deleting a run from the timeline leaves its findings orphaned
 * in the Review Runs list below.
 */
export async function deleteAgentRun(
  db: Db,
  workspaceId: string,
  runId: string,
): Promise<boolean> {
  await db
    .delete(t.reviews)
    .where(and(eq(t.reviews.runId, runId), eq(t.reviews.workspaceId, workspaceId)));
  const rows = await db
    .delete(t.agentRuns)
    .where(and(eq(t.agentRuns.id, runId), eq(t.agentRuns.workspaceId, workspaceId)))
    .returning({ id: t.agentRuns.id });
  return rows.length > 0;
}

/**
 * Mark a still-in-flight run as cancelled (no-op if it already finished).
 *
 * `IN_FLIGHT`, not `'running'`, and the widening is forced by the read above it:
 * the PR page cancels every id `activeRunsForPull` returned, which now includes
 * a multi-run's waiting agents. Left on `'running'` this updates zero rows while
 * the route still answers `{ok:true}` — the row keeps saying `queued`, and
 * `RunBus.complete` has meanwhile deleted the in-memory cancelled flag
 * (`platform/sse.ts:78`), so nothing survives to stop the pool from running the
 * agent and billing for it. `startAgentRun` is the other half.
 */
export async function cancelRunIfRunning(db: Db, runId: string): Promise<boolean> {
  const rows = await db
    .update(t.agentRuns)
    .set({ status: 'cancelled' })
    .where(and(eq(t.agentRuns.id, runId), inArray(t.agentRuns.status, [...IN_FLIGHT])))
    .returning({ id: t.agentRuns.id });
  return rows.length > 0;
}

/**
 * On boot: any run still 'running' OR 'queued' is orphaned (its process died /
 * restarted), so mark it failed. Prevents permanently stuck runs in the UI.
 *
 * `queued` is reaped for the same reason `running` is, and skipping it is worse:
 * a multi-run's waiting agent has no live process to resume it, so its column
 * would read "queued" for ever and the multi-run would never reach a terminal
 * state — contradicting AC-37, which requires a restarted server to leave a
 * readable multi-run with FAILED columns. No existing caller writes `queued`.
 */
export async function reapStaleRunningRuns(db: Db): Promise<number> {
  const rows = await db
    .update(t.agentRuns)
    .set({ status: 'failed' })
    .where(inArray(t.agentRuns.status, [...IN_FLIGHT]))
    .returning({ id: t.agentRuns.id });
  return rows.length;
}

// ---- observability: agent_runs + run_traces -------------------------------

/**
 * Create an agent_runs row; returns its id (= the runId).
 *
 * `status` defaults to `'running'`, which is what every existing caller gets
 * without passing it. A multi-run passes `'queued'`: its rows exist from the
 * moment the request is answered, but only `DEFAULT_MULTI_RUN_CONCURRENCY` of them are
 * executing at any time, and a run that has not started must not read as
 * running anywhere (AC-34).
 */
export async function createAgentRun(
  db: Db,
  values: {
    workspaceId: string;
    agentId: string | null;
    prId: string;
    provider: string | null;
    model: string | null;
    status?: 'running' | 'queued';
  },
): Promise<string> {
  const [row] = await db
    .insert(t.agentRuns)
    .values({
      workspaceId: values.workspaceId,
      agentId: values.agentId,
      prId: values.prId,
      provider: values.provider,
      model: values.model,
      status: values.status ?? 'running',
      source: 'local',
    })
    .returning({ id: t.agentRuns.id });
  return row!.id;
}

/**
 * The pool's CLAIM on a job: promote the run to `running` and say whether it got
 * it. `false` means the row has left the in-flight set — it was cancelled while
 * it waited — and the caller must not run the agent.
 *
 * Guarded on `IN_FLIGHT` rather than on `'queued'` alone, because the two states
 * this has to tell apart are "not started yet" and "no longer to be started",
 * NOT "queued" and "running": on the single-run path the row was already
 * inserted `running`, and a claim guarded on `'queued'` would answer `false`
 * there too, making the answer useless to act on. Re-writing `running` over
 * `running` is the harmless half of that; refusing to run a healthy single run
 * would not be.
 *
 * This is the only durable stop for a cancelled-while-queued run. The in-memory
 * flag is gone by then: `ReviewService.cancelRun` ends with
 * `runBus.complete(runId)`, and `RunBus.complete` deletes it (`sse.ts:78`).
 */
export async function startAgentRun(db: Db, runId: string): Promise<boolean> {
  const rows = await db
    .update(t.agentRuns)
    .set({ status: 'running' })
    .where(and(eq(t.agentRuns.id, runId), inArray(t.agentRuns.status, [...IN_FLIGHT])))
    .returning({ id: t.agentRuns.id });
  return rows.length > 0;
}

/**
 * The newest `done` run of each agent in the workspace — the pre-run estimate's
 * only input (AC-17…AC-23).
 *
 * `DISTINCT ON (agent_id) … ORDER BY agent_id, ran_at DESC` is one index step
 * per agent over `agent_runs_ws_agent_done_ran_idx`, rather than the aggregate +
 * self-join a `GROUP BY` would need. An agent with no `done` run is simply
 * absent from the result: the screen renders `—` for it and leaves it out of
 * both sums, and a zero row here is exactly the "0.0s / $0.00" AC-23 forbids.
 *
 * `status = 'done'` IS THE INDEX'S OWN PREDICATE (`db/schema/runs.ts`), so this
 * filter must stay exactly as written: drop it, or widen it to a second status,
 * and Postgres cannot use the partial index at all. Measured on 20 000 runs of
 * which 1 000 were `done` — with the index unpartitioned the planner chose a
 * sequential scan and discarded 19 000 rows (267 buffers); with the predicate it
 * reads 66.
 */
export async function lastSuccessfulRunPerAgent(
  db: Db,
  workspaceId: string,
): Promise<LastSuccessfulRun[]> {
  const rows = await db
    .selectDistinctOn([t.agentRuns.agentId], {
      agentId: t.agentRuns.agentId,
      durationMs: t.agentRuns.durationMs,
      costUsd: t.agentRuns.costUsd,
      ranAt: t.agentRuns.ranAt,
    })
    .from(t.agentRuns)
    .where(
      and(
        eq(t.agentRuns.workspaceId, workspaceId),
        eq(t.agentRuns.status, 'done'),
        isNotNull(t.agentRuns.agentId),
      ),
    )
    .orderBy(asc(t.agentRuns.agentId), desc(t.agentRuns.ranAt));
  return rows.map((r) => ({
    agent_id: r.agentId!,
    duration_ms: r.durationMs,
    cost_usd: r.costUsd,
    ran_at: r.ranAt ? r.ranAt.toISOString() : null,
  }));
}

export async function completeAgentRun(
  db: Db,
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
  await db
    .update(t.agentRuns)
    .set({
      status: values.status,
      durationMs: values.durationMs,
      tokensIn: values.tokensIn,
      tokensOut: values.tokensOut,
      costUsd: values.costUsd ?? null,
      findingsCount: values.findingsCount,
      grounding: values.grounding,
      score: values.score ?? null,
      blockers: values.blockers ?? null,
      error: values.error ?? null,
    })
    .where(eq(t.agentRuns.id, runId));
}

/** Persist the WHOLE run log as ONE document. PK = runId → agent_runs. */
export async function saveRunTrace(db: Db, runId: string, rawTrace: RunTrace): Promise<void> {
  // `jsonb` refuses U+0000 like `text` does, and the trace carries model strings
  // through `log[].msg`. Cleaned here rather than in the two builders so a third
  // builder cannot miss it.
  const trace = stripNulDeep(rawTrace);
  await db
    .insert(t.runTraces)
    .values({ runId, trace })
    .onConflictDoUpdate({ target: t.runTraces.runId, set: { trace } });
}

/**
 * PARSED, not cast. `run_traces.trace` is a jsonb blob written by every version
 * of this code that ever ran, so a field added later is simply absent from the
 * documents already there — 282 of the 285 rows on the development database
 * carry no `project_context`. A cast makes the type system promise a field the
 * document does not have, and the drawer that reads `.length` off it crashes.
 * Parsing is what makes `RunTrace`'s `.default([])` fire and upgrades every old
 * document on the way out.
 *
 * The obligation that comes with it: a key the contract requires and an old
 * document does not carry throws here, so every field this contract has gained
 * — or lost and regained, as `RunStats.cost_usd` did between `d45ab0d` and
 * `5e92756` — needs a `.default(...)` rather than a bare requirement.
 */
export async function getRunTrace(db: Db, runId: string): Promise<RunTrace | undefined> {
  const [row] = await db.select().from(t.runTraces).where(eq(t.runTraces.runId, runId));
  return row ? RunTrace.parse(row.trace) : undefined;
}
