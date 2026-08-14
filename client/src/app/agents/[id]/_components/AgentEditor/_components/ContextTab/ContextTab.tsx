/* ContextTab — the project-context documents this agent sends, for the ACTIVE
   repository.

   The set is scoped by repository and swaps wholesale when the active one
   changes: the query key carries the repo id, so switching refetches rather than
   showing the previous repository's attachments. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@devdigest/ui";
import type { Agent } from "@devdigest/shared";
import { BudgetFooter, ContextDocList } from "@/components/context-docs";
import { InheritedGroup } from "./_components/InheritedGroup";
import { useContextDocs } from "@/lib/hooks";
import { useAgentContextDocs, useSetAgentContextDocs } from "@/lib/hooks/context";
import { useActiveRepo } from "@/lib/repo-context";
import { s } from "@/components/context-docs/styles";

export function ContextTab({ agent }: { agent: Agent }) {
  const t = useTranslations("context");
  const { repoId } = useActiveRepo();
  const page = useContextDocs(repoId);
  const docs = useAgentContextDocs(agent.id, repoId);
  const save = useSetAgentContextDocs();

  if (!repoId) {
    return (
      <div style={s.wrap}>
        <p style={s.empty}>{t("attach.noRepo")}</p>
      </div>
    );
  }

  const scanned = page.data?.documents ?? [];
  const attached = docs.data?.attached ?? [];
  const inherited = docs.data?.inherited ?? [];
  const commit = (paths: string[]) => save.mutate({ agentId: agent.id, repoId, paths });

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <h2 style={s.h2}>{t("attach.title")}</h2>
        {/* N counts THIS agent's own attachments — inherited documents have
            their own counter below, because merging the two makes it impossible
            to see what unchecking a box would actually remove. */}
        <Badge color="var(--accent)">
          {t("attach.attachedCount", { count: attached.length, total: scanned.length })}
        </Badge>
      </div>

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

      <InheritedGroup repoId={repoId} inherited={inherited} />

      <BudgetFooter
        attached={attached}
        inherited={inherited}
        budgetTokens={page.data?.budget_tokens ?? 0}
        strategy={agent.strategy}
      />
    </div>
  );
}
