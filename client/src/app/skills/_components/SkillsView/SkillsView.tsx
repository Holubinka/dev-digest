/* SkillsView — the two-column Skills shell. /skills renders it with nothing
   selected; /skills/:id renders the same list with the detail pane beside it,
   which is the shape the Agents screen already uses. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { EmptyState } from "@devdigest/ui";
import type { DropdownItemDef } from "@devdigest/ui";
import { AppShell } from "../../../../components/app-shell";
import { useSkills } from "../../../../lib/hooks/skills";
import { CreateSkillModal } from "../CreateSkillModal";
import { SkillDetail } from "../SkillDetail";
import { SkillsList } from "../SkillsList";
import { s } from "./styles";

export function SkillsView({ selectedId }: { selectedId?: string }) {
  const t = useTranslations("skills");
  const router = useRouter();
  const [creating, setCreating] = React.useState(false);

  // Reuses the list query the left column already holds, so naming the
  // breadcrumb costs no extra request.
  const { data: skills } = useSkills();
  const selected = skills?.find((sk) => sk.id === selectedId);

  const menuItems: DropdownItemDef[] = [
    { label: t("page.menu.create"), icon: "Edit", onClick: () => setCreating(true) },
  ];

  const crumb = [
    { label: t("page.crumbLab") },
    { label: t("page.crumbSkills"), href: "/skills" },
    ...(selectedId ? [{ label: selected?.name ?? t("detail.crumbSkill") }] : []),
  ];

  return (
    <AppShell crumb={crumb}>
      {creating && <CreateSkillModal onClose={() => setCreating(false)} />}
      <div style={s.shell}>
        <SkillsList
          {...(selectedId ? { selectedId } : {})}
          onSelect={(id) => router.push(`/skills/${id}?tab=config`)}
          menuItems={menuItems}
          onEmptyCta={() => setCreating(true)}
        />
        {selectedId ? (
          <SkillDetail id={selectedId} />
        ) : (
          <div style={s.placeholder}>
            <EmptyState
              icon="Sparkles"
              title={t("page.selectPrompt.title")}
              body={t("page.selectPrompt.body")}
            />
          </div>
        )}
      </div>
    </AppShell>
  );
}
