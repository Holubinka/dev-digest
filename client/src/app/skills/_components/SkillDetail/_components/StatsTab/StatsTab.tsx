/* StatsTab — what the skill has actually done, counted from real rows.
   Nothing here is estimated: a skill nobody has bound reports zeros rather
   than a plausible-looking rate. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { ErrorState, Skeleton } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { useSkillStats } from "../../../../../../lib/hooks/skills";
import { s } from "./styles";

export function StatsTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  const { data: stats, isLoading, isError, refetch } = useSkillStats(skill.id);

  if (isError) return <ErrorState body={t("stats.loadError")} onRetry={() => refetch()} />;
  if (isLoading || !stats) {
    return (
      <div style={s.wrap}>
        <Skeleton height={110} />
      </div>
    );
  }

  const tiles: Array<{ label: string; value: React.ReactNode }> = [
    { label: t("stats.agents"), value: stats.agents },
    { label: t("stats.runs"), value: stats.runs },
    { label: t("stats.findings"), value: stats.findings },
    { label: t("stats.accepted"), value: stats.accepted },
    { label: t("stats.dismissed"), value: stats.dismissed },
    {
      label: t("stats.acceptRate"),
      value:
        stats.accept_rate === null ? (
          <span style={s.muted}>{t("stats.noRate")}</span>
        ) : (
          `${Math.round(stats.accept_rate * 100)}%`
        ),
    },
    { label: t("stats.bodyTokens"), value: t("stats.tokens", { count: stats.body_tokens }) },
  ];

  return (
    <div style={s.wrap}>
      <h2 style={s.h2}>{t("stats.heading")}</h2>
      <p style={s.hint}>{t("stats.hint")}</p>
      {stats.agents === 0 && <p style={s.empty}>{t("stats.unused")}</p>}
      <div style={s.grid}>
        {tiles.map((tile) => (
          <div key={tile.label} style={s.tile}>
            <div style={s.label}>{tile.label}</div>
            <div style={s.value}>{tile.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
