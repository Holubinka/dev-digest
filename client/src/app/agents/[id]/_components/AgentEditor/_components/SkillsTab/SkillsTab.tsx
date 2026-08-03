/* SkillsTab — every skill in the workspace as one ordered list, the way the
   design has it: the checkbox is the binding, the order is prompt order.
   Binding, unbinding and reordering are all one request — POST
   /agents/:id/skills replaces the whole ordered set. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Checkbox, ErrorState, Icon } from "@devdigest/ui";
import type { Agent, SkillListItem } from "@devdigest/shared";
import { SkillTypeBadge } from "@/components/skill-type";
import { useAgentSkills, useSetAgentSkills } from "@/lib/hooks/agents";
import { useSkills } from "@/lib/hooks/skills";
import { moveAt, partitionSkills, toggleId } from "./helpers";
import { s } from "./styles";

export function SkillsTab({ agent }: { agent: Agent }) {
  const t = useTranslations("agents");
  const skillsQuery = useSkills();
  const linksQuery = useAgentSkills(agent.id);
  const skills = skillsQuery.data;
  const links = linksQuery.data;
  const setSkills = useSetAgentSkills();
  const [filter, setFilter] = React.useState("");
  const [dragging, setDragging] = React.useState<string | null>(null);

  const failed = skillsQuery.isError || linksQuery.isError;
  const loading = skillsQuery.isLoading || linksQuery.isLoading;

  const { linked, unlinked } = partitionSkills(skills ?? [], links ?? []);
  const linkedIds = linked.map((sk) => sk.id);
  const commit = (skillIds: string[]) => setSkills.mutate({ agentId: agent.id, skillIds });

  // Bound first, in prompt order, then the rest — one list, as designed.
  const rows = [...linked, ...unlinked].filter(
    (sk) =>
      filter.trim() === "" || sk.name.toLowerCase().includes(filter.trim().toLowerCase()),
  );

  const reorder = (from: number, to: number) => {
    if (from < 0 || to < 0 || to >= linkedIds.length) return;
    commit(moveAt(linkedIds, from, to));
  };

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

      {/* An empty list and a failed request look identical once the data is
          defaulted to []. Saying "no skills yet" when the request failed sends
          the user to create one they already have, with no way to retry —
          `SkillsList` next door already distinguishes the two. */}
      {failed ? (
        <ErrorState
          body={t("skills.loadError")}
          onRetry={() => {
            void skillsQuery.refetch();
            void linksQuery.refetch();
          }}
        />
      ) : (
        (skills ?? []).length === 0 && !loading && <p style={s.empty}>{t("skills.empty")}</p>
      )}

      {rows.map((sk: SkillListItem) => {
        const index = linkedIds.indexOf(sk.id);
        const bound = index >= 0;
        const blocked = sk.injection.length > 0;
        return (
          <div
            key={sk.id}
            draggable={bound}
            onDragStart={() => setDragging(sk.id)}
            onDragEnd={() => setDragging(null)}
            onDragOver={(e) => bound && e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (dragging && bound) reorder(linkedIds.indexOf(dragging), index);
              setDragging(null);
            }}
            style={s.row(bound, dragging === sk.id)}
          >
            <Icon.Menu size={14} style={s.handle(bound)} />
            <Checkbox
              checked={bound}
              onChange={() => !blocked && commit(toggleId(linkedIds, sk.id))}
            />
            <span className="mono" style={s.name}>
              {sk.name}
            </span>

            {blocked && <Badge color="var(--crit)">{t("skills.injection")}</Badge>}
            {!blocked && bound && !sk.enabled && (
              <Badge color="var(--warn)">{t("skills.globallyDisabled")}</Badge>
            )}

            <div style={s.spacer}>
              {bound && (
                <>
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
                </>
              )}
              <SkillTypeBadge type={sk.type} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
