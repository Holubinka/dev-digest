/* SkillDetail — the right-hand pane at /skills/:id. Header plus Config /
   Preview / Versions; tab state lives in ?tab= so a link keeps its place. */
"use client";

import React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Badge, ErrorState, Icon, Skeleton, Tabs, Toggle } from "@devdigest/ui";
import { useSkill, useUpdateSkill } from "../../../../lib/hooks/skills";
import { TYPE_COLORS } from "../SkillCard/constants";
import { ConfigTab } from "./_components/ConfigTab";
import { PreviewTab } from "./_components/PreviewTab";
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
        <Badge color={TYPE_COLORS[skill.type]}>{t(`listItem.type.${skill.type}`)}</Badge>
        <Badge color="var(--text-muted)" mono>
          {t("detail.version", { version: skill.version })}
        </Badge>
        {!skill.enabled && <Badge color="var(--warn)">{t("detail.disabledNote")}</Badge>}
        <label style={s.enabledLabel}>
          {t("detail.enabled")}
          <Toggle
            on={skill.enabled}
            onChange={(enabled) => update.mutate({ id: skill.id, patch: { enabled } })}
            size={16}
          />
        </label>
      </div>

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
        {tab === "versions" && <VersionsTab skill={skill} />}
        {tab === "config" && <ConfigTab skill={skill} />}
      </div>
    </div>
  );
}
