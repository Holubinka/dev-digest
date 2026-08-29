import type {
  AgentPerf,
  AgentPerfRow,
  AgentPerfSummary,
  PerfAgentCostSegment,
  PerfCostSegment,
  PerfPeriod,
  PerfRange,
  PerfTrendPoint,
} from '@devdigest/shared';
import { MAX_TREND_BUCKETS, MIN_DECISIONS_FOR_RANK, USD_MICROS } from './constants.js';

/**
 * Pure aggregation for Agent Performance — every rule the screen states, and no
 * I/O. The repository shapes below are this file's INPUT contract; the repository
 * imports them from here so the arrow points inward.
 */

const DAY_MS = 86_400_000;

/** One (agent, model) cell of the counted runs in a window. */
export interface RunCell {
  /** Null when the agent has been deleted — `agent_runs.agent_id` is ON DELETE SET NULL. */
  agentId: string | null;
  model: string | null;
  runs: number;
  runsWithCost: number;
  /** Integer micro-dollars, so the two donuts and the total reconcile exactly. */
  costMicros: number;
  durationSumMs: number;
  runsWithDuration: number;
  lastRunAt: Date | null;
}

/** Findings of one agent's counted runs, already split by outcome and severity. */
export interface FindingCount {
  agentId: string | null;
  findings: number;
  accepted: number;
  dismissed: number;
  critical: number;
  warning: number;
  suggestion: number;
}

/** An agent as the table names it. */
export interface AgentIdentity {
  id: string;
  name: string;
  provider: string | null;
  model: string | null;
}

/** Counted runs in one bucket of the trend, keyed by the bucket's epoch index. */
export interface TrendBucket {
  index: number;
  runs: number;
}

export interface PerfInput {
  period: PerfPeriod;
  agents: AgentIdentity[];
  cells: RunCell[];
  findings: FindingCount[];
  /** The same shape over the preceding window of equal length — the row arrows. */
  prevFindings: FindingCount[];
  /** Total cost of that preceding window, micro-dollars; null when it costed nothing. */
  prevCostMicros: number | null;
  trend: PerfTrendPoint[];
}

// ---------------------------------------------------------------------------
// Period
// ---------------------------------------------------------------------------

/**
 * The window to aggregate, as a half-open `[from, to)` interval ending now.
 *
 * `custom` MUST arrive with bounds: the route's Zod schema refuses the request
 * with a 422 before this is called (AC-8), so the throw states an invariant
 * rather than handling a case. Guessing a window here — falling back to 30 days
 * for a request that asked for a range — would put numbers under a caption that
 * does not describe them.
 */
export function resolvePeriod(
  range: PerfRange,
  now: Date,
  custom?: { from: Date; to: Date },
): PerfPeriod {
  if (range === 'custom') {
    if (!custom) {
      throw new Error('resolvePeriod: a custom range needs bounds; the route schema is the gate');
    }
    return { kind: 'custom', from: custom.from.toISOString(), to: custom.to.toISOString() };
  }
  const days = range === '1d' ? 1 : 30;
  return {
    kind: range,
    from: new Date(now.getTime() - days * DAY_MS).toISOString(),
    to: now.toISOString(),
  };
}

/** The window of equal length immediately before this one — what a delta compares against. */
export function previousPeriod(period: PerfPeriod): { from: Date; to: Date } {
  const from = new Date(period.from);
  const to = new Date(period.to);
  const span = to.getTime() - from.getTime();
  return { from: new Date(from.getTime() - span), to: from };
}

/**
 * How wide one sparkline bucket is, in seconds.
 *
 * Seconds since the epoch rather than `date_trunc`, because `date_trunc` on a
 * `timestamptz` resolves in the session's time zone: the same rows would bucket
 * differently on a server whose `TimeZone` differs from the developer's laptop.
 * Integer division of the epoch has no time zone at all, and 86 400-second
 * buckets are exactly UTC days.
 */
export function trendBucketSeconds(period: PerfPeriod): number {
  const span = Math.max(1, (new Date(period.to).getTime() - new Date(period.from).getTime()) / 1000);
  for (const candidate of [3600, 86_400, 604_800]) {
    if (span / candidate <= MAX_TREND_BUCKETS) return candidate;
  }
  return Math.ceil(span / MAX_TREND_BUCKETS);
}

/**
 * The dense series the sparkline draws: one point per bucket in the window,
 * including the buckets nothing ran in.
 *
 * A sparse series would draw a line through the gaps and turn a quiet week into a
 * gentle slope. A zero here is not a fabricated number — it is the counted fact
 * that no run happened in that bucket.
 */
