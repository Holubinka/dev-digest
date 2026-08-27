/* TabsView — one agent at a time: the tab bar, that agent's header, and its
   findings in the promoted `FindingCard` (AC-54…AC-63).

   `repoFullName` and `headSha` ARE passed, and the card builds the same
   github.com blob link the PR page's finding list builds. That reverses this
   feature's original no-link rule: the human lifted `SPEC-05 § Untrusted inputs`
   for this page on 2026-08-26, after using it, because a finding you cannot open
   is a finding you have to go and find by hand.

   The path is still a model-written string and is still treated as hostile —
   `githubBlobUrl` refuses a `..` segment anywhere, encodes every segment and
   takes the host from a constant, so no reference can steer a reader off
   github.com. What survives is a link to a file that does not exist, which is a
   404 rather than a way in.

   `headSha` is the MULTI-RUN's, handed down from `MultiRunView`. Taking the PR's
   would be the commit-pinned-link defect `client/INSIGHTS.md` records, in its
   quiet form: the right file at a line that has since moved.

   Accept and Dismiss go through the existing finding-action endpoint, and the
   response carries `accepted_at` / `dismissed_at`, which is what makes the new
   state visible without a second request (AC-61, AC-63). `onActed` re-reads the
   multi-run so the card the reader is looking at shows what was just recorded. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { CircularScore, MonoLink } from "@devdigest/ui";
import type { AgentColumn } from "@devdigest/shared";
import { AgentMonogram } from "@/components/agent-monogram";
import { FindingCard } from "@/components/finding-card";
import { NO_DATA } from "@/components/run-cost-badge";
import { agentColor } from "@/lib/agent-color";
import { useFindingAction } from "@/lib/hooks/reviews";
import { agentKey, durationCostLabel } from "../../helpers";
import { FindingActions } from "../FindingActions";
import { s } from "../../styles";

export function TabsView({
  columns,
  selected,
  prId,
  prStatus,
  headMoved,
  repoFullName,
  headSha,
  onSelect,
  onOpenTrace,
  onActed,
}: {
  columns: AgentColumn[];
  selected: AgentColumn | null;
  prId: string;
  prStatus: string | null;
  headMoved: boolean;
  /** `owner/repo`, for the link into the code. Null until the repo list loads. */
  repoFullName: string | null;
  /** The multi-run's head, NOT the PR's — see `fileRefHref`. */
  headSha: string | null;
  onSelect: (runId: string) => void;
  onOpenTrace: (runId: string) => void;
  onActed: () => void;
}) {
  const t = useTranslations("runs");
  const action = useFindingAction();
  const color = selected ? agentColor(agentKey(selected)) : "var(--border)";

  return (
    <div style={s.tabsWrap}>
      <div style={s.tabBar}>
        {columns.map((c) => {
          const on = selected?.run_id === c.run_id;
          return (
            <button
              key={c.run_id}
              type="button"
              style={s.tab(on, agentColor(agentKey(c)))}
              onClick={() => onSelect(c.run_id)}
            >
              <AgentMonogram agentId={agentKey(c)} name={c.agent_name} size={20} />
              <span style={s.tabName(on)}>{c.agent_name}</span>
              <span className="tnum" style={s.tabScore}>
                {c.score ?? NO_DATA}
              </span>
            </button>
          );
        })}
      </div>

      {selected && (
        <div className="dd-page" style={s.tabBody}>
          <div style={s.agentHead(color)}>
            {selected.score != null ? (
              <CircularScore score={selected.score} size={44} />
            ) : (
              <span style={s.noScore}>{NO_DATA}</span>
            )}
            <div style={s.agentHeadMain}>
              <div style={s.agentHeadName(color)}>{selected.agent_name}</div>
              {/* AC-56: a run with no summary renders the header WITHOUT the
                  line, rather than with an empty one. */}
              {selected.summary && <p style={s.agentSummary}>{selected.summary}</p>}
              {selected.error && <p style={s.agentError}>{selected.error}</p>}
            </div>
            <div style={s.agentHeadRight}>
              <MonoLink onClick={() => onOpenTrace(selected.run_id)}>{t("viewTrace")}</MonoLink>
              <span className="mono tnum" style={s.agentHeadMeta}>
                {durationCostLabel(selected.duration_ms, selected.cost_usd)}
              </span>
            </div>
          </div>

          <div style={s.findingList}>
            {selected.findings.length === 0 ? (
              <span style={s.columnEmpty}>{t("column.noFindings")}</span>
            ) : (
              selected.findings.map((f, i) => (
                <FindingCard
                  key={f.id}
                  f={f}
                  defaultExpanded={i === 0}
                  pending={action.isPending}
                  repoFullName={repoFullName}
                  headSha={headSha}
                  onAction={(act) =>
                    action.mutate({ findingId: f.id, action: act, prId }, { onSuccess: onActed })
                  }
                  extraActions={
                    <FindingActions
                      finding={f}
                      prId={prId}
                      prStatus={prStatus}
                      headMoved={headMoved}
                    />
                  }
                />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
