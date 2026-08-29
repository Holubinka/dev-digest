import { describe, it, expect } from 'vitest';
import {
  buildAgentPerf,
  buildRows,
  buildTrend,
  costByAgent,
  costByModel,
  pickMostActive,
  previousPeriod,
  rate,
  resolvePeriod,
  trendBucketSeconds,
  type AgentIdentity,
  type FindingCount,
  type PerfInput,
  type RunCell,
} from '../src/modules/performance/helpers.js';
import { MIN_DECISIONS_FOR_RANK } from '../src/modules/performance/constants.js';

/**
 * The aggregation rules of SPEC-07, tested where they live: a pure function of
 * rows the repository already fetched. Everything the screen promises about a
 * number — that it is null rather than zero when unknown, that the two donuts
 * add up to the tile, that a tie resolves the same way twice — is decided here.
 */

const NOW = new Date('2026-08-29T12:00:00.000Z');

function agent(id: string, name: string): AgentIdentity {
  return { id, name, provider: 'openai', model: 'gpt-4o-mini' };
}

function cell(over: Partial<RunCell> = {}): RunCell {
  return {
    agentId: 'a1',
    model: 'gpt-4o-mini',
    runs: 1,
    runsWithCost: 1,
    costMicros: 40_000,
    durationSumMs: 6_200,
    runsWithDuration: 1,
    lastRunAt: new Date('2026-08-29T11:00:00.000Z'),
    ...over,
  };
}

function found(over: Partial<FindingCount> = {}): FindingCount {
  return {
    agentId: 'a1',
    findings: 10,
    accepted: 6,
    dismissed: 2,
    critical: 1,
    warning: 4,
    suggestion: 5,
    ...over,
  };
}

function input(over: Partial<PerfInput> = {}): PerfInput {
  return {
    period: resolvePeriod('30d', NOW),
    agents: [agent('a1', 'Security Reviewer')],
    cells: [cell()],
    findings: [found()],
    prevFindings: [],
    prevCostMicros: null,
    trend: [],
    ...over,
  };
}

describe('resolvePeriod', () => {
  it('makes 1d and 30d windows that end now', () => {
    expect(resolvePeriod('1d', NOW)).toEqual({
      kind: '1d',
      from: '2026-08-28T12:00:00.000Z',
      to: '2026-08-29T12:00:00.000Z',
    });
    expect(resolvePeriod('30d', NOW).from).toBe('2026-07-30T12:00:00.000Z');
  });

  it('passes a custom range through untouched', () => {
    const custom = { from: new Date('2026-01-01T00:00:00Z'), to: new Date('2026-02-01T00:00:00Z') };
    expect(resolvePeriod('custom', NOW, custom)).toEqual({
      kind: 'custom',
      from: '2026-01-01T00:00:00.000Z',
      to: '2026-02-01T00:00:00.000Z',
    });
  });

  it('refuses to invent a window for a custom range with no bounds', () => {
    expect(() => resolvePeriod('custom', NOW)).toThrow(/bounds/);
  });

  it('puts the previous window immediately before, at the same length', () => {
    const period = resolvePeriod('1d', NOW);
    expect(previousPeriod(period)).toEqual({
      from: new Date('2026-08-27T12:00:00.000Z'),
      to: new Date('2026-08-28T12:00:00.000Z'),
    });
  });
});

describe('trend', () => {
  it('buckets a day by the hour and a month by the day', () => {
    expect(trendBucketSeconds(resolvePeriod('1d', NOW))).toBe(3600);
    expect(trendBucketSeconds(resolvePeriod('30d', NOW))).toBe(86_400);
  });

  it('falls back to a wider bucket than a week when the span is enormous', () => {
    const period = resolvePeriod('custom', NOW, {
      from: new Date('2020-01-01T00:00:00Z'),
      to: new Date('2026-01-01T00:00:00Z'),
    });
    expect(trendBucketSeconds(period)).toBeGreaterThan(604_800);
  });

  it('fills the buckets nothing ran in, so the line does not cut corners', () => {
    const period = resolvePeriod('custom', NOW, {
      from: new Date('2026-08-26T00:00:00Z'),
      to: new Date('2026-08-29T00:00:00Z'),
    });
    const dayIndex = (iso: string) => Math.floor(new Date(iso).getTime() / 1000 / 86_400);
    const points = buildTrend(period, 86_400, [
      { index: dayIndex('2026-08-26T00:00:00Z'), runs: 3 },
      { index: dayIndex('2026-08-28T00:00:00Z'), runs: 5 },
    ]);
    expect(points.map((p) => p.value)).toEqual([3, 0, 5]);
    expect(points[0]!.at).toBe('2026-08-26T00:00:00.000Z');
  });
});

describe('rate', () => {
  it('is null rather than zero when there is nothing to divide by', () => {
    expect(rate(0, 0)).toBeNull();
    expect(rate(3, 4)).toBe(0.75);
  });
});

