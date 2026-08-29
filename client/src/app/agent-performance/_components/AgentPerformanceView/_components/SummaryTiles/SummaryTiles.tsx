/* SummaryTiles — the four cards across the top of Agent Performance.

   Every caption under a number exists because the number alone would overstate
   what is known: the accept rate carries its denominator (AC-17), the cost
   carries how many runs recorded none (AC-15) and how many belonged to an agent
   that is gone (AC-34), and the most-active card carries the run count that
   earned it the title (AC-20). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { CircularScore, Icon, MetricCard } from "@devdigest/ui";
import { NO_DATA, formatRate, periodShort } from "@/components/agent-stats";
import { formatCost } from "@/components/run-cost-badge/format";
import { agentColor } from "@/lib/agent-color";
import type { AgentPerf } from "@/lib/types";
import { s } from "./styles";

export function SummaryTiles({ perf }: { perf: AgentPerf }) {
  const t = useTranslations("agentPerformance");
  const { summary } = perf;
  const period = periodShort(perf.period.kind);
  const active = summary.most_active_agent;

  // Only a delta that compares two real numbers is drawn. A window with no
  // recorded cost is not "$0.00 last month", and an arrow against it would be a
  // change nobody measured.
  const delta =
    summary.total_cost_usd != null && summary.prev_total_cost_usd != null
      ? summary.total_cost_usd - summary.prev_total_cost_usd
      : undefined;

  return (
    <>
      <div className="dd-perf-tiles" style={s.row}>
        <MetricCard
          label={t("summary.totalRuns", { period })}
          value={summary.runs}
          trend={summary.runs_trend.map((p) => p.value)}
        />
        <MetricCard
          label={t("summary.totalCost", { period })}
          value={summary.total_cost_usd == null ? NO_DATA : formatCost(summary.total_cost_usd)}
          {...(delta !== undefined ? { delta } : {})}
          deltaGood="down"
          deltaPrefix="$"
        />
        <MetricCard
          label={t("summary.avgAcceptRate")}
          value={formatRate(summary.avg_accept_rate)}
          corner={
            summary.avg_accept_rate == null ? null : (
              <CircularScore score={Math.round(summary.avg_accept_rate * 100)} size={38} />
            )
          }
        />
        <div style={s.card}>
          <span style={s.cardLabel}>{t("summary.mostActive")}</span>
          {active ? (
            <div style={s.agent}>
              <span style={{ ...s.swatch, background: `${agentColor(active.agent_id)}1f` }}>
                <Icon.Cpu size={15} style={{ color: agentColor(active.agent_id) }} />
              </span>
              <span>
                <div style={s.agentName}>{active.agent_name}</div>
                <div style={s.agentMeta}>
                  {active.accept_rate == null
                    ? t("summary.mostActiveNoAccept", { runs: active.runs })
                    : t("summary.mostActiveMeta", {
                        runs: active.runs,
                        accept: formatRate(active.accept_rate),
                      })}
                </div>
              </span>
            </div>
          ) : (
            <div style={s.none}>{t("summary.mostActiveNone")}</div>
          )}
        </div>
      </div>

      <p style={s.note}>
        {summary.judged === 0
          ? t("summary.noDecisions")
          : t("summary.decisions", { judged: summary.judged })}
        {summary.runs_without_cost > 0 &&
          ` · ${t("summary.uncosted", { count: summary.runs_without_cost })}`}
        {summary.runs_without_agent > 0 &&
          ` · ${t("summary.deletedAgentRuns", { count: summary.runs_without_agent })}`}
        {` · ${t("cost.estimatedShort")}`}
      </p>
    </>
  );
}
