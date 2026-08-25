/* EvalDashboardView — the all-agents Eval Dashboard: one card per agent that
   has cases (AC-53), and under them one row per batch across every agent
   (AC-54). «Run all agents» runs each set that has a case in it and names the
   ones it skipped (AC-37).

   The cards and the table read the SAME request: `GET /eval-dashboard` returns
   `{ cards, recent }` together, so the summary below can never disagree with
   the cards above it about which batch was last. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Badge, Button, ErrorState, Icon, SectionLabel, Skeleton, Sparkline } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import type { EvalBatchSummary, EvalDashboardCard } from "@/lib/types";
import { useEvalDashboardAll, useRunAllEvals } from "@/lib/hooks/eval";
import { MetricBar } from "../MetricBar";
import { formatRanAt, pct } from "../format";
import { s } from "./styles";

export function EvalDashboardView() {
  const t = useTranslations("eval");
  const router = useRouter();
  const { data, isLoading, isError, refetch } = useEvalDashboardAll();
  const runAll = useRunAllEvals();

  const crumb = [
    { label: t("page.crumbSkillsLab") },
    { label: t("page.crumbEvalDashboard") },
  ];

  const cards = data?.cards ?? [];
  const recent = data?.recent ?? [];

  return (
    <AppShell crumb={crumb}>
      <div className="dd-page">
        <div className="dd-page-header" style={s.header}>
          <div>
            <h1 style={s.h1}>{t("dashboard.defaultTitle")}</h1>
            <p style={s.subtitle}>{t("dashboard.subtitle")}</p>
          </div>
          <div style={s.headActions}>
            <Button
              kind="primary"
              icon="Play"
              disabled={runAll.isPending || cards.length === 0}
              loading={runAll.isPending}
              onClick={() => runAll.mutate()}
            >
              {runAll.isPending ? t("dashboard.running") : t("dashboard.runAllAgents")}
            </Button>
          </div>
        </div>

        {/* AC-37: the agents that did NOT run are the half a reader cannot see
            from the results, so they are named rather than counted. */}
        {runAll.data && (
          <div role="status" style={s.skipped}>
            {runAll.data.skipped.length === 0
              ? t("dashboard.skippedNone")
              : t("dashboard.skipped", {
                  names: runAll.data.skipped.map((x) => x.agent_name).join(", "),
                })}
          </div>
        )}

        {isError ? (
          <ErrorState body={t("dashboard.loadError")} onRetry={() => void refetch()} />
        ) : isLoading ? (
          <div style={s.cards}>
            <Skeleton height={78} />
            <Skeleton height={78} />
          </div>
        ) : cards.length === 0 ? (
          <div style={s.empty}>{t("dashboard.noAgents")}</div>
        ) : (
          <>
            <SectionLabel icon="Cpu">{t("dashboard.agentsSection")}</SectionLabel>
            <div style={s.cards}>
              {cards.map((card) => (
                <AgentCardRow
                  key={card.agent_id}
                  card={card}
                  onOpen={() => router.push(`/evals/${card.agent_id}`)}
                />
              ))}
            </div>

            <SectionLabel icon="History">{t("dashboard.recentAllAgents")}</SectionLabel>
            {recent.length === 0 ? (
              <div style={s.empty}>{t("dashboard.noRuns")}</div>
            ) : (
              <div style={s.table}>
                {recent.map((b, i) => (
                  <BatchRow key={b.batch_id} batch={b} first={i === 0} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}

function AgentCardRow({ card, onOpen }: { card: EvalDashboardCard; onOpen: () => void }) {
  const t = useTranslations("eval");
  const latest = card.latest;
  return (
    <button
      type="button"
      className="dd-eval-agent-card"
      style={s.card}
      // Without this the button's accessible name is the whole card read out
      // as one run-on string — name, model, date, and six numbers.
      aria-label={t("dashboard.openAgent", { name: card.agent_name })}
      onClick={onOpen}
    >
      <div style={s.cardIcon}>
        <Icon.Cpu size={18} />
      </div>
      <div style={s.cardMain}>
        <div style={s.cardTitleRow}>
          <span style={s.cardName}>{card.agent_name}</span>
          <Badge color="var(--text-secondary)" mono>
            {card.model}
          </Badge>
        </div>
        <div style={s.cardSub}>
          {/* An agent with cases but no completed batch is a real state — the
              card says so rather than printing "Last run v0 · 0/0 pass". */}
          {latest
            ? t("dashboard.lastRun", {
                version: latest.agent_version,
                ranAt: formatRanAt(latest.ran_at),
                passed: latest.passed,
                cases: latest.cases,
              })
            : t("dashboard.neverRunAgent", { cases: card.cases_total })}
        </div>
      </div>
      <div style={s.cardRight}>
        {card.trend.length > 1 && (
          <Sparkline data={card.trend.map((p) => p.recall)} color="var(--accent)" />
        )}
        <div style={s.stat}>
          <div style={s.statLabel}>{t("dashboard.metricsShort.recall")}</div>
          <div className="tnum" style={s.statValue("var(--accent)")}>
            {pct(latest?.recall)}%
          </div>
        </div>
        <div style={s.stat}>
          <div style={s.statLabel}>{t("dashboard.metricsShort.precision")}</div>
          <div className="tnum" style={s.statValue("var(--ok)")}>
            {pct(latest?.precision)}%
          </div>
        </div>
        <div style={s.stat}>
          <div style={s.statLabel}>{t("dashboard.metricsShort.citation")}</div>
          <div className="tnum" style={s.statValue("var(--warn)")}>
            {pct(latest?.citation_accuracy)}%
          </div>
        </div>
        <Icon.ChevronRight size={16} style={{ color: "var(--text-muted)" }} />
      </div>
    </button>
  );
}

function BatchRow({ batch, first }: { batch: EvalBatchSummary; first: boolean }) {
  const t = useTranslations("eval");
  return (
    <div style={first ? s.trFirst : s.tr}>
      <span style={s.cellAgent}>{batch.agent_name}</span>
      <span className="mono" style={s.cellMono}>
        {formatRanAt(batch.ran_at)}
      </span>
      <span className="mono" style={s.cellVersion}>
        v{batch.agent_version}
      </span>
      <MetricBar value={batch.recall} color="var(--accent)" label={t("dashboard.table.recall")} />
      <MetricBar value={batch.precision} color="var(--ok)" label={t("dashboard.table.precision")} />
      <MetricBar
        value={batch.citation_accuracy}
        color="var(--warn)"
        label={t("dashboard.table.citation")}
      />
      <span className="tnum" style={s.cellPass}>
        {batch.passed}/{batch.cases}
      </span>
    </div>
  );
}
