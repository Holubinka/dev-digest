/* hooks/performance.ts — Agent Performance: the global dashboard and the
   per-agent Stats tab (SPEC-07).

   Both are READS of rows that already exist. There is no mutation in this file,
   and that is the point: nothing this screen offers can start a review or reach
   a model (AC-43). */
"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import type { AgentPerf, AgentPerfDetail, PerfRange } from "../types";

/** The window a screen is asking for. `from`/`to` are ISO and only used by `custom`. */
export interface PerfPeriodQuery {
  range: PerfRange;
  from?: string;
  to?: string;
}

/**
 * The query string, and the query KEY.
 *
 * One function for both so a period can never be fetched under a key that
 * describes a different window — which is how a screen ends up showing 30 days of
 * numbers under a "1 day" caption after a fast toggle.
 */
export function perfQueryString(period: PerfPeriodQuery): string {
  const params = new URLSearchParams({ range: period.range });
  if (period.range === "custom" && period.from && period.to) {
    params.set("from", period.from);
    params.set("to", period.to);
  }
  return params.toString();
}

/** Whether the period is complete enough to ask the server about. */
export function isPeriodReady(period: PerfPeriodQuery): boolean {
  return period.range !== "custom" || (!!period.from && !!period.to && period.from < period.to);
}

export function useAgentPerformance(period: PerfPeriodQuery) {
  const query = perfQueryString(period);
  return useQuery({
    queryKey: ["agent-performance", query],
    queryFn: () => api.get<AgentPerf>(`/agents/performance?${query}`),
    enabled: isPeriodReady(period),
  });
}

export function useAgentPerfDetail(agentId: string | null | undefined, period: PerfPeriodQuery) {
  const query = perfQueryString(period);
  return useQuery({
    queryKey: ["agent-perf-detail", agentId, query],
    queryFn: () => api.get<AgentPerfDetail>(`/agents/${agentId}/stats?${query}`),
    enabled: !!agentId && isPeriodReady(period),
  });
}
