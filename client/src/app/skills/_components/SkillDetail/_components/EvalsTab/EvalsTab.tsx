/* EvalsTab (skill) — the reciprocal of the agent's own Evals tab: every case,
   across every agent, whose LATEST run had this skill active (D4). A case
   that never ran, or whose latest run dropped this skill, is not "affected"
   and is correctly absent — this is not "agents bound to this skill", it is
   "cases this skill actually shaped". */
"use client";

import React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Badge, ErrorState, Icon, Skeleton } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import type { SkillEvalCaseRow } from "@/lib/types";
import { useSkillEvalCases } from "@/lib/hooks/eval";
import { s } from "./styles";

export function EvalsTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  const { data: set, isLoading, isError, refetch } = useSkillEvalCases(skill.id);

  if (isError) return <ErrorState body={t("evals.loadError")} onRetry={() => void refetch()} />;
  if (isLoading || !set) {
    return (
      <div style={s.wrap}>
        <Skeleton height={80} />
      </div>
    );
  }

  return (
    <div style={s.wrap}>
      <div style={s.head}>
        <h2 style={s.h2}>{t("evals.heading")}</h2>
        {set.total > 0 && (
          <Badge color="var(--ok)">
            {t("evals.passingBadge", { passing: set.passing, total: set.total })}
          </Badge>
        )}
      </div>
      <p style={s.hint}>{t("evals.hint")}</p>

      {set.cases.length === 0 ? (
        <div style={s.empty}>
          {t("evals.empty")}
          <div style={s.emptyHint}>{t("evals.emptyHint")}</div>
        </div>
      ) : (
        <div style={s.list}>
          {set.cases.map((row) => (
            <CaseRow key={row.id} row={row} />
          ))}
        </div>
      )}
    </div>
  );
}

function CaseRow({ row }: { row: SkillEvalCaseRow }) {
  const t = useTranslations("skills");
  const passed = row.last_run?.pass === true;
  const Mark = passed ? Icon.CheckCircle : Icon.XCircle;
  const markColor = passed ? "var(--ok)" : "var(--crit)";
  const markLabel = passed ? t("evals.passed") : t("evals.failed");

  return (
    <Link href={`/agents/${row.owner_id}?tab=evals&case=${row.id}`} style={s.row}>
      <Mark size={16} style={{ color: markColor, flexShrink: 0 }} aria-label={markLabel} />
      <div style={s.rowMain}>
        <div style={s.nameLine}>
          <span className="mono" style={s.name}>
            {row.name}
          </span>
          <Badge color="var(--text-muted)" mono>
            {row.agent_name}
          </Badge>
        </div>
        <div style={s.sub}>
          {t("evals.expectedGot", {
            expected: row.expected_count,
            got: row.last_run?.findings_count ?? 0,
          })}
        </div>
      </div>
      <Icon.ChevronRight size={16} style={s.chevron} />
    </Link>
  );
}
