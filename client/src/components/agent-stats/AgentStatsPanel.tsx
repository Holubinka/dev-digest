/* AgentStatsPanel — one agent's numbers in full.

   TWO screens mount this: the Agent Performance table when a row is expanded,
   and the agent editor's Stats tab. That is not a convenience — SPEC-07 AC-46
   requires the two to agree, and the server already guarantees the numbers are
   one computation (`GET /agents/:id/stats` takes its row out of the dashboard).
   One component is the other half of that guarantee: there is no second place
   where a denominator could be rounded differently.

   It renders what it is given and fetches nothing. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, SeverityBadge } from "@devdigest/ui";
import { formatCost } from "@/components/run-cost-badge/format";
import { formatSeconds } from "@/components/run-trace-drawer/helpers";
import type { AgentPerfRow } from "@/lib/types";
import { NO_DATA, formatRate } from "./format";
import { s } from "./styles";

export function AgentStatsPanel({
  row,
  minDecisions,
}: {
  row: AgentPerfRow;
  /** The decision count below which the rate is shown but not ranked (AC-29, AC-30). */
  minDecisions: number;
}) {
  const t = useTranslations("agentPerformance");

  return (
    <div style={s.panel}>
      <div style={s.block}>
        <span style={s.blockLabel}>{t("detail.findings")}</span>
        <span style={s.strong}>{row.findings_total}</span>
        <span style={s.line}>
          {t("detail.accepted")}: {row.accepted} · {t("detail.dismissed")}: {row.dismissed}
        </span>
        {/* Pending findings are outside the accept-rate denominator, and saying
            so is the difference between "41% of findings were rejected" and
            "41% of the DECIDED findings were accepted". */}
        <span style={s.line}>
          {t("detail.pending")}: {row.pending}
        </span>
      </div>

      <div style={s.block}>
        <span style={s.blockLabel}>{t("table.accept")}</span>
        <span style={s.strong}>
          {formatRate(row.accept_rate)}{" "}
          <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>
            {t("table.acceptOf", { accepted: row.accepted, judged: row.judged })}
          </span>
        </span>
        {row.low_sample && (
          <Badge color="var(--warn)">
            {t("table.lowSampleTitle", { min: minDecisions })}
          </Badge>
        )}
      </div>

      <div style={s.block}>
        <span style={s.blockLabel}>{t("detail.severity")}</span>
        <div style={s.sev}>
          <SeverityBadge severity="CRITICAL" count={row.findings_by_severity.CRITICAL} />
          <SeverityBadge severity="WARNING" count={row.findings_by_severity.WARNING} />
          <SeverityBadge severity="SUGGESTION" count={row.findings_by_severity.SUGGESTION} />
        </div>
      </div>

      <div style={s.block}>
        <span style={s.blockLabel}>{t("detail.cost")}</span>
        {/* The total is a floor whenever a counted run recorded no cost, and the
            caption says over how many runs it was actually measured (AC-15). */}
        <span style={s.strong}>
          {row.runs_with_cost === 0
            ? NO_DATA
            : t("detail.costOf", {
                total: formatCost(row.total_cost_usd),
                counted: row.runs_with_cost,
                runs: row.runs,
              })}
        </span>
        <span style={s.line}>
          {t("table.avgDuration")}:{" "}
          {row.avg_duration_ms == null ? NO_DATA : formatSeconds(row.avg_duration_ms)}
        </span>
        <span style={s.line}>
          {t("detail.model")}: {row.model ?? NO_DATA}
        </span>
      </div>

      <p style={s.note}>{t("cost.estimated")}</p>
    </div>
  );
}
