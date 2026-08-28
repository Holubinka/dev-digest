/* EvalAgentView — one agent's regression history: three metric cards with the
   delta to the previous batch, the trend chart and the batch table with a cost
   column (AC-55); no deltas and no banner below two completed batches (AC-56);
   the server-generated banner above them when there are two or more (AC-57);
   a date range that bounds the chart and the table alike (AC-58); and row
   selection that enables Compare at exactly two (AC-59).

   Two kinds of state, on purpose (spec § Module interactions):
     · the date range is URL state — it is what someone shares or bookmarks,
       and a reload must land on the same window of history;
     · the two selected batch ids are SCREEN state — a half-made selection is
       not worth a URL, and restoring one on reload would re-open a comparison
       nobody asked for. */
"use client";

import React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Badge,
  Button,
  Checkbox,
  Dropdown,
  ErrorState,
  Icon,
  LineChart,
  MetricCard,
  SectionLabel,
  Skeleton,
} from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { formatCost } from "@/components/run-cost-badge";
import type { EvalBatchSummary } from "@/lib/types";
import { useAgent, useAgents } from "@/lib/hooks/agents";
import { useEvalAgentDashboard, useRunEvalSet } from "@/lib/hooks/eval";
import { CompareRunsModal } from "../CompareRunsModal";
import { MetricBar } from "../../../_components/MetricBar";
import { formatRanAt, pct, RANGES, readRange, rangeToQuery } from "../../../_components/format";
import { s } from "./styles";

