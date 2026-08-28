/* EvalsTab — this agent's regression harness inside the editor: the four
   figures with their deltas and a link to the full dashboard (AC-66), then the
   case set with the `N / M passing` badge (AC-17), one row per case carrying
   the three-state last-run indicator (AC-14) and expected-vs-got counts
   (AC-15), and the case editor modal on top.

   `?case=` is read here, not in the tab bar: «Turn into eval case» on a PR
   finding navigates to `/agents/:id?tab=evals&case=<id>`, and landing on the
   case it just made is the whole of AC-10's second half. */
"use client";

import React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Badge, Button, ErrorState, Icon, IconBtn, MetricCard } from "@devdigest/ui";
import type { Agent } from "@devdigest/shared";
import type { EvalCaseRow } from "@/lib/types";
import {
  useDeleteEvalCase,
  useEvalAgentDashboard,
  useEvalCaseSet,
  useRunEvalCase,
  useRunEvalSet,
} from "@/lib/hooks/eval";
import { EvalCaseEditorModal } from "./_components/EvalCaseEditorModal";
import { lastRunState, pct } from "./helpers";
import { s } from "./styles";

/** `null` = closed, `"new"` = the empty editor, anything else = that case id. */
type EditorTarget = string | "new" | null;

export function EvalsTab({ agent }: { agent: Agent }) {
  const t = useTranslations("eval");
  const router = useRouter();
  const search = useSearchParams();

  const setQuery = useEvalCaseSet(agent.id);
  const dash = useEvalAgentDashboard(agent.id);
  const runSet = useRunEvalSet(agent.id);
  const runCase = useRunEvalCase(agent.id);
  const del = useDeleteEvalCase(agent.id);

  // A case id in the URL is where the editor opens; closing it clears the
  // param, so a refresh does not reopen a modal the reader dismissed.
  const requestedCase = search.get("case");
  const [editor, setEditor] = React.useState<EditorTarget>(null);
  const target: EditorTarget = editor ?? requestedCase;

  const closeEditor = () => {
    setEditor(null);
    if (requestedCase) {
      const sp = new URLSearchParams(search.toString());
      sp.delete("case");
      router.replace(`/agents/${agent.id}?${sp.toString()}`);
    }
  };

  const set = setQuery.data;
  const dashboard = dash.data?.dashboard;
  const batches = dash.data?.batches ?? [];
  // AC-56: a delta is the difference of two batches, so below two there is no
  // delta to show — and MetricCard draws nothing when `delta` is undefined.
  const deltas = batches.length >= 2 ? dashboard?.delta : undefined;
  const trend = dashboard?.trend ?? [];

  return (
    <div style={s.wrap}>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 14 }}>
        <Icon.Gauge size={14} style={{ color: "var(--text-muted)", marginRight: 10 }} />
        <span
          style={{
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: "0.07em",
            textTransform: "uppercase",
            color: "var(--text-muted)",
          }}
        >
          {t("evalsTab.metricsTitle")}
        </span>
        <Link href={`/evals/${agent.id}`} style={{ ...s.dashboardLink, marginLeft: "auto" }}>
          {t("evalsTab.viewFullDashboard")}
        </Link>
      </div>

      {/* `flex-wrap` for this row lives in `app/globals.css` under
          `.dd-eval-metric-row`, never in `styles.ts` — an inline style beats a
          media query, and four 32px numbers in one row overflow below 1024px. */}
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
        <MetricCard
          label={t("evalsTab.tracesPassed")}
          value={`${dashboard?.current.traces_passed ?? 0}/${dashboard?.current.traces_total ?? 0}`}
        />
      </div>

      <div style={s.casesHead}>
        <h2 style={s.h2}>{t("evalsTab.casesHeading")}</h2>
        {set && (
          <Badge color="var(--ok)">
            {t("evalsTab.passingBadge", { passing: set.passing, total: set.total })}
          </Badge>
        )}
        <div style={s.headActions}>
          <Button
            kind="ghost"
            size="sm"
            icon="Play"
            // AC-35: while the batch runs, the screen that launched it says so
            // and will not start the same set again. The request is synchronous
            // for the batch's whole duration, so `isPending` IS that state.
            disabled={runSet.isPending || (set?.total ?? 0) === 0}
            loading={runSet.isPending}
            onClick={() => runSet.mutate()}
          >
            {runSet.isPending ? t("evalsTab.runningSet") : t("evalsTab.runAll")}
          </Button>
          <Button kind="primary" size="sm" icon="Plus" onClick={() => setEditor("new")}>
            {t("evalsTab.newEvalCase")}
          </Button>
        </div>
      </div>

      {setQuery.isError ? (
        <ErrorState body={t("evalsTab.loadError")} onRetry={() => void setQuery.refetch()} />
      ) : setQuery.isLoading ? (
        <div style={s.loading}>{t("evalsTab.loadingCases")}</div>
      ) : (set?.cases.length ?? 0) === 0 ? (
        /* AC-16: an empty set explains how to make the first one instead of
           rendering nothing. */
        <div style={s.empty}>
          {t("evalsTab.emptyCases")}
          <div style={s.emptyHint}>{t("evalsTab.emptyHint")}</div>
        </div>
      ) : (
        <div style={s.list}>
          {set!.cases.map((row) => (
            <CaseRow
              key={row.id}
              row={row}
              running={runCase.isPending && runCase.variables === row.id}
              busy={runSet.isPending}
              onRun={() => runCase.mutate(row.id)}
              onEdit={() => setEditor(row.id)}
              onDelete={() => {
                if (window.confirm(t("evalsTab.deleteConfirm", { name: row.name })))
                  del.mutate(row.id);
              }}
            />
          ))}
        </div>
      )}

      {target && (
        <EvalCaseEditorModal
          agentId={agent.id}
          agentName={agent.name}
          caseId={target === "new" ? null : target}
          onClose={closeEditor}
        />
      )}
    </div>
  );
}

