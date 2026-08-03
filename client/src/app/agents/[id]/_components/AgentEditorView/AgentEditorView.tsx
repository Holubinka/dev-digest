/* AgentEditorView — the agent list beside the editor, the shape /skills/:id
   also uses. Tab state lives in ?tab=. */
"use client";

import React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Badge, Button, Dropdown, ErrorState, Icon, Skeleton } from "@devdigest/ui";
import { AppShell } from "../../../../../components/app-shell";
import { AgentCard } from "../../../_components/AgentCard";
import { AgentEditor } from "../AgentEditor";
import { VALID_TABS } from "../AgentEditor/constants";
import { useAgents, useAgent, useUpdateAgent } from "../../../../../lib/hooks/agents";
import { ApiError } from "../../../../../lib/api";
import { s } from "./styles";

export function AgentEditorView({ id }: { id: string }) {
  const t = useTranslations("agents");
  const search = useSearchParams();
  const router = useRouter();

  const { data: agents } = useAgents();
  const { data: agent, isLoading, isError, error, refetch } = useAgent(id);
  const update = useUpdateAgent();

  const requested = search.get("tab") ?? "";
  const tab = VALID_TABS.includes(requested) ? requested : "config";
  const setTab = (next: string) => {
    const sp = new URLSearchParams(search.toString());
    sp.set("tab", next);
    router.replace(`/agents/${id}?${sp.toString()}`);
  };

  const crumb = [
    { label: t("list.breadcrumbLab") },
    { label: t("list.breadcrumb"), href: "/agents" },
    { label: agent?.name ?? t("editor.agentFallback") },
  ];

  if (isError || (!isLoading && !agent)) {
    return (
      <AppShell crumb={crumb}>
        <ErrorState
          fullScreen
          title={t("editor.loadErrorTitle")}
          body={error instanceof ApiError ? error.message : t("editor.loadErrorBody")}
          onRetry={() => refetch()}
        />
      </AppShell>
    );
  }

  return (
    <AppShell crumb={crumb}>
      <div style={s.shell}>
        <div style={s.column}>
          <div style={s.head}>
            <div style={s.titleRow}>
              <h1 style={s.h1}>{t("editor.listTitle")}</h1>
              <Dropdown
                width={210}
                align="right"
                trigger={
                  <Button kind="primary" size="sm" icon="Plus">
                    {t("editor.add")}
                  </Button>
                }
                items={[
                  {
                    label: t("editor.createFromScratch"),
                    icon: "Edit",
                    onClick: () => router.push("/agents"),
                  },
                ]}
              />
            </div>
          </div>
          <div style={s.scroll}>
            {(agents ?? []).map((a) => (
              <AgentCard
                key={a.id}
                ag={a}
                active={a.id === id}
                onClick={() => router.push(`/agents/${a.id}?tab=${tab}`)}
                onToggle={(enabled) => update.mutate({ id: a.id, patch: { enabled } })}
              />
            ))}
          </div>
        </div>

        {isLoading || !agent ? (
          <div style={s.loading}>
            <Skeleton height={24} width={240} />
            <Skeleton height={200} />
          </div>
        ) : (
          <div style={s.pane}>
            <div style={s.header}>
              <Icon.Cpu size={18} style={s.icon} />
              <h1 style={s.name}>{agent.name}</h1>
              <Badge color="var(--text-secondary)" mono>
                {agent.provider}/{agent.model}
              </Badge>
              {!agent.enabled && <Badge color="var(--text-muted)">{t("editor.disabled")}</Badge>}
              <div style={s.actions}>
                <Button
                  kind="secondary"
                  size="sm"
                  icon="GitPullRequest"
                  onClick={() => router.push("/")}
                >
                  {t("editor.runOnPr")}
                </Button>
              </div>
            </div>
            <div style={s.body}>
              <AgentEditor agent={agent} tab={tab} onTab={setTab} />
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
