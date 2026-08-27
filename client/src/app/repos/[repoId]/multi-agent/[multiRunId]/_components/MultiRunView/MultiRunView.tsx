/* MultiRunView — one multi-agent comparison: the meta row, Columns or Tabs, the
   disagreement section under both, and the trace drawer.

   THE ONLY COMPONENT HERE THAT OWNS DATA. One `useMultiAgentRun` read draws
   everything (AC-98), and the PR detail is fetched only for the two facts the
   reply flow needs: the PR's current status and its current head.

   FOUR THINGS LIVE IN THE URL — `?view`, `?agent`, `?conflicts`, `?trace`
   (AC-83…AC-86) — and they are written through ONE `setParams`. One
   `router.replace` per key races: each builds its params from the same captured
   `search`, so the last write wins and the others are lost
   (`client/INSIGHTS.md:585-592`).

   `?agent` carries the RUN id, not the agent id. `agent_id` is null once the
   agent is deleted (AC-118), so two deleted agents would give two tabs the same
   key — the same reason `ConflictTake.run_id` exists.

   NOTHING POLLS. The page reads on open and once more per run that reaches a
   terminal state, which is what `useMultiRunColumnEvents`' `onRunClosed` is for
   (AC-134, `§ Non-functional requirements`). A `refetchInterval` here would be
   ~24 requests over the 1 min 35 s a real multi-run takes.

   A FAILED REFETCH MUST NOT EMPTY THE SCREEN (AC-135). TanStack leaves the
   previous `data` in place, so the error branch below asks for `!multiRun`
   rather than `isError`: with data on screen the reader keeps the comparison and
   the not-final mark, and only a first load that fails becomes an error page. */
"use client";

import React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, ErrorState, Skeleton } from "@devdigest/ui";
import RunTraceDrawer from "@/components/run-trace-drawer";
import { AppShell } from "@/components/app-shell";
import { RepoNotFound } from "@/components/repo-not-found";
import { ApiError } from "@/lib/api";
import { usePullDetail } from "@/lib/hooks/core";
import {
  useMultiAgentRun,
  useMultiRunColumnEvents,
  useRerunMultiAgentRun,
} from "@/lib/hooks/multi-agent";
import { useActiveRepo, useRepoNotFound } from "@/lib/repo-context";
import { useToast } from "@/lib/toast";
import { isTerminal, liveColumns } from "./helpers";
import { ColumnsView } from "./_components/ColumnsView";
import { ConflictsSection } from "./_components/ConflictsSection";
import { MetaRow } from "./_components/MetaRow";
import { TabsView } from "./_components/TabsView";
import { s } from "./styles";

const VIEWS = ["columns", "tabs"] as const;
type ViewMode = (typeof VIEWS)[number];

