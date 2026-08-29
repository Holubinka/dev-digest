/* StatsTab — one agent's runs, cost, duration and accept rate over a period.

   It mounts `AgentStatsPanel`, the component the Agent Performance table expands
   to, over `GET /agents/:id/stats` — which the server builds by taking the row
   out of the dashboard's own aggregation. Same numbers, same component, so
   SPEC-07 AC-46 holds by construction rather than by two screens agreeing to
   round the same way.

   It reads runs that already happened. Opening this tab starts nothing. */
"use client";

import React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { ErrorState, Skeleton } from "@devdigest/ui";
import type { Agent } from "@devdigest/shared";
import { AgentStatsPanel, NO_DATA, formatDay } from "@/components/agent-stats";
import { PeriodPicker, periodFromParams, periodToSearch } from "@/components/period-picker";
import { formatCost } from "@/components/run-cost-badge/format";
import { useAgentPerfDetail, type PerfPeriodQuery } from "@/lib/hooks/performance";
import { relativeTime } from "@/lib/relative-time";
import { s } from "./styles";

export function StatsTab({ agent }: { agent: Agent }) {
  const t = useTranslations("agentPerformance");
  const params = useSearchParams();
  // The period arrives in the URL when «View» on the dashboard opened this tab,
  // so the two screens are showing the same window when they are compared.
  const [period, setPeriod] = React.useState<PerfPeriodQuery>(() =>
    periodFromParams(new URLSearchParams(params.toString())),
  );
  const { data, isLoading, isError, refetch } = useAgentPerfDetail(agent.id, period);

  if (isError) return <ErrorState body={t("stats.loadError")} onRetry={() => void refetch()} />;

  return (
    <div style={s.wrap}>
      <div style={s.head}>
        <div>
          <h2 style={s.h2}>{t("stats.heading")}</h2>
          <p style={s.hint}>{t("stats.hint")}</p>
        </div>
        <PeriodPicker period={period} onChange={setPeriod} />
      </div>

      {/* A load draws no numbers at all — not a row of zeros that turn into
          something else a moment later (AC-38). */}
      {isLoading || !data ? (
        <div style={s.panel}>
          <Skeleton height={120} />
        </div>
      ) : (
        <>
          <div style={s.runs}>
            <div style={s.stat}>
              <span style={s.statLabel}>{t("table.runs", { period: periodCaption(data.period) })}</span>
              <span className="tnum" style={s.statValue}>
                {data.agent.runs}
              </span>
            </div>
            <div style={s.stat}>
              <span style={s.statLabel}>{t("table.avgCost")}</span>
              <span className="tnum" style={s.statValue}>
                {data.agent.avg_cost_usd == null ? NO_DATA : formatCost(data.agent.avg_cost_usd)}
              </span>
            </div>
            <div style={s.stat}>
              <span style={s.statLabel}>{t("table.lastRun")}</span>
              <span style={s.statValue}>
                {data.agent.last_run_at == null ? NO_DATA : relativeTime(data.agent.last_run_at)}
              </span>
            </div>
          </div>

          <div style={s.panel}>
            <AgentStatsPanel row={data.agent} minDecisions={data.min_decisions_for_rank} />
          </div>

          <Link href={`/agent-performance?${periodToSearch(period)}`} style={s.link}>
            {t("stats.openDashboard")}
          </Link>
        </>
      )}
    </div>
  );
}

/** The window's caption, from the answer rather than from local state. */
function periodCaption(period: { kind: string; from: string; to: string }): string {
  return period.kind === "custom"
    ? `${formatDay(period.from)}–${formatDay(period.to)}`
    : period.kind.toUpperCase();
}
