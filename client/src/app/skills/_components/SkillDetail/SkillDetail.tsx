/* SkillDetail — the right-hand pane at /skills/:id. Header plus Config /
   Preview / Versions; tab state lives in ?tab= so a link keeps its place. */
"use client";

import React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Badge, ErrorState, Icon, Skeleton, Tabs, Toggle } from "@devdigest/ui";
import { SkillTypeBadge } from "@/components/skill-type";
import { useSkill, useUpdateSkill } from "@/lib/hooks/skills";
import { ConfigTab } from "./_components/ConfigTab";
import { ContextTab } from "./_components/ContextTab";
import { PreviewTab } from "./_components/PreviewTab";
import { StatsTab } from "./_components/StatsTab";
import { VersionsTab } from "./_components/VersionsTab";
import { TABS, VALID_TABS } from "./constants";
import { s } from "./styles";

export function SkillDetail({ id }: { id: string }) {
  const t = useTranslations("skills");
  const router = useRouter();
  const search = useSearchParams();
  const { data: skill, isLoading, isError, refetch } = useSkill(id);
  const update = useUpdateSkill();

  const requested = search.get("tab") ?? "";
  const tab = VALID_TABS.includes(requested) ? requested : "config";
  const setTab = (next: string) => router.replace(`/skills/${id}?tab=${next}`);
  const blocked = (skill?.injection.length ?? 0) > 0;

  if (isError) {
    return (
      <div style={s.pane}>
        <ErrorState body={t("detail.loadError")} onRetry={() => refetch()} />
      </div>
    );
  }

  if (isLoading || !skill) {
    return (
      <div style={s.loading}>
        <Skeleton height={24} width={240} />
        <Skeleton height={260} />
      </div>
    );
  }

  return (
    <div style={s.pane}>
      <div style={s.header}>
        <Icon.Sparkles size={18} style={s.icon} />
        <h1 className="mono" style={s.name}>
          {skill.name}
        </h1>
        <SkillTypeBadge type={skill.type} />
        <Badge color="var(--text-muted)" mono>
          {t("detail.version", { version: skill.version })}
        </Badge>
        {blocked && <Badge color="var(--crit)">{t("injection.badge")}</Badge>}
        {!blocked && !skill.enabled && (
          <Badge color="var(--warn)">{t("detail.disabledNote")}</Badge>
        )}
        <label style={s.enabledLabel} title={blocked ? t("injection.cannotEnable") : undefined}>
          {t("detail.enabled")}
          <Toggle
            on={skill.enabled && !blocked}
            onChange={(enabled) => {
              // The server refuses this too; refusing here as well means the
              // user is told why instead of watching a toggle spring back.
              if (blocked) return;
              update.mutate({ id: skill.id, patch: { enabled } });
            }}
            size={16}
          />
        </label>
      </div>

      {blocked && (
        <div style={s.injection}>
          <strong style={s.injectionTitle}>{t("injection.title")}</strong>
          <p style={s.injectionBody}>{t("injection.body")}</p>
          <ul style={s.injectionList}>
            {skill.injection.map((match) => (
              <li key={match.rule} style={s.injectionRow}>
                <span style={s.injectionReason}>{match.reason}</span>
                <span className="mono" style={s.injectionExcerpt}>
                  {match.excerpt}
                </span>
                <span style={s.injectionLine}>{t("injection.line", { line: match.line })}</span>
              </li>
            ))}
          </ul>
          <p style={s.injectionLimits}>{t("injection.limits")}</p>
        </div>
      )}

      <div style={s.tabsBar}>
        <Tabs
          tabs={TABS.map((tb) => ({ key: tb.key, label: t(tb.labelKey), icon: tb.icon }))}
          value={tab}
          onChange={setTab}
          pad="0 28px"
        />
      </div>

      <div style={s.body}>
        {tab === "preview" && <PreviewTab skill={skill} />}
        {tab === "context" && <ContextTab skill={skill} />}
        {tab === "stats" && <StatsTab skill={skill} />}
        {tab === "versions" && <VersionsTab skill={skill} />}
        {tab === "config" && <ConfigTab skill={skill} />}
      </div>
    </div>
  );
}