export function MultiRunView({ repoId, multiRunId }: { repoId: string; multiRunId: string }) {
  const t = useTranslations("runs");
  const router = useRouter();
  const search = useSearchParams();
  const toast = useToast();
  const repoNotFound = useRepoNotFound(repoId);
  /* `owner/repo` for the links into the code. Context, not a new request: the
     repo list is already loaded for the switcher, and `pulls/[number]/page.tsx`
     builds its own github.com links from this same value. */
  const { activeRepo } = useActiveRepo();
  const repoFullName = activeRepo?.full_name ?? null;

  const { data: multiRun, isError, error, refetch } = useMultiAgentRun(multiRunId);
  const { data: pr } = usePullDetail(multiRun?.pr_id ?? null);
  const rerun = useRerunMultiAgentRun();

  /* `serverColumns` is the read; `columns` is the read plus what the sockets
     have said since. Everything below the streams uses `columns` and nothing
     uses `serverColumns` — one derivation, four consumers, so the header and the
     take cannot name a run's state differently (AC-125, `liveColumns`). */
  const serverColumns = React.useMemo(() => multiRun?.columns ?? [], [multiRun]);

  /* ONLY THE RUNS THAT ARE STILL GOING, and the hook opens at most four of their
     streams at a time (AC-145). A finished run has nothing left to send, and its
     stream would close the moment it opened — spending one of the six
     connections a browser gives this origin and refetching for nothing on every
     visit to an old comparison.

     Derived from the SERVER's columns on purpose: `liveColumns` needs `streams`,
     so reading it here would be a cycle — and it would change nothing, because
     the only promotion it makes is `queued → running` and both are non-terminal.

     The columns of the runs that have no stream yet are NOT second-class: they
     draw their state, time and cost from this same `multiRun` read (AC-148), and
     what a stream adds is the live line under the header and, once, the fact
     that the run took a slot. */
  const liveRunIds = React.useMemo(
    () => serverColumns.filter((c) => !isTerminal(c.status)).map((c) => c.run_id),
    [serverColumns],
  );

  /* The refetch is guarded by that run's CURRENT state, and it is also how a run
     that ended while nothing was listening is noticed: its terminal state comes
     back in this same read (AC-149). The callback is held in a ref inside the
     hook, so an inline arrow costs no re-subscription.

     Guarded on the SERVER's state, which is the same guard either way: the only
     thing the derivation changes is `queued → running`, and the test admits
     both. */
  const streams = useMultiRunColumnEvents(liveRunIds, (runId) => {
    const status = serverColumns.find((c) => c.run_id === runId)?.status;
    if (status === "queued" || status === "running") void refetch();
  });

  /* AC-78: a run that announced it took a slot reads `reviewing` from this
     moment, with no reload, no timer and NO EXTRA REQUEST — the fact arrived on
     a socket the page already holds. The NFR ceiling is untouched: still the
     open plus one recompute per run that reaches a terminal state. */
  const columns = React.useMemo(
    () => liveColumns(serverColumns, streams),
    [serverColumns, streams],
  );

  const view: ViewMode = search.get("view") === "tabs" ? "tabs" : "columns";
  const agentParam = search.get("agent");
  const onlyConflicts = search.get("conflicts") === "1";
  const traceRunId = search.get("trace");

  const setParams = (entries: Record<string, string | null>) => {
    const sp = new URLSearchParams(search.toString());
    for (const [key, val] of Object.entries(entries)) {
      if (val == null) sp.delete(key);
      else sp.set(key, val);
    }
    const qs = sp.toString();
    router.replace(
      `/repos/${repoId}/multi-agent/${encodeURIComponent(multiRunId)}${qs ? `?${qs}` : ""}`,
    );
  };

  const selectedColumn = columns.find((c) => c.run_id === agentParam) ?? columns[0] ?? null;
  const traceColumn = columns.find((c) => c.run_id === traceRunId) ?? null;

  const configureHref = multiRun
    ? `/repos/${repoId}/multi-agent/configure?pr=${encodeURIComponent(multiRun.pr_id)}`
    : `/repos/${repoId}/multi-agent/configure`;

  const runAgain = async () => {
    try {
      const created = await rerun.mutateAsync(multiRunId);
      // AC-117: the skipped agents are named. It has to be a toast rather than a
      // line on this page, because the next thing that happens is leaving it.
      if (created.skipped.length > 0) {
        toast.info(
          t("page.skipped", { names: created.skipped.map((sk) => sk.agent_name).join(", ") }),
        );
      }
      router.push(`/repos/${repoId}/multi-agent/${encodeURIComponent(created.id)}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("page.loadFailed.title"));
    }
  };

  const crumb = [
    { label: t("page.crumb"), href: `/repos/${repoId}/multi-agent` },
    ...(multiRun?.pr_number != null
      ? [{ label: `#${multiRun.pr_number}`, mono: true }]
      : [{ label: t("page.title") }]),
  ];

  if (repoNotFound) {
    return (
      <AppShell crumb={crumb}>
        <RepoNotFound />
      </AppShell>
    );
  }

  if (!multiRun && isError) {
    // AC-95: a multi-run of another workspace is indistinguishable from one that
    // does not exist, and both are a state of THIS page rather than an empty
    // comparison that looks like a run which produced nothing.
    const notFound = error instanceof ApiError && error.status === 404;
    return (
      <AppShell crumb={crumb}>
        <ErrorState
          fullScreen
          title={notFound ? t("page.notFound.title") : t("page.loadFailed.title")}
          body={
            notFound
              ? t("page.notFound.body")
              : error instanceof ApiError
                ? error.message
                : undefined
          }
          onRetry={notFound ? undefined : () => refetch()}
        />
      </AppShell>
    );
  }

  if (!multiRun) {
    return (
      <AppShell crumb={crumb}>
        <div className="dd-page" style={s.loading}>
          <Skeleton height={26} width={360} />
          <Skeleton height={240} />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell crumb={crumb}>
      <div style={s.header}>
        <Button kind="secondary" size="sm" icon="Settings" onClick={() => router.push(configureHref)}>
          {t("page.configureRun")}
        </Button>
        <h1 style={s.h1}>{t("page.title")}</h1>
        <span style={s.headerCount}>
          {t("page.selectedAgents", { count: multiRun.agent_count })}
        </span>
        <div style={s.headerRight}>
          <Button
            kind="ghost"
            size="sm"
            icon="RefreshCw"
            loading={rerun.isPending}
            onClick={runAgain}
          >
            {t("page.runAgain")}
          </Button>
          <div style={s.switch}>
            {VIEWS.map((mode) => (
              <button
                key={mode}
                type="button"
                style={s.switchBtn(view === mode)}
                onClick={() => setParams({ view: mode === "columns" ? null : mode })}
              >
                {t(`page.view.${mode}`)}
              </button>
            ))}
          </div>
        </div>
      </div>

      <MetaRow multiRun={multiRun} />

      {view === "columns" ? (
        <ColumnsView
          columns={columns}
          streams={streams}
          repoFullName={repoFullName}
          /* The tree the agents READ, never `pr.head_sha` — `fileRefHref` says
             why, and this is the only place either sha is in scope together. */
          headSha={multiRun.head_sha ?? null}
          onOpenTrace={(runId) => setParams({ trace: runId })}
        />
      ) : (
        <TabsView
          columns={columns}
          selected={selectedColumn}
          prId={multiRun.pr_id}
          prStatus={pr?.status ?? null}
          /* AC-109: the findings were produced against `multiRun.head_sha`; if
             the PR has moved since, the line a comment addresses may have too. */
          headMoved={
            !!multiRun.head_sha && !!pr?.head_sha && multiRun.head_sha !== pr.head_sha
          }
          repoFullName={repoFullName}
          headSha={multiRun.head_sha ?? null}
          onSelect={(runId) => setParams({ agent: runId })}
          onOpenTrace={(runId) => setParams({ trace: runId })}
          onActed={() => void refetch()}
        />
      )}

      <div style={s.sectionWrap}>
        <ConflictsSection
          positions={multiRun.conflicts}
          columns={columns}
          onlyConflicts={onlyConflicts}
          rerunPending={rerun.isPending}
          repoFullName={repoFullName}
          headSha={multiRun.head_sha ?? null}
          onToggle={(on) => setParams({ conflicts: on ? "1" : null })}
          onConfigure={() => router.push(configureHref)}
          onRunAgain={runAgain}
        />
      </div>

      {traceRunId && traceColumn && (
        <RunTraceDrawer
          // Remount on a run switch: the drawer derives its tab from `running`
          // at mount, exactly as the PR page mounts it (AC-80, AC-81).
          key={traceRunId}
          runId={traceRunId}
          // A run that has not finished has no persisted trace, so the live log
          // is the honest default for both of its states (AC-82).
          running={traceColumn.status === "running" || traceColumn.status === "queued"}
          prNumber={multiRun.pr_number ?? null}
          findings={traceColumn.findings}
          agentName={traceColumn.agent_name}
          onClose={() => setParams({ trace: null })}
        />
      )}
    </AppShell>
  );
}