describe('buildRows', () => {
  it('gives an agent that never ran a row of zeros and nulls, not a row of zeros', () => {
    const rows = buildRows(
      input({ agents: [agent('a1', 'A'), agent('a2', 'Never Ran')], findings: [] }),
    );
    const never = rows.find((r) => r.agent_id === 'a2')!;
    expect(never.runs).toBe(0);
    expect(never.avg_cost_usd).toBeNull();
    expect(never.avg_duration_ms).toBeNull();
    expect(never.accept_rate).toBeNull();
    expect(never.last_run_at).toBeNull();
    expect(never.total_cost_usd).toBeNull();
  });

  it('divides cost by the runs that HAVE a cost, not by every run', () => {
    const rows = buildRows(
      input({
        cells: [cell({ runs: 4, runsWithCost: 2, costMicros: 100_000 })],
      }),
    );
    expect(rows[0]!.runs).toBe(4);
    expect(rows[0]!.runs_without_cost).toBe(2);
    expect(rows[0]!.total_cost_usd).toBeCloseTo(0.1, 10);
    expect(rows[0]!.avg_cost_usd).toBeCloseTo(0.05, 10);
  });

  it('averages duration over the runs that recorded one', () => {
    const rows = buildRows(
      input({ cells: [cell({ runs: 3, durationSumMs: 9_000, runsWithDuration: 2 })] }),
    );
    expect(rows[0]!.avg_duration_ms).toBe(4_500);
  });

  it('carries the accept-rate denominator and leaves pending outside it', () => {
    const rows = buildRows(input({ findings: [found({ findings: 10, accepted: 6, dismissed: 2 })] }));
    expect(rows[0]!.judged).toBe(8);
    expect(rows[0]!.pending).toBe(2);
    expect(rows[0]!.accept_rate).toBe(0.75);
    expect(rows[0]!.dismiss_rate).toBe(0.25);
  });

  it('marks a rate below the ranking threshold as a small sample', () => {
    const small = buildRows(input({ findings: [found({ findings: 1, accepted: 1, dismissed: 0 })] }));
    expect(small[0]!.accept_rate).toBe(1);
    expect(small[0]!.low_sample).toBe(true);

    const enough = buildRows(
      input({
        findings: [
          found({ findings: MIN_DECISIONS_FOR_RANK, accepted: MIN_DECISIONS_FOR_RANK, dismissed: 0 }),
        ],
      }),
    );
    expect(enough[0]!.low_sample).toBe(false);
  });

  it('has no previous accept rate when the window before judged nothing', () => {
    expect(buildRows(input())[0]!.prev_accept_rate).toBeNull();
    const withPrev = buildRows(
      input({ prevFindings: [found({ accepted: 1, dismissed: 1 })] }),
    );
    expect(withPrev[0]!.prev_accept_rate).toBe(0.5);
  });

  it('takes the last run from the newest cell of the agent', () => {
    const rows = buildRows(
      input({
        cells: [
          cell({ model: 'gpt-4o-mini', lastRunAt: new Date('2026-08-29T09:00:00Z') }),
          cell({ model: 'gpt-4.1', lastRunAt: new Date('2026-08-29T11:30:00Z') }),
        ],
      }),
    );
    expect(rows[0]!.last_run_at).toBe('2026-08-29T11:30:00.000Z');
  });
});

describe('pickMostActive', () => {
  it('is the agent with the most runs in the window', () => {
    const rows = buildRows(
      input({
        agents: [agent('a1', 'A'), agent('a2', 'B')],
        cells: [cell({ agentId: 'a1', runs: 3 }), cell({ agentId: 'a2', runs: 9 })],
        findings: [],
      }),
    );
    expect(pickMostActive(rows)?.agent_id).toBe('a2');
    expect(pickMostActive(rows)?.runs).toBe(9);
  });

  it('breaks a tie on the later last run, then on the name', () => {
    const rows = buildRows(
      input({
        agents: [agent('a1', 'Zeta'), agent('a2', 'Alpha')],
        cells: [
          cell({ agentId: 'a1', runs: 5, lastRunAt: new Date('2026-08-29T10:00:00Z') }),
          cell({ agentId: 'a2', runs: 5, lastRunAt: new Date('2026-08-29T11:00:00Z') }),
        ],
        findings: [],
      }),
    );
    expect(pickMostActive(rows)?.agent_name).toBe('Alpha');

    const sameInstant = new Date('2026-08-29T10:00:00Z');
    const tied = buildRows(
      input({
        agents: [agent('a1', 'Zeta'), agent('a2', 'Alpha')],
        cells: [
          cell({ agentId: 'a1', runs: 5, lastRunAt: sameInstant }),
          cell({ agentId: 'a2', runs: 5, lastRunAt: sameInstant }),
        ],
        findings: [],
      }),
    );
    expect(pickMostActive(tied)?.agent_name).toBe('Alpha');
  });

  it('is null when nothing ran, and ignores agents that did not run', () => {
    expect(pickMostActive(buildRows(input({ cells: [], findings: [] })))).toBeNull();
  });

  it('is null when every run in the window belongs to a deleted agent', () => {
    const rows = buildRows(input({ cells: [cell({ agentId: null })], findings: [] }));
    expect(pickMostActive(rows)).toBeNull();
  });
});

