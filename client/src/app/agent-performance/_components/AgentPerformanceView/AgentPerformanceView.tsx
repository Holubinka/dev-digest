/* AgentPerformanceView — the global Agent Performance screen (SPEC-07).

   It aggregates runs that already happened. There is no mutation on this page,
   no button that starts anything, and one request per period: reloading,
   sorting and expanding a row cannot spend a cent (AC-43, AC-44).

   The period lives in the URL so a link to this screen carries the window its
   numbers were counted over (AC-6). */
"use client";

import React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { EmptyState, ErrorState, Skeleton } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { formatDay } from "@/components/agent-stats";
import { PeriodPicker, periodFromParams, periodToSearch } from "@/components/period-picker";
import { useAgentPerformance, type PerfPeriodQuery } from "@/lib/hooks/performance";
import { AgentTable } from "./_components/AgentTable";
import { CostBreakdown } from "./_components/CostBreakdown";
import { SummaryTiles } from "./_components/SummaryTiles";
import { DEFAULT_SORT, SKELETON_ROWS, type SortState } from "./constants";
import { s } from "./styles";

export function AgentPerformanceView() {
  const t = useTranslations("agentPerformance");
  const router = useRouter();
  const params = useSearchParams();
  const period = periodFromParams(new URLSearchParams(params.toString()));
  const [sort, setSort] = React.useState<SortState>(DEFAULT_SORT);

  const { data, isLoading, isError, refetch } = useAgentPerformance(period);

  const setPeriod = (next: PerfPeriodQuery) => {
    router.replace(`/agent-performance?${periodToSearch(next)}`, { scroll: false });
  };

  return (
    <AppShell crumb={[{ label: t("crumb") }]}>
      <div className="dd-page" style={s.page}>
        <div className="dd-page-header" style={s.header}>
          <div>
            <h1 style={s.title}>{t("title")}</h1>
            <p style={s.subtitle}>{t("subtitle")}</p>
          </div>
          <PeriodPicker period={period} onChange={setPeriod} />
        </div>

        {/* A failure and a load both render NO numbers. A zero drawn while the
            answer is unknown is the one thing this screen must never do
            (AC-38, AC-39). */}
        {isError ? (
          <ErrorState body={t("loadError")} onRetry={() => void refetch()} />
        ) : isLoading || !data ? (
          <div style={s.skeletons}>
            <Skeleton height={110} />
            {Array.from({ length: SKELETON_ROWS }, (_, i) => (
              <Skeleton key={i} height={54} />
            ))}
          </div>
        ) : data.summary.runs === 0 && data.agents.length === 0 ? (
          <EmptyState
            icon="Cpu"
            title={t("empty.noAgentsTitle")}
            body={t("empty.noAgentsBody")}
            cta={t("empty.noAgentsCta")}
            onCta={() => router.push("/agents")}
          />
        ) : data.summary.runs === 0 ? (
          // A different state from the one above, and deliberately so: an empty
          // workspace and a quiet fortnight are different facts, and only the
          // second one is fixed by widening the period (AC-40, AC-41).
          <EmptyState
            icon="Activity"
            title={t("empty.noRunsTitle")}
            body={t("empty.noRunsBody", {
              count: data.agents.length,
              from: formatDay(data.period.from),
              to: formatDay(data.period.to),
            })}
          />
        ) : (
          <>
            <SummaryTiles perf={data} />
            <AgentTable perf={data} sort={sort} onSort={setSort} period={period} />
            <div style={s.section}>
              <CostBreakdown perf={data} />
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
