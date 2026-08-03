/* SkillCard — one skill in the left column: type, provenance, how many agents
   bind it, and the global enable toggle. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, Badge, Toggle } from "@devdigest/ui";
import type { SkillListItem } from "@devdigest/shared";
import { useDeleteSkill } from "../../../../lib/hooks/skills";
import { SOURCE_ICONS, TYPE_COLORS } from "./constants";
import { s } from "./styles";

export function SkillCard({
  sk,
  active,
  onClick,
  onToggle,
}: {
  sk: SkillListItem;
  active?: boolean;
  onClick?: () => void;
  onToggle?: (enabled: boolean) => void;
}) {
  const t = useTranslations("skills");
  const del = useDeleteSkill();

  return (
    <div onClick={onClick} style={s.card(!!active, sk.enabled)}>
      <div style={s.headerRow}>
        <div style={s.iconBox}>
          <Icon.Sparkles size={15} />
        </div>
        <span className="mono" style={s.name}>
          {sk.name}
        </span>
        {onToggle && (
          <div
            onClick={(e) => e.stopPropagation()}
            title={sk.injection.length > 0 ? t("injection.cannotEnable") : undefined}
          >
            <Toggle
              on={sk.enabled && sk.injection.length === 0}
              onChange={(next) => sk.injection.length === 0 && onToggle(next)}
              size={14}
            />
          </div>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (window.confirm(t("page.deleteConfirm", { name: sk.name }))) del.mutate(sk.id);
          }}
          disabled={del.isPending}
          title={t("page.delete")}
          aria-label={t("page.delete")}
          style={s.iconButton(del.isPending)}
        >
          <Icon.Trash size={14} />
        </button>
      </div>

      <div style={s.description}>{sk.description}</div>

      <div style={s.metaRow}>
        <Badge color={TYPE_COLORS[sk.type]}>{t(`listItem.type.${sk.type}`)}</Badge>
        <Badge color="var(--text-muted)" icon={SOURCE_ICONS[sk.source]}>
          {t(`listItem.source.${sk.source}`)}
        </Badge>
        {sk.injection.length > 0 && (
          <Badge color="var(--crit)" icon="AlertTriangle">
            {t("injection.badge")}
          </Badge>
        )}
        <span style={s.agents}>{t("page.agentCount", { count: sk.agent_count })}</span>
      </div>
    </div>
  );
}