describe('cost breakdown', () => {
  const cells = [
    cell({ agentId: 'a1', model: 'gpt-4.1', costMicros: 5_680_000, runs: 2, runsWithCost: 2 }),
    cell({ agentId: 'a2', model: 'gpt-4o', costMicros: 4_350_000, runs: 3, runsWithCost: 3 }),
    cell({ agentId: 'a2', model: 'gpt-4.1', costMicros: 720_000, runs: 1, runsWithCost: 1 }),
  ];
  const rows = buildRows(
    input({ agents: [agent('a1', 'Security'), agent('a2', 'Performance')], cells, findings: [] }),
  );

  it('both donuts add up to exactly the same total', () => {
    const byAgent = costByAgent(cells, rows).reduce((n, s) => n + s.value, 0);
    const byModel = costByModel(cells).reduce((n, s) => n + s.value, 0);
    expect(byAgent.toFixed(6)).toBe(byModel.toFixed(6));
    expect(byAgent.toFixed(6)).toBe('10.750000');
  });

  it('keeps a deleted agent as its own segment instead of hiding its cost', () => {
    const withOrphan = [...cells, cell({ agentId: null, costMicros: 1_000_000 })];
    const segments = costByAgent(withOrphan, rows);
    const orphan = segments.find((s) => s.agent_id === null)!;
    expect(orphan.value).toBe(1);
    expect(orphan.label).toBe('');
    expect(segments.reduce((n, s) => n + s.value, 0).toFixed(6)).toBe('11.750000');
  });

  it('names a run with no model as its own segment rather than dropping it', () => {
    const segments = costByModel([...cells, cell({ model: null, costMicros: 250_000 })]);
    expect(segments.find((s) => s.label === '')?.value).toBe(0.25);
  });

  it('leaves out an agent whose runs cost nothing measurable', () => {
    const free = costByAgent([cell({ agentId: 'a1', costMicros: 0, runsWithCost: 0 })], rows);
    expect(free).toEqual([]);
  });
});

describe('buildAgentPerf', () => {
  it('reports a workspace-wide accept rate with the denominator beside it', () => {
    const perf = buildAgentPerf(
      input({
        agents: [agent('a1', 'A'), agent('a2', 'B')],
        cells: [cell({ agentId: 'a1' }), cell({ agentId: 'a2' })],
        findings: [
          found({ agentId: 'a1', findings: 10, accepted: 8, dismissed: 2 }),
          found({ agentId: 'a2', findings: 10, accepted: 2, dismissed: 8 }),
        ],
      }),
    );
    expect(perf.summary.accepted).toBe(10);
    expect(perf.summary.dismissed).toBe(10);
    expect(perf.summary.judged).toBe(20);
    expect(perf.summary.avg_accept_rate).toBe(0.5);
  });

  it('counts a deleted agent’s runs in the total and says how many they were', () => {
    const perf = buildAgentPerf(
      input({ cells: [cell({ agentId: 'a1', runs: 4 }), cell({ agentId: null, runs: 2 })] }),
    );
    expect(perf.summary.runs).toBe(6);
    expect(perf.summary.runs_without_agent).toBe(2);
    expect(perf.agents.reduce((n, r) => n + r.runs, 0)).toBe(4);
  });

  it('reports no total cost at all when nothing in the window recorded one', () => {
    const perf = buildAgentPerf(
      input({ cells: [cell({ runsWithCost: 0, costMicros: 0 })], prevCostMicros: null }),
    );
    expect(perf.summary.total_cost_usd).toBeNull();
    expect(perf.summary.prev_total_cost_usd).toBeNull();
    expect(perf.summary.runs_without_cost).toBe(1);
  });

  it('says every cost is an estimate and serves the ranking threshold', () => {
    const perf = buildAgentPerf(input());
    expect(perf.cost_basis).toBe('estimated');
    expect(perf.min_decisions_for_rank).toBe(MIN_DECISIONS_FOR_RANK);
  });

  it('keeps the by-agent donut equal to the total tile', () => {
    const perf = buildAgentPerf(
      input({
        agents: [agent('a1', 'A'), agent('a2', 'B')],
        cells: [
          cell({ agentId: 'a1', costMicros: 1 }),
          cell({ agentId: 'a2', costMicros: 2 }),
          cell({ agentId: 'a1', model: 'gpt-4.1', costMicros: 7 }),
        ],
      }),
    );
    const donut = perf.cost_by_agent.reduce((n, s) => n + s.value, 0);
    expect(donut.toFixed(9)).toBe(perf.summary.total_cost_usd!.toFixed(9));
  });
});
