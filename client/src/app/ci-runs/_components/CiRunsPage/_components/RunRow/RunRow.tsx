/* One row of the CI Runs table — the eight values AC-79 names, and nothing the
   artifact could turn into markup (AC-77: every cell is text). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import { formatCost } from "@/components/run-cost-badge";
import type { CiRun } from "@/lib/types";
import { s } from "./styles";

export function RunRow({ run }: { run: CiRun }) {
  const t = useTranslations("ci");
  const none = t("runs.none");

  return (
    <div style={s.row}>
      <span className="mono" style={s.repo} title={run.repo ?? undefined}>
        {run.repo || none}
      </span>
      <span className="mono tnum" style={s.cell}>
        {run.pr_number == null ? none : t("runs.prNumber", { number: run.pr_number })}
      </span>
      <span style={s.cell} title={run.agent ?? undefined}>
        {run.agent || none}
      </span>
      {/* AC-113: the REVIEW verdict, which is not the run's own state. A run
          that was skipped or failed reaches this cell with nothing in it. */}
      <span style={s.cell}>{run.verdict ? t(`runs.verdict.${run.verdict}`) : none}</span>
      <span className="tnum" style={s.num}>
        {run.findings_count ?? none}
      </span>
      {/* AC-80: `formatCost` is the one place that decides "—" vs "$0.0000", so
          a null cost and a genuinely free run stay different everywhere. */}
      <span className="tnum" style={s.num}>
        {formatCost(run.cost_usd)}
      </span>
      <span className="tnum" style={s.num}>
        {run.duration_s == null
          ? none
          : t("runs.durationSeconds", { seconds: Math.round(run.duration_s) })}
      </span>
      <span style={s.jobCell}>
        {run.github_url ? (
          // AC-81. `noopener noreferrer` on a URL that leaves the app for
          // github.com — the row is built from an artifact somebody else wrote.
          <a href={run.github_url} target="_blank" rel="noopener noreferrer" style={s.link}>
            <Icon.ExternalLink size={13} />
            {t("runs.view")}
          </a>
        ) : (
          none
        )}
      </span>
    </div>
  );
}
