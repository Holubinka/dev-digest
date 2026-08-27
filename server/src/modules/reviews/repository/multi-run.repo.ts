import { and, desc, eq, inArray, isNull, type SQL } from 'drizzle-orm';
import type { Db } from '../../../db/client.js';
import * as t from '../../../db/schema.js';
import type { AgentRunRow, FindingRow } from '../../../db/rows.js';
import { createAgentRun } from './run.repo.js';

/**
 * Data access for `multi_agent_runs` + `multi_agent_run_items` (SPEC-05).
 *
 * Under `repository/` and not merely NAMED like a repository: the
 * `no-sql-outside-repository` rule matches the PATH
 * `src/modules/<m>/repository(\.ts$|/)`, so a file called
 * `multi-run-repository.ts` sat beside the service would be a violation with
 * identical contents.
 *
 * Inside `modules/reviews/` for the other half of the same reason: a
 * `modules/multi-agent/` slice would have to import `ReviewRunExecutor` and
 * `ReviewRepository`, and `no-cross-module` forbids that edge — `import type`
 * included, since dependency-cruiser runs with `tsPreCompilationDeps`.
 */

export type MultiRunRow = typeof t.multiAgentRuns.$inferSelect;
export type MultiRunItemRow = typeof t.multiAgentRunItems.$inferSelect;

/** One agent's slot in a multi-run, joined to everything a column needs. */
export interface MultiRunItemDetail {
  item: MultiRunItemRow;
  run: AgentRunRow | null;
  /**
   * Null when the agent has been deleted from the workspace — the LEFT join is
   * what makes AC-118 answerable at all. The item still carries `agentName`, so
   * the column keeps its name and gains `agent_deleted: true`.
   */
  agentExists: boolean;
  review: typeof t.reviews.$inferSelect | null;
  findings: FindingRow[];
}

export interface MultiRunDetail {
  multiRun: MultiRunRow;
  pull: typeof t.pullRequests.$inferSelect;
  items: MultiRunItemDetail[];
}

/**
 * Create a multi-run and everything that belongs to it in ONE transaction.
 *
 * AC-27, AC-28 and AC-30 all end in the same words — "nothing created" — so a
 * partial write is not a lesser failure than none, it is the failure those three
 * criteria name. The `agent_runs` rows go in `queued`: they exist from the
 * moment the POST is answered, so the client can subscribe to each SSE stream
 * immediately, but only `concurrency` of them are ever executing (AC-33, AC-34).
 */
export async function createMultiRun(
  db: Db,
  values: {
    workspaceId: string;
    prId: string;
    headSha: string | null;
    concurrency: number;
    items: { agentId: string; agentName: string; provider: string; model: string }[];
  },
): Promise<{ multiRunId: string; runIds: string[] }> {
  return db.transaction(async (tx) => {
    const [multiRun] = await tx
      .insert(t.multiAgentRuns)
      .values({
        workspaceId: values.workspaceId,
        prId: values.prId,
        headSha: values.headSha,
        concurrency: values.concurrency,
      })
      .returning({ id: t.multiAgentRuns.id });

    const runIds: string[] = [];
    for (const [position, item] of values.items.entries()) {
      const runId = await createAgentRun(tx, {
        workspaceId: values.workspaceId,
        agentId: item.agentId,
        prId: values.prId,
        provider: item.provider,
        model: item.model,
        status: 'queued',
      });
      runIds.push(runId);
      await tx.insert(t.multiAgentRunItems).values({
        runId,
        multiRunId: multiRun!.id,
        agentId: item.agentId,
        agentName: item.agentName,
        position,
      });
    }

    return { multiRunId: multiRun!.id, runIds };
  });
}

/**
 * Stamp the moment the multi-run's last run reached a terminal state (AC-155).
 *
 * `finished_at IS NULL` in the predicate rather than a plain `SET`: the summary
 * duration is a MEASUREMENT (AC-41), and a second write would move a number the
 * page has already shown. It also makes the call safe to retry.
 *
 * Not workspace-scoped, and deliberately so — the only caller is the executor's
 * own continuation, which is holding an id it just created; there is no request
 * and no tenant to resolve against.
 */
export async function markMultiRunFinished(db: Db, multiRunId: string): Promise<void> {
  await db
    .update(t.multiAgentRuns)
    .set({ finishedAt: new Date() })
    .where(and(eq(t.multiAgentRuns.id, multiRunId), isNull(t.multiAgentRuns.finishedAt)));
}

/**
 * The whole multi-run: its row, its PR, and one detail per item in `position`
 * order — everything both view modes and the finding detail draw, in one read
 * (AC-98).
 *
 * Workspace-scoped on the multi-run row, so a multi-run of another workspace
 * comes back `undefined` and the caller turns that into "not found", which is
 * what makes it indistinguishable from one that never existed (AC-95).
 *
 * `agent_runs` is a LEFT join because AC-99 deletes a run out from under its
 * item — the FK cascade removes the item too, so in practice the row is gone
 * rather than dangling, and the join stays left so a future non-cascading path
 * degrades to a missing column instead of a missing multi-run.
 */