export function buildTrend(
  period: PerfPeriod,
  bucketSeconds: number,
  buckets: TrendBucket[],
): PerfTrendPoint[] {
  const fromMs = new Date(period.from).getTime();
  const toMs = new Date(period.to).getTime();
  const first = Math.floor(fromMs / 1000 / bucketSeconds);
  const last = Math.floor((toMs - 1) / 1000 / bucketSeconds);
  const counts = new Map(buckets.map((b) => [b.index, b.runs]));
  const points: PerfTrendPoint[] = [];
  for (let i = first; i <= last; i += 1) {
    points.push({
      at: new Date(i * bucketSeconds * 1000).toISOString(),
      value: counts.get(i) ?? 0,
    });
  }
  return points;
}

// ---------------------------------------------------------------------------
// Rates and money
// ---------------------------------------------------------------------------

/** A ratio, or null when there is nothing to divide by. Never 0 for "no data". */
export function rate(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

/** Micro-dollars back to dollars. */
export function usd(micros: number): number {
  return micros / USD_MICROS;
}

const EMPTY_FINDINGS: FindingCount = {
  agentId: null,
  findings: 0,
  accepted: 0,
  dismissed: 0,
  critical: 0,
  warning: 0,
  suggestion: 0,
};

const EMPTY_CELL_TOTALS = {
  runs: 0,
  runsWithCost: 0,
  costMicros: 0,
  durationSumMs: 0,
  runsWithDuration: 0,
  lastRunAt: null as Date | null,
};

type CellTotals = typeof EMPTY_CELL_TOTALS;

function addCell(acc: CellTotals, cell: RunCell): CellTotals {
  return {
    runs: acc.runs + cell.runs,
    runsWithCost: acc.runsWithCost + cell.runsWithCost,
    costMicros: acc.costMicros + cell.costMicros,
    durationSumMs: acc.durationSumMs + cell.durationSumMs,
    runsWithDuration: acc.runsWithDuration + cell.runsWithDuration,
    lastRunAt:
      cell.lastRunAt && (!acc.lastRunAt || cell.lastRunAt > acc.lastRunAt)
        ? cell.lastRunAt
        : acc.lastRunAt,
  };
}

function foldBy<K>(cells: RunCell[], key: (c: RunCell) => K): Map<K, CellTotals> {
  const out = new Map<K, CellTotals>();
  for (const cell of cells) {
    out.set(key(cell), addCell(out.get(key(cell)) ?? EMPTY_CELL_TOTALS, cell));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

/**
 * One row per agent in the workspace — including the agents that did not run.
 *
 * An agent with no counted run is a real answer to "how is this agent doing"
 * (SPEC-07 § D6), and it renders as `0` runs and `—` everywhere else. Dropping it
 * from the array would make the screen say the agent does not exist.
 */
export function buildRows(input: PerfInput): AgentPerfRow[] {
  const byAgent = foldBy(input.cells, (c) => c.agentId);
  const findings = new Map(input.findings.map((f) => [f.agentId, f]));
  const prev = new Map(input.prevFindings.map((f) => [f.agentId, f]));

  return input.agents.map((agent) => {
    const totals = byAgent.get(agent.id) ?? EMPTY_CELL_TOTALS;
    const found = findings.get(agent.id) ?? EMPTY_FINDINGS;
    const before = prev.get(agent.id) ?? EMPTY_FINDINGS;
    const judged = found.accepted + found.dismissed;

    return {
      agent_id: agent.id,
      agent_name: agent.name,
      provider: agent.provider,
      model: agent.model,
      runs: totals.runs,
      runs_with_cost: totals.runsWithCost,
      runs_without_cost: totals.runs - totals.runsWithCost,
      findings_total: found.findings,
      accepted: found.accepted,
      dismissed: found.dismissed,
      pending: found.findings - judged,
      judged,
      accept_rate: rate(found.accepted, judged),
      dismiss_rate: rate(found.dismissed, judged),
      low_sample: judged < MIN_DECISIONS_FOR_RANK,
      prev_accept_rate: rate(before.accepted, before.accepted + before.dismissed),
      avg_findings_per_run: rate(found.findings, totals.runs),
      total_cost_usd: totals.runsWithCost === 0 ? null : usd(totals.costMicros),
      avg_cost_usd:
        totals.runsWithCost === 0 ? null : usd(totals.costMicros) / totals.runsWithCost,
      avg_duration_ms:
        totals.runsWithDuration === 0 ? null : totals.durationSumMs / totals.runsWithDuration,
      last_run_at: totals.lastRunAt ? totals.lastRunAt.toISOString() : null,
      findings_by_severity: {
        CRITICAL: found.critical,
        WARNING: found.warning,
        SUGGESTION: found.suggestion,
      },
    };
  });
}

/**
 * The agent with the most counted runs in the window.
 *
 * The tiebreak is stated rather than left to array order: two agents on the same
 * count would otherwise swap places between two loads of the same screen, which
 * reads as data changing when nothing did.
 */
export function pickMostActive(rows: AgentPerfRow[]): AgentPerfSummary['most_active_agent'] {
  const ran = rows.filter((r) => r.runs > 0);
  if (ran.length === 0) return null;
  const winner = [...ran].sort(
    (a, b) =>
      b.runs - a.runs ||
      (b.last_run_at ?? '').localeCompare(a.last_run_at ?? '') ||
      a.agent_name.localeCompare(b.agent_name),
  )[0]!;
  return {
    agent_id: winner.agent_id,
    agent_name: winner.agent_name,
    runs: winner.runs,
    accept_rate: winner.accept_rate,
  };
}

// ---------------------------------------------------------------------------
// Cost breakdown
// ---------------------------------------------------------------------------

/**
 * Cost per agent, largest first, plus one bucket for the runs whose agent is gone.
 *
 * The empty `label` on that bucket is deliberate: the server has no name for it,
 * and the words on the screen come from `next-intl`, not from a route. The client
 * reads `agent_id === null` and writes its own (AC-34).
 */
export function costByAgent(cells: RunCell[], rows: AgentPerfRow[]): PerfAgentCostSegment[] {
  const names = new Map(rows.map((r) => [r.agent_id, r.agent_name]));
  const folded = foldBy(cells, (c) => c.agentId);
  const segments: PerfAgentCostSegment[] = [];
  for (const [agentId, totals] of folded) {
    if (totals.costMicros === 0) continue;
    segments.push({
      agent_id: agentId,
      label: agentId === null ? '' : (names.get(agentId) ?? ''),
      value: usd(totals.costMicros),
    });
  }
  return segments.sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
}

/** Cost per model, largest first. An empty label is a run that recorded no model (AC-35). */
export function costByModel(cells: RunCell[]): PerfCostSegment[] {
  const folded = foldBy(cells, (c) => c.model);
  const segments: PerfCostSegment[] = [];
  for (const [model, totals] of folded) {
    if (totals.costMicros === 0) continue;
    segments.push({ label: model ?? '', value: usd(totals.costMicros) });
  }
  return segments.sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
}

// ---------------------------------------------------------------------------
// The whole answer
// ---------------------------------------------------------------------------

/**
 * The dashboard, assembled. `GET /agents/:id/stats` takes its row out of THIS
 * result rather than running a narrower query, which is what makes the tab and
 * the dashboard agree by construction (AC-45, AC-46).
 */
export function buildAgentPerf(input: PerfInput): AgentPerf {
  const rows = buildRows(input);
  const all = input.cells.reduce(addCell, EMPTY_CELL_TOTALS);
  const orphanRuns = input.cells
    .filter((c) => c.agentId === null)
    .reduce((n, c) => n + c.runs, 0);

  const accepted = input.findings.reduce((n, f) => n + f.accepted, 0);
  const dismissed = input.findings.reduce((n, f) => n + f.dismissed, 0);
  const judged = accepted + dismissed;

  const summary: AgentPerfSummary = {
    runs: all.runs,
    runs_without_agent: orphanRuns,
    total_cost_usd: all.runsWithCost === 0 ? null : usd(all.costMicros),
    prev_total_cost_usd: input.prevCostMicros === null ? null : usd(input.prevCostMicros),
    runs_with_cost: all.runsWithCost,
    runs_without_cost: all.runs - all.runsWithCost,
    accepted,
    dismissed,
    judged,
    avg_accept_rate: rate(accepted, judged),
    most_active_agent: pickMostActive(rows),
    runs_trend: input.trend,
  };

  return {
    period: input.period,
    min_decisions_for_rank: MIN_DECISIONS_FOR_RANK,
    // Every cost this system stores is estimated from the price book; nothing
    // reconciles it against a provider's billing. Hard-coded rather than derived
    // because there is nothing to derive it from yet, and the day there is, this
    // is the one line that changes (AC-36, AC-37).
    cost_basis: 'estimated',
    summary,
    agents: rows,
    cost_by_agent: costByAgent(input.cells, rows),
    cost_by_model: costByModel(input.cells),
  };
}
