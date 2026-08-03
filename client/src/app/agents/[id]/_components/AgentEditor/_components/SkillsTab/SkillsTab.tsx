/* SkillsTab — bind, unbind and order the skills this agent sends to the model.
   All three are one request: POST /agents/:id/skills replaces the whole ordered
   set, so there is no separate unlink route to keep in step. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Checkbox, Icon, SectionLabel } from "@devdigest/ui";
import type { Agent, SkillListItem } from "@devdigest/shared";
import { useAgentSkills, useSetAgentSkills } from "../../../../../../../lib/hooks/agents";
import { useSkills } from "../../../../../../../lib/hooks/skills";
import { TYPE_COLORS } from "../../../../../../skills/_components/SkillCard/constants";
import { moveAt, partitionSkills, toggleId } from "./helpers";
import { s } from "./styles";

export function SkillsTab({ agent }: { agent: Agent }) {
  const t = useTranslations("agents");
  const ts = useTranslations("skills");
  const { data: skills } = useSkills();
  const { data: links } = useAgentSkills(agent.id);
  const setSkills = useSetAgentSkills();
  const [filter, setFilter] = React.useState("");
  const [dragging, setDragging] = React.useState<number | null>(null);

  const { linked, unlinked } = partitionSkills(skills ?? [], links ?? []);
  const linkedIds = linked.map((sk) => sk.id);
  const commit = (skillIds: string[]) => setSkills.mutate({ agentId: agent.id, skillIds });

  const matches = (sk: SkillListItem) =>
    filter.trim() === "" || sk.name.toLowerCase().includes(filter.trim().toLowerCase());

  const reorder = (from: number, to: number) => {
    if (to < 0 || to >= linkedIds.length) return;
    commit(moveAt(linkedIds, from, to));
  };

  const typeBadge = (sk: SkillListItem) => (
    <Badge color={TYPE_COLORS[sk.type]}>{ts(`listItem.type.${sk.type}`)}</Badge>
  );

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <h2 style={s.h2}>{t("skills.title")}</h2>
        <Badge color="var(--accent)">
          {t("skills.enabledCount", { linked: linked.length, total: (skills ?? []).length })}
        </Badge>
        <div style={s.filter}>
          <Icon.Search size={13} style={{ color: "var(--text-muted)" }} />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t("skills.filterPlaceholder")}
            aria-label={t("skills.filterPlaceholder")}
            style={s.filterInput}
          />
        </div>
      </div>

      <p style={s.hint}>{t("skills.orderHint")}</p>

      {(skills ?? []).length === 0 && <p style={s.empty}>{t("skills.empty")}</p>}

      {(skills ?? []).length > 0 && (
        <>
          <SectionLabel>{t("skills.linkedHeading")}</SectionLabel>
          {linked.length === 0 && <p style={s.empty}>{t("skills.noneBound")}</p>}
          {linked.filter(matches).map((sk) => {
            const index = linkedIds.indexOf(sk.id);
            return (
              <div
                key={sk.id}
                draggable
                onDragStart={() => setDragging(index)}
                onDragEnd={() => setDragging(null)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragging !== null) reorder(dragging, index);
                  setDragging(null);
                }}
                style={s.row(dragging === index)}
              >
                <Icon.Menu size={14} style={s.handle} />
                <Checkbox checked onChange={() => commit(toggleId(linkedIds, sk.id))} />
                <span className="mono" style={s.name}>
                  {sk.name}
                </span>
                {!sk.enabled && (
                  <Badge color="var(--warn)">{t("skills.globallyDisabled")}</Badge>
                )}
                <div style={s.spacer}>
                  {typeBadge(sk)}
                  <button
                    onClick={() => reorder(index, index - 1)}
                    disabled={index === 0}
                    aria-label={t("skills.moveUp")}
                    style={s.arrow(index === 0)}
                  >
                    <Icon.ArrowUp size={13} />
                  </button>
                  <button
                    onClick={() => reorder(index, index + 1)}
                    disabled={index === linkedIds.length - 1}
                    aria-label={t("skills.moveDown")}
                    style={s.arrow(index === linkedIds.length - 1)}
                  >
                    <Icon.ArrowDown size={13} />
                  </button>
                </div>
              </div>
            );
          })}

          <SectionLabel>{t("skills.availableHeading")}</SectionLabel>
          {unlinked.length === 0 && <p style={s.empty}>{t("skills.noneAvailable")}</p>}
          {unlinked.filter(matches).map((sk) => (
            <div key={sk.id} style={s.row(false)}>
              <Checkbox
                checked={false}
                onChange={() => commit(toggleId(linkedIds, sk.id))}
              />
              <span className="mono" style={s.name}>
                {sk.name}
              </span>
              <div style={s.spacer}>{typeBadge(sk)}</div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