export function EvalAgentView({ agentId }: { agentId: string }) {
  const t = useTranslations("eval");
  const router = useRouter();
  const search = useSearchParams();

  const range = readRange(search.get("range"));
  // The window is recomputed per render from the range key rather than held in
  // state: a `useState(new Date())` would freeze "the last 30 days" at whenever
  // the component happened to mount.
  const query = React.useMemo(() => rangeToQuery(range), [range]);

  const agent = useAgent(agentId);
  const agents = useAgents();
  const dash = useEvalAgentDashboard(agentId, query);
  const runSet = useRunEvalSet(agentId);

  const [selected, setSelected] = React.useState<string[]>([]);
  const [comparing, setComparing] = React.useState<[string, string] | null>(null);

  const dashboard = dash.data?.dashboard;
  const batches = dash.data?.batches ?? [];
  // AC-56: a delta and a banner both need two batches to exist at all.
  const comparable = batches.length >= 2;
  const deltas = comparable ? dashboard?.delta : undefined;
  const trend = dashboard?.trend ?? [];

  const setRange = (next: string) => {
    const sp = new URLSearchParams(search.toString());
    sp.set("range", next);
    router.replace(`/evals/${agentId}?${sp.toString()}`);
    // A batch selected in one window may not exist in the next, and a Compare
    // built from an id the table no longer shows is a comparison nobody can see.
    setSelected([]);
  };

  const toggle = (batchId: string) =>
    setSelected((prev) =>
      prev.includes(batchId) ? prev.filter((x) => x !== batchId) : [...prev, batchId],
    );

  /** Older first, so the modal's `a → b` reads the direction time ran in. */
  const openCompare = () => {
    if (selected.length !== 2) return;
    const rows = batches.filter((b) => selected.includes(b.batch_id));
    const ordered = [...rows].sort((x, y) => x.ran_at.localeCompare(y.ran_at));
    if (ordered.length === 2) setComparing([ordered[0]!.batch_id, ordered[1]!.batch_id]);
  };

  const crumb = [
    { label: t("page.crumbSkillsLab") },
    { label: t("page.crumbEvalDashboard"), href: "/evals" },
    { label: agent.data?.name ?? t("page.crumbEvals") },
  ];

  if (dash.isError) {
    return (
      <AppShell crumb={crumb}>
        <div className="dd-page">
          <ErrorState
            fullScreen
            title={t("page.crumbEvalDashboard")}
            body={t("dashboard.loadError")}
            onRetry={() => void dash.refetch()}
          />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell crumb={crumb}>
      <div className="dd-page">
        <Link href="/evals" style={s.back}>
          <Icon.ChevronLeft size={15} />
          {t("dashboard.backToAll")}
        </Link>

        <div className="dd-page-header" style={s.header}>
          <div>
            <div style={s.titleRow}>
              <h1 style={s.h1}>{agent.data?.name ?? ""}</h1>
              {agent.data && (
                <Badge color="var(--text-secondary)" mono>
                  {agent.data.model}
                </Badge>
              )}
            </div>
            <p style={s.subtitle}>
              {t("dashboard.agentSubtitle", {
                runs: batches.length,
                cases: dashboard?.cases_total ?? 0,
              })}
            </p>
          </div>
          <div style={s.headActions}>
            <Dropdown
              width={220}
              align="right"
              trigger={
                <Button kind="secondary" size="sm" icon="Cpu" iconRight="ChevronDown">
                  {agent.data?.name ?? ""}
                </Button>
              }
              items={(agents.data ?? []).map((a) => ({
                label: a.name,
                icon: "Cpu" as const,
                onClick: () => router.push(`/evals/${a.id}`),
              }))}
            />
            <label style={s.rangeWrap}>
              <Icon.Calendar size={14} style={{ color: "var(--text-muted)" }} />
              <select
                aria-label={t("dashboard.range.label")}
                value={range}
                onChange={(e) => setRange(e.target.value)}
                style={s.rangeSelect}
              >
                {RANGES.map((r) => (
                  <option key={r.key} value={r.key}>
                    {t(r.labelKey)}
                  </option>
                ))}
              </select>
            </label>
            <Button
              kind="primary"
              size="sm"
              icon="Play"
              disabled={runSet.isPending || (dashboard?.cases_total ?? 0) === 0}
              loading={runSet.isPending}
              onClick={() => runSet.mutate()}
            >
              {runSet.isPending ? t("dashboard.running") : t("dashboard.runSet")}
            </Button>
          </div>
        </div>

        {/* AC-57: generated from the deltas in code on the server — no model
            call — and shown only where a delta exists to generate it from. */}
        {comparable && dashboard?.alert && (
          <div role="status" style={s.banner}>
            <Icon.AlertTriangle size={16} style={{ color: "var(--warn)", flexShrink: 0 }} />
            <span>{dashboard.alert}</span>
          </div>
        )}

        {dash.isLoading ? (
          <Skeleton height={120} />
        ) : (
          <>
            <div className="dd-eval-metric-row" style={s.metricRow}>
              <MetricCard
                label={t("dashboard.metrics.recall")}
                value={pct(dashboard?.current.recall)}
                suffix="%"
                delta={deltas?.recall}
                color="var(--accent)"
                trend={trend.length > 1 ? trend.map((p) => p.recall) : undefined}
              />
              <MetricCard
                label={t("dashboard.metrics.precision")}
                value={pct(dashboard?.current.precision)}
                suffix="%"
                delta={deltas?.precision}
                color="var(--ok)"
                trend={trend.length > 1 ? trend.map((p) => p.precision) : undefined}
              />
              <MetricCard
                label={t("dashboard.metrics.citationAccuracy")}
                value={pct(dashboard?.current.citation_accuracy)}
                suffix="%"
                delta={deltas?.citation_accuracy}
                color="var(--warn)"
                trend={trend.length > 1 ? trend.map((p) => p.citation_accuracy) : undefined}
              />
            </div>

            <div style={s.trendPanel}>
              <div style={s.trendHead}>
                <Icon.TrendingUp size={14} style={{ color: "var(--text-muted)" }} />
                <span style={{ ...s.selectedNote, fontWeight: 700, letterSpacing: "0.07em" }}>
                  {t("dashboard.metricTrend").toUpperCase()}
                </span>
                <div style={s.legend}>
                  <span style={s.legendItem}>
                    <span style={s.legendSwatch("var(--accent)")} />
                    {t("dashboard.legend.recall")}
                  </span>
                  <span style={s.legendItem}>
                    <span style={s.legendSwatch("var(--ok)")} />
                    {t("dashboard.legend.precision")}
                  </span>
                  <span style={s.legendItem}>
                    <span style={s.legendSwatch("var(--warn)")} />
                    {t("dashboard.legend.citation")}
                  </span>
                </div>
              </div>
              {trend.length === 0 ? (
                <div style={s.empty}>{t("dashboard.noRuns")}</div>
              ) : (
                <LineChart
                  w={1200}
                  series={[
                    {
                      name: t("dashboard.legend.recall"),
                      color: "var(--accent)",
                      data: trend.map((p) => p.recall),
                    },
                    {
                      name: t("dashboard.legend.precision"),
                      color: "var(--ok)",
                      data: trend.map((p) => p.precision),
                    },
                    {
                      name: t("dashboard.legend.citation"),
                      color: "var(--warn)",
                      data: trend.map((p) => p.citation_accuracy),
                    },
                  ]}
                />
              )}
            </div>

            <div style={s.runsHead}>
              <SectionLabel icon="History">{t("dashboard.recentRuns")}</SectionLabel>
              <span style={s.selectedNote}>
                {t("dashboard.selected", { count: selected.length })}
              </span>
              <div style={{ marginLeft: "auto" }}>
                <Button
                  kind="primary"
                  size="sm"
                  icon="Copy"
                  // AC-59: exactly two, and disabled at every other count —
                  // including three, where "the last two" would be a guess.
                  disabled={selected.length !== 2}
                  title={selected.length === 2 ? undefined : t("dashboard.compareHint")}
                  onClick={openCompare}
                >
                  {t("dashboard.compare")}
                </Button>
              </div>
            </div>

            {batches.length === 0 ? (
              <div style={s.empty}>{t("dashboard.noBatches")}</div>
            ) : (
              <div style={s.table}>
                <div style={{ ...s.grid, ...s.headRow }}>
                  <span />
                  <span style={s.th}>{t("dashboard.table.ranAt")}</span>
                  <span style={s.th}>{t("dashboard.table.version")}</span>
                  <span style={s.th}>{t("dashboard.table.recall")}</span>
                  <span style={s.th}>{t("dashboard.table.precision")}</span>
                  <span style={s.th}>{t("dashboard.table.citation")}</span>
                  <span style={s.th}>{t("dashboard.table.pass")}</span>
                  <span style={s.th}>{t("dashboard.table.cost")}</span>
                </div>
                {batches.map((b) => (
                  <BatchRow
                    key={b.batch_id}
                    batch={b}
                    checked={selected.includes(b.batch_id)}
                    onToggle={() => toggle(b.batch_id)}
                  />
                ))}
              </div>
            )}
          </>
        )}

        {comparing && (
          <CompareRunsModal
            agentId={agentId}
            batchA={comparing[0]}
            batchB={comparing[1]}
            onClose={() => setComparing(null)}
          />
        )}
      </div>
    </AppShell>
  );
}

function BatchRow({
  batch,
  checked,
  onToggle,
}: {
  batch: EvalBatchSummary;
  checked: boolean;
  onToggle: () => void;
}) {
  const t = useTranslations("eval");
  return (
    <div style={{ ...s.grid, ...s.bodyRow }}>
      {/* Named after the run it selects: six identical checkboxes otherwise, and
          "checkbox" is all a screen reader would have to go on. */}
      <Checkbox
        checked={checked}
        onChange={onToggle}
        label={
          <span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden" }}>
            {t("dashboard.selectRun", { ranAt: formatRanAt(batch.ran_at) })}
          </span>
        }
      />
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
      <span className="mono tnum" style={s.cellCost}>
        {formatCost(batch.cost_usd)}
      </span>
    </div>
  );
}
