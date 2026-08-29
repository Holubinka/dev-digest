/* AgentTable — one row per agent in the workspace, including the ones that did
   not run in this period (AC-22).

   NOTHING HERE FETCHES. Sorting reorders an array the page already has (AC-31),
   and expanding a row shows fields the same response already carried (AC-44) —
   which is what makes "reloading, sorting and expanding cost nothing" a property
   of the code rather than a claim in a README. */
"use client";

import React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Badge, Icon } from "@devdigest/ui";
import { AgentStatsPanel, NO_DATA, acceptTone, acceptTrend, formatRate, periodShort } from "@/components/agent-stats";
import { formatCost } from "@/components/run-cost-badge/format";
import { formatSeconds } from "@/components/run-trace-drawer/helpers";
import { periodToSearch } from "@/components/period-picker";
import { agentColor } from "@/lib/agent-color";
import { relativeTime } from "@/lib/relative-time";
import type { PerfPeriodQuery } from "@/lib/hooks/performance";
import type { AgentPerf, AgentPerfRow } from "@/lib/types";
import { SORT_COLUMNS, type SortKey, type SortState } from "../../constants";
import { nextSort, sortRows } from "../../helpers";
import { s } from "./styles";

export function AgentTable({
  perf,
  sort,
  onSort,
  period,
}: {
  perf: AgentPerf;
  sort: SortState;
  onSort: (next: SortState) => void;
  /** Carried into «View» so the Stats tab opens on the window this row counted. */
  period: PerfPeriodQuery;
}) {
  const t = useTranslations("agentPerformance");
  const [expanded, setExpanded] = React.useState<string | null>(null);
  const rows = sortRows(perf.agents, sort, perf.min_decisions_for_rank);
  const periodLabel = periodShort(perf.period.kind);

  return (
    <div style={s.scroller}>
      <div style={s.table}>
      {/* Plain elements, not ARIA grid roles: the other tables in this app use
          none (`ci-runs`, `evals`), and a half-applied `role="row"` without
          `role="table"` and `role="cell"` announces a structure that is not
          there. The sort state reaches a screen reader through each header
          button's own label instead. */}
      <div style={s.head}>
        {SORT_COLUMNS.map((col) => (
          <button
            key={col.key}
            type="button"
            style={{
              ...s.th,
              ...(col.numeric ? s.thNumeric : {}),
              ...(sort.key === col.key ? s.thActive : {}),
            }}
            aria-label={
              sort.key === col.key
                ? t(sort.dir === "asc" ? "table.sortedAsc" : "table.sortedDesc", {
                    column: t(col.labelKey, { period: periodLabel }),
                  })
                : t("table.sortBy", { column: t(col.labelKey, { period: periodLabel }) })
            }
            onClick={() => onSort(nextSort(sort, col.key as SortKey))}
          >
            {t(col.labelKey, { period: periodLabel })}
            {sort.key === col.key &&
              (sort.dir === "desc" ? <Icon.ArrowDown size={11} /> : <Icon.ArrowUp size={11} />)}
          </button>
        ))}
        <span />
      </div>

        {rows.map((row) => (
          <Row
            key={row.agent_id}
            row={row}
            period={period}
            minDecisions={perf.min_decisions_for_rank}
            open={expanded === row.agent_id}
            onToggle={() => setExpanded(expanded === row.agent_id ? null : row.agent_id)}
          />
        ))}
      </div>
    </div>
  );
}

function Row({
  row,
  period,
  minDecisions,
  open,
  onToggle,
}: {
  row: AgentPerfRow;
  period: PerfPeriodQuery;
  minDecisions: number;
  open: boolean;
  onToggle: () => void;
}) {
  const t = useTranslations("agentPerformance");
  const color = agentColor(row.agent_id);
  const trend = acceptTrend(row);

  return (
    <div>
      <div style={s.row}>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-label={t(open ? "table.collapse" : "table.expand", { name: row.agent_name })}
          style={{ ...s.agentCell, background: "none", border: "none", padding: 0, cursor: "pointer", font: "inherit", color: "inherit" }}
        >
          <span style={{ ...s.swatch, background: `${color}1f` }}>
            <Icon.Cpu size={14} style={{ color }} />
          </span>
          <span style={s.name}>{row.agent_name}</span>
        </button>

        <span className="tnum" style={s.num}>
          {row.runs}
        </span>
        {/* An agent that did not run has no average cost. `—` and not `$0.00`,
            which would read as "this agent is free" (AC-23). */}
        <span className="tnum" style={s.num}>
          {row.avg_cost_usd == null ? NO_DATA : formatCost(row.avg_cost_usd)}
        </span>
        <span className="tnum" style={s.num}>
          {row.avg_duration_ms == null ? NO_DATA : formatSeconds(row.avg_duration_ms)}
        </span>

        <span style={s.accept}>
          <span className="tnum" style={{ fontSize: 13.5, fontWeight: 600, color: acceptTone(row.accept_rate) }}>
            {formatRate(row.accept_rate)}
          </span>
          {trend === "up" && <Icon.ArrowUp size={12} style={{ color: "var(--ok)" }} />}
          {trend === "down" && <Icon.ArrowDown size={12} style={{ color: "var(--crit)" }} />}
          {/* The denominator, always — a rate without one cannot be judged
              (AC-24), and it is what makes the small-sample badge legible. */}
          {row.judged > 0 && (
            <span className="tnum" style={s.acceptOf}>
              {t("table.acceptOf", { accepted: row.accepted, judged: row.judged })}
            </span>
          )}
          {row.judged > 0 && row.low_sample && (
            <Badge color="var(--warn)" style={{ fontSize: 10.5, padding: "1px 6px" }}>
              {t("table.lowSample")}
            </Badge>
          )}
        </span>

        <span style={s.muted}>{row.last_run_at == null ? NO_DATA : relativeTime(row.last_run_at)}</span>

        <Link
          href={`/agents/${row.agent_id}?tab=stats&${periodToSearch(period)}`}
          style={s.view}
          aria-label={t("table.viewAgent", { name: row.agent_name })}
        >
          {t("table.view")}
        </Link>
      </div>
      {open && <AgentStatsPanel row={row} minDecisions={minDecisions} />}
    </div>
  );
}