/**
 * The three states of AC-14, each with its own mark AND its own accessible
 * name: colour alone is not a state, and the icon is the only thing in the row
 * that carries "passed" for a case whose sub-line says "expected 1, got 1".
 * `labelKey` is spelled out per state rather than interpolated from the state
 * name — `never` and `neverRun` differ, and a template would have produced a
 * missing key that renders as the key itself.
 */
const STATE_ICON = {
  passed: { icon: Icon.CheckCircle, color: "var(--ok)", labelKey: "evalsTab.passed" },
  failed: { icon: Icon.XCircle, color: "var(--crit)", labelKey: "evalsTab.failed" },
  never: { icon: Icon.Dot, color: "var(--text-muted)", labelKey: "evalsTab.neverRun" },
} as const;

function CaseRow({
  row,
  running,
  busy,
  onRun,
  onEdit,
  onDelete,
}: {
  row: EvalCaseRow;
  running: boolean;
  busy: boolean;
  onRun: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations("eval");
  const state = lastRunState(row);
  const { icon: Mark, color, labelKey } = STATE_ICON[state];

  return (
    <div style={s.row}>
      <Mark size={16} style={{ color, flexShrink: 0 }} aria-label={t(labelKey)} />
      <div style={s.rowMain}>
        <div className="mono" style={s.name}>
          {row.name}
        </div>
        <div style={s.sub}>
          {row.last_run
            ? t("evalsTab.expectedGot", {
                expected: row.expected_count,
                got: row.last_run.findings_count,
              })
            : t("evalsTab.neverRun")}
        </div>
        {/* D4: skill binding does not bump the agent version, so this is the
            only place a reader sees which skills actually shaped this run —
            without it, a pass/fail swing after a skill toggle looks like
            unexplained model noise. */}
        {row.last_run && row.last_run.skills.length > 0 && (
          <div style={s.sub} className="mono">
            {t("evalsTab.skillsUsed", { names: row.last_run.skills.map((sk) => sk.name).join(", ") })}
          </div>
        )}
      </div>
      {/* The mockup tags each row with the expectation's severity and category
          (`CRITICAL · security`). `EvalCaseRow` carries neither — only
          `expected_count` — so the row states the count instead, and the empty
          set keeps the mockup's own `empty []` wording. */}
      <Badge color={row.expected_count === 0 ? "var(--text-muted)" : "var(--text-secondary)"} mono>
        {row.expected_count === 0
          ? t("evalsTab.emptyExpectations")
          : t("evalsTab.expectations", { count: row.expected_count })}
      </Badge>
      <div style={s.rowActions}>
        <IconBtn
          icon={running ? "RefreshCw" : "Play"}
          label={t("evalsTab.runCase", { name: row.name })}
          onClick={busy || running ? undefined : onRun}
        />
        <IconBtn icon="Edit" label={t("evalsTab.editCase", { name: row.name })} onClick={onEdit} />
        <IconBtn
          icon="Trash"
          danger
          label={t("evalsTab.deleteCase", { name: row.name })}
          onClick={onDelete}
        />
      </div>
    </div>
  );
}
