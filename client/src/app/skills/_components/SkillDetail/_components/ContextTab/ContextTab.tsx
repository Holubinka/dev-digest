/* ContextTab — the project-context documents this skill contributes.

   Same editable list as the agent's tab; the inherited group is absent, because
   a skill inherits from nothing. What is here instead is the SERIALIZES AS
   block: the exact section header and the saved paths, in order, so a reader can
   see what binding this skill will actually add to a prompt. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { BudgetFooter, ContextDocList } from "@/components/context-docs";
import { s } from "@/components/context-docs/styles";
import { useContextDocs } from "@/lib/hooks";
import { useSetSkillContextDocs, useSkillContextDocs } from "@/lib/hooks/context";
import { useActiveRepo } from "@/lib/repo-context";

export function ContextTab({ skill }: { skill: Skill }) {
  const t = useTranslations("context");
  const { repoId } = useActiveRepo();
  const page = useContextDocs(repoId);
  const docs = useSkillContextDocs(skill.id, repoId);
  const save = useSetSkillContextDocs();

  if (!repoId) {
    return (
      <div style={s.wrap}>
        <p style={s.empty}>{t("attach.noRepo")}</p>
      </div>
    );
  }

  const scanned = page.data?.documents ?? [];
  const attached = docs.data?.attached ?? [];
  const ordered = [...attached].sort((a, b) => a.position - b.position);
  const commit = (paths: string[]) => save.mutate({ skillId: skill.id, repoId, paths });

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <h2 style={s.h2}>{t("attach.skillTitle")}</h2>
        <Badge color="var(--accent)">
          {t("attach.skillAttachedCount", { count: attached.length })}
        </Badge>
      </div>

      <p style={s.hint}>{t("attach.skillInherit")}</p>

      <ContextDocList
        repoId={repoId}
        scanned={scanned}
        attached={attached}
        disabled={save.isPending}
        onCommit={commit}
        failed={page.isError || docs.isError}
        onRetry={() => {
          void page.refetch();
          void docs.refetch();
        }}
      />

      {/* What the run actually assembles from this skill: the section heading
          and the paths, in saved order. The document TEXT is not shown — it
          lives in the clone, and a copy here would go stale on the next sync. */}
      <div style={s.serializes}>
        <h3 style={s.inheritedTitle}>{t("attach.serializesAs")}</h3>
        <pre className="mono" style={s.serializesPre}>
          {["## Project context", ...ordered.map((doc) => `### ${doc.path}`)].join("\n")}
        </pre>
      </div>

      <BudgetFooter attached={attached} budgetTokens={page.data?.budget_tokens ?? 0} />
    </div>
  );
}
