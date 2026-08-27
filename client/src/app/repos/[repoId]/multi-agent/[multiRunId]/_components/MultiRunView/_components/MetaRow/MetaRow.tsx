/* MetaRow — what this comparison is and what it cost (AC-40, AC-41, AC-42).

   The execution sentence is written from `MultiAgentRun.concurrency`, never from
   a word — and from THAT run's number, not from the published default Configure
   run shows (AC-143, AC-144). The two screens describe different tenses on
   purpose: one what a run will get, this one what a run had. The mockup says
   `fan-out via worktrees` and there is no `git worktree` anywhere in
   `modules/reviews` (D9); the older translation said `via p-queue`, which is a
   real dependency of this server used by the job runner and the repo-intel
   pipeline, and never by a review.

   THE TIME IS NOT DERIVED FROM THE COLUMNS and the caption is not a constant.
   The server sends the multi-run's own measured span together with what that
   number IS (`total_duration_kind`), and the three readings are three different
   claims: a finished span (AC-41), the time gone so far while a run is still
   going (AC-156), and nothing at all for a multi-run whose completion was never
   recorded because the process died (AC-158). Printing "total" over any of the
   other two is the defect D28 removed, one level up. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { MultiAgentRun } from "@devdigest/shared";
import { formatCost, NO_DATA } from "@/components/run-cost-badge";
import { formatSeconds } from "@/components/run-trace-drawer/helpers";
import { s } from "../../styles";

export function MetaRow({ multiRun }: { multiRun: MultiAgentRun }) {
  const t = useTranslations("runs");
  const cost = formatCost(multiRun.total_cost_usd);

  return (
    <div style={s.metaRow}>
      {multiRun.pr_number != null && (
        <span className="mono" style={s.metaNumber}>
          #{multiRun.pr_number}
        </span>
      )}
      <span style={s.metaTitle}>{multiRun.pr_title}</span>
      <span
        style={s.metaRight}
        title={multiRun.total_cost_partial ? t("page.costPartialHint") : undefined}
      >
        <Icon.Cpu size={14} style={s.metaIcon} />
        {t("page.meta", {
          count: multiRun.agent_count,
          concurrency: multiRun.concurrency,
          durationKind: multiRun.total_duration_kind,
          duration:
            multiRun.total_duration_ms != null
              ? formatSeconds(multiRun.total_duration_ms)
              : NO_DATA,
          /* AC-42: at least one run reported no cost, so the number is a floor.
             `≥` is the mark, and the title says what it means — printing the sum
             plainly would claim a total that nobody measured. */
          cost: multiRun.total_cost_partial ? t("page.costPartial", { cost }) : cost,
        })}
      </span>
    </div>
  );
}
