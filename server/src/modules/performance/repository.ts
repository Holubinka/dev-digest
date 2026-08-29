import { and, asc, count, eq, gte, inArray, lt, max, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import { COUNTED_RUN_STATUSES, USD_MICROS } from './constants.js';
import type { AgentIdentity, FindingCount, RunCell, TrendBucket } from './helpers.js';

/**
 * Data access for Agent Performance. Every read is workspace-scoped, period-scoped
 * and restricted to counted runs; nothing here decides what a number MEANS — that
 * is `helpers.ts`.
 *
 * Cost is summed as integer micro-dollars IN POSTGRES — `sum(round(cost_usd *
 * 1e6))` over `numeric` — rather than as float dollars. Summing `double
 * precision` gives a result that depends on the order the planner happened to
 * add the rows in, so the same runs grouped by agent and grouped by model can
 * differ in the last bits, and AC-32/AC-33 require both donuts to equal the
 * total exactly.
 */

/** Half-open `[from, to)` over the counted statuses, for one workspace. */
function inWindow(workspaceId: string, from: Date, to: Date) {
  return and(
    eq(t.agentRuns.workspaceId, workspaceId),
    gte(t.agentRuns.ranAt, from),
    lt(t.agentRuns.ranAt, to),
    inArray(t.agentRuns.status, [...COUNTED_RUN_STATUSES]),
  );
}

const COST_MICROS = sql<string | null>`sum(round((${t.agentRuns.costUsd} * ${USD_MICROS})::numeric))`;

export class PerformanceRepository {
  constructor(private db: Db) {}

  /**
   * Every agent in the workspace, so an agent with no run still gets a row (AC-22),
   * and so the Stats route can answer 404 from the same list it would have drawn.
   *
   * Its own narrow projection rather than `container.agentsRepo.list`: that read
   * joins `agent_skills` and `skills` to count bindings this screen never shows,
   * and its `AgentWithSkillCount` row would cross into a slice that has no use
   * for it (onion § 3.5).
   */
  async listAgents(workspaceId: string): Promise<AgentIdentity[]> {
    const rows = await this.db
      .select({
        id: t.agents.id,
        name: t.agents.name,
        provider: t.agents.provider,
        model: t.agents.model,
      })
      .from(t.agents)
      .where(eq(t.agents.workspaceId, workspaceId))
      .orderBy(asc(t.agents.name), asc(t.agents.id));
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      provider: r.provider,
      model: r.model,
    }));
  }

  /**
   * Counted runs grouped by `(agent_id, model)`.
   *
   * ONE query behind three answers — per agent, per model, and the workspace total
   * — because they are three folds of the same cells. Two queries would be two
   * chances for the donuts to disagree with the tile above them.
   */
  async runCells(workspaceId: string, from: Date, to: Date): Promise<RunCell[]> {
    const rows = await this.db
      .select({
        agentId: t.agentRuns.agentId,
        model: t.agentRuns.model,
        runs: count(),
        runsWithCost: count(t.agentRuns.costUsd),
        costMicros: COST_MICROS,
        durationSumMs: sql<string | null>`sum(${t.agentRuns.durationMs})`,
        runsWithDuration: count(t.agentRuns.durationMs),
        lastRunAt: max(t.agentRuns.ranAt),
      })
      .from(t.agentRuns)
      .where(inWindow(workspaceId, from, to))
      .groupBy(t.agentRuns.agentId, t.agentRuns.model);

    return rows.map((r) => ({
      agentId: r.agentId,
      model: r.model,
      runs: Number(r.runs),
      runsWithCost: Number(r.runsWithCost),
      costMicros: Number(r.costMicros ?? 0),
      durationSumMs: Number(r.durationSumMs ?? 0),
      runsWithDuration: Number(r.runsWithDuration),
      lastRunAt: r.lastRunAt ? new Date(r.lastRunAt) : null,
    }));
  }

  /** Total cost of the window in micro-dollars; null when nothing in it costed anything. */
  async costMicros(workspaceId: string, from: Date, to: Date): Promise<number | null> {
    const [row] = await this.db
      .select({ costMicros: COST_MICROS, runsWithCost: count(t.agentRuns.costUsd) })
      .from(t.agentRuns)
      .where(inWindow(workspaceId, from, to));
    if (!row || Number(row.runsWithCost) === 0) return null;
    return Number(row.costMicros ?? 0);
  }

  /**
   * Findings of the counted runs, per agent.
   *
   * The join runs findings → reviews → agent_runs, so a finding belongs to the
   * window that holds its RUN, never to the moment somebody accepted it
   * (SPEC-07 § D5). Accepting a year-old finding today must not move today's
   * accept rate for a run that is not in today's window.
   */
  async findingCounts(workspaceId: string, from: Date, to: Date): Promise<FindingCount[]> {
    const rows = await this.db
      .select({
        agentId: t.agentRuns.agentId,
        findings: count(t.findings.id),
        accepted: count(t.findings.acceptedAt),
        dismissed: count(t.findings.dismissedAt),
        critical: sql<string>`count(*) filter (where ${t.findings.severity} = 'CRITICAL')`,
        warning: sql<string>`count(*) filter (where ${t.findings.severity} = 'WARNING')`,
        suggestion: sql<string>`count(*) filter (where ${t.findings.severity} = 'SUGGESTION')`,
      })
      .from(t.findings)
      .innerJoin(t.reviews, eq(t.reviews.id, t.findings.reviewId))
      .innerJoin(t.agentRuns, eq(t.agentRuns.id, t.reviews.runId))
      .where(inWindow(workspaceId, from, to))
      .groupBy(t.agentRuns.agentId);

    return rows.map((r) => ({
      agentId: r.agentId,
      findings: Number(r.findings),
      accepted: Number(r.accepted),
      dismissed: Number(r.dismissed),
      critical: Number(r.critical),
      warning: Number(r.warning),
      suggestion: Number(r.suggestion),
    }));
  }

  /**
   * Counted runs per sparkline bucket, keyed by `floor(epoch / bucketSeconds)`.
   *
   * Not `date_trunc`: that resolves in the session's time zone, so the same rows
   * would bucket differently on a server configured differently from the laptop
   * the screen was built on. Integer division of the epoch has no time zone.
   */
  async trendBuckets(
    workspaceId: string,
    from: Date,
    to: Date,
    bucketSeconds: number,
    agentId?: string,
  ): Promise<TrendBucket[]> {
    // `sql.raw` and not a bound parameter: the same expression has to appear in
    // SELECT and in GROUP BY, and drizzle appends the parameters of each chunk
    // separately — the two renderings come out as `$1` and `$2`, which Postgres
    // compares structurally and rejects with "must appear in the GROUP BY
    // clause". The value is our own computed integer, truncated here so nothing
    // but digits can reach the statement.
    const seconds = Math.max(1, Math.trunc(bucketSeconds));
    const bucket = sql<string>`floor(extract(epoch from ${t.agentRuns.ranAt}) / ${sql.raw(String(seconds))})`;
    const rows = await this.db
      .select({ index: bucket, runs: count() })
      .from(t.agentRuns)
      .where(
        agentId === undefined
          ? inWindow(workspaceId, from, to)
          : and(inWindow(workspaceId, from, to), eq(t.agentRuns.agentId, agentId)),
      )
      .groupBy(bucket);
    return rows.map((r) => ({ index: Number(r.index), runs: Number(r.runs) }));
  }
}