export async function getMultiRun(
  db: Db,
  workspaceId: string,
  multiRunId: string,
): Promise<MultiRunDetail | undefined> {
  const [head] = await db
    .select({ multiRun: t.multiAgentRuns, pull: t.pullRequests })
    .from(t.multiAgentRuns)
    .innerJoin(t.pullRequests, eq(t.pullRequests.id, t.multiAgentRuns.prId))
    .where(
      and(
        eq(t.multiAgentRuns.id, multiRunId),
        eq(t.multiAgentRuns.workspaceId, workspaceId),
      ),
    );
  if (!head) return undefined;

  const rows = await db
    .select({
      item: t.multiAgentRunItems,
      run: t.agentRuns,
      agentId: t.agents.id,
      review: t.reviews,
    })
    .from(t.multiAgentRunItems)
    .leftJoin(t.agentRuns, eq(t.agentRuns.id, t.multiAgentRunItems.runId))
    .leftJoin(t.agents, eq(t.agents.id, t.multiAgentRunItems.agentId))
    // At most one review per run: `run-executor.ts:535` is the only writer of
    // `reviews.run_id` and writes exactly one row per run. `reviews` carries no
    // unique constraint on the column, so a second writer would double every
    // column here — that is the invariant this join depends on, named.
    .leftJoin(t.reviews, eq(t.reviews.runId, t.multiAgentRunItems.runId))
    .where(eq(t.multiAgentRunItems.multiRunId, multiRunId))
    .orderBy(t.multiAgentRunItems.position);

  // One query for every finding of the multi-run, keyed by review — N+1 over ten
  // columns would be ten round trips for a page that already waited for ten
  // model calls, and the join above has the review ids in hand.
  const reviewIds = rows.map((r) => r.review?.id).filter((id): id is string => id != null);
  const findingsByReview = new Map<string, FindingRow[]>();
  if (reviewIds.length > 0) {
    const all = await db
      .select()
      .from(t.findings)
      .where(inArray(t.findings.reviewId, reviewIds))
      .orderBy(t.findings.file, t.findings.startLine);
    for (const finding of all) {
      const bucket = findingsByReview.get(finding.reviewId);
      if (bucket) bucket.push(finding);
      else findingsByReview.set(finding.reviewId, [finding]);
    }
  }

  return {
    multiRun: head.multiRun,
    pull: head.pull,
    items: rows.map((r) => ({
      item: r.item,
      run: r.run,
      agentExists: r.agentId != null,
      review: r.review,
      findings: r.review ? (findingsByReview.get(r.review.id) ?? []) : [],
    })),
  };
}

/**
 * Shared body of `latestMultiRunForRepo` and `latestMultiRunForPull` — same
 * select/join/orderBy/limit(1), differing only in which `eq()` narrows the
 * `multi_agent_runs` row.
 */
async function latestMultiRun(
  db: Db,
  extraCondition: SQL | undefined,
): Promise<{ multiRun: MultiRunRow; prNumber: number } | undefined> {
  const [row] = await db
    .select({ multiRun: t.multiAgentRuns, prNumber: t.pullRequests.number })
    .from(t.multiAgentRuns)
    .innerJoin(t.pullRequests, eq(t.pullRequests.id, t.multiAgentRuns.prId))
    .where(extraCondition)
    .orderBy(desc(t.multiAgentRuns.ranAt))
    .limit(1);
  return row;
}

/**
 * The newest multi-run of one repo — the repo-scoped landing's only read
 * (AC-94). Joined through `pull_requests` because `multi_agent_runs` carries the
 * PR, not the repo. Carries no findings: it is used to build a link.
 */
export async function latestMultiRunForRepo(
  db: Db,
  workspaceId: string,
  repoId: string,
): Promise<{ multiRun: MultiRunRow; prNumber: number } | undefined> {
  return latestMultiRun(
    db,
    and(eq(t.multiAgentRuns.workspaceId, workspaceId), eq(t.pullRequests.repoId, repoId)),
  );
}

/**
 * The newest multi-run of one PR (R54).
 *
 * This is what makes the PR page's link to a comparison survive a reload and a
 * return the next day: AC-88 covers only the moment of launch, and an id held in
 * page state alone dies with the page. Carries no findings, for the same reason
 * `MultiAgentRunRef` is a narrowing — every PR page load would otherwise pull up
 * to 500 findings with their rationales to draw one anchor.
 */
export async function latestMultiRunForPull(
  db: Db,
  workspaceId: string,
  prId: string,
): Promise<{ multiRun: MultiRunRow; prNumber: number } | undefined> {
  return latestMultiRun(
    db,
    and(eq(t.multiAgentRuns.workspaceId, workspaceId), eq(t.multiAgentRuns.prId, prId)),
  );
}

/**
 * The agent ids a multi-run was created with, in `position` order — the stored
 * set a re-run resolves from.
 *
 * Read from the ITEMS, not from `agent_runs.agent_id`, because that column is
 * `ON DELETE SET NULL`: after an agent is deleted it would answer `null` for the
 * very agent AC-117 asks to be named as skipped.
 */
export async function agentIdsOfMultiRun(
  db: Db,
  workspaceId: string,
  multiRunId: string,
): Promise<{ prId: string; agents: { agentId: string; agentName: string }[] } | undefined> {
  // The PR comes back with the set because a re-run is "the same agents on the
  // same PR" (AC-114) and the client names neither — both are read from storage,
  // which is what lets AC-117 run the survivors where AC-28 refuses the request.
  const [head] = await db
    .select({ prId: t.multiAgentRuns.prId })
    .from(t.multiAgentRuns)
    .where(
      and(
        eq(t.multiAgentRuns.id, multiRunId),
        eq(t.multiAgentRuns.workspaceId, workspaceId),
      ),
    );
  if (!head) return undefined;
  const agents = await db
    .select({ agentId: t.multiAgentRunItems.agentId, agentName: t.multiAgentRunItems.agentName })
    .from(t.multiAgentRunItems)
    .where(eq(t.multiAgentRunItems.multiRunId, multiRunId))
    .orderBy(t.multiAgentRunItems.position);
  return { prId: head.prId, agents };
}
