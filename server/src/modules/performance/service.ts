import type { AgentPerf, AgentPerfDetail, PerfPeriod } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { buildAgentPerf, buildTrend, previousPeriod, trendBucketSeconds } from './helpers.js';
import { PerformanceRepository } from './repository.js';

/**
 * Agent Performance — the dashboard and the agent editor's Stats tab.
 *
 * Both reads are pure aggregation over rows that already exist. Nothing here
 * touches an LLM port, and that is the feature's main promise: opening this
 * screen, reloading it, sorting it or expanding a row cannot spend money
 * (AC-43, AC-44).
 */
export class PerformanceService {
  constructor(
    container: Container,
    private repo: PerformanceRepository = new PerformanceRepository(container.db),
  ) {}

  async dashboard(workspaceId: string, period: PerfPeriod): Promise<AgentPerf> {
    const previous = previousPeriod(period);
    const bucketSeconds = trendBucketSeconds(period);
    const from = new Date(period.from);
    const to = new Date(period.to);

    const [agents, cells, findings, prevFindings, prevCostMicros, buckets] = await Promise.all([
      this.repo.listAgents(workspaceId),
      this.repo.runCells(workspaceId, from, to),
      this.repo.findingCounts(workspaceId, from, to),
      this.repo.findingCounts(workspaceId, previous.from, previous.to),
      this.repo.costMicros(workspaceId, previous.from, previous.to),
      this.repo.trendBuckets(workspaceId, from, to, bucketSeconds),
    ]);

    return buildAgentPerf({
      period,
      agents,
      cells,
      findings,
      prevFindings,
      prevCostMicros,
      trend: buildTrend(period, bucketSeconds, buckets),
    });
  }

  /**
   * One agent's numbers, taken OUT of the dashboard rather than queried narrowly.
   *
   * The extra rows cost one grouped scan of a window this screen already scans,
   * and they buy the one property the feature is judged on: the tab and the
   * dashboard cannot disagree, because there is only one computation (AC-45,
   * AC-46). A second, narrower query would be a second implementation of every
   * rule in `helpers.ts`, and the day one of them changed only one would.
   *
   * The trend is the exception and is fetched per agent: a workspace-wide
   * sparkline on an agent's own tab would answer a question nobody asked.
   */
  async agentStats(
    workspaceId: string,
    agentId: string,
    period: PerfPeriod,
  ): Promise<AgentPerfDetail | undefined> {
    const perf = await this.dashboard(workspaceId, period);
    const agent = perf.agents.find((row) => row.agent_id === agentId);
    if (!agent) return undefined;

    const bucketSeconds = trendBucketSeconds(period);
    const buckets = await this.repo.trendBuckets(
      workspaceId,
      new Date(period.from),
      new Date(period.to),
      bucketSeconds,
      agentId,
    );

    return {
      period,
      min_decisions_for_rank: perf.min_decisions_for_rank,
      cost_basis: perf.cost_basis,
      agent,
      runs_trend: buildTrend(period, bucketSeconds, buckets),
    };
  }
}
