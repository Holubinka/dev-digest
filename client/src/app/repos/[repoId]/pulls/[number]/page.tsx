/* PR Detail — /repos/:repoId/pulls/:number. F2 shell extended by A2 with:
   - Findings panel (VerdictBanner + FindingCards)
   - RunReviewDropdown (run all / a specific agent) + live SSE RunStatus
   - Basic file-by-file diff viewer in the Files tab
   Tab state lives in query (?tab). */
"use client";

import React from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Skeleton, ErrorState } from "@devdigest/ui";
import { AppShell } from "../../../../../components/app-shell";
import { RepoNotFound } from "@/components/repo-not-found";
import { PrDetailHeader } from "./_components/PrDetailHeader";
import { OverviewTab } from "./_components/OverviewTab";
import { FindingsTab } from "./_components/FindingsTab";
import { DiffTab } from "./_components/DiffTab";
import type { SeverityLevel } from "./_components/SeverityFilterBar/constants";
import { isSeverityLevel } from "./_components/SeverityFilterBar/helpers";
import RunTraceDrawer from "@/components/run-trace-drawer";
import { usePullDetail, usePulls } from "../../../../../lib/hooks";
import { useQueryClient } from "@tanstack/react-query";
import { usePrReviews, useCancelRun, usePrActiveRuns, usePrRuns, useDeleteRun } from "../../../../../lib/hooks/reviews";
import { useLatestMultiAgentRunForPull } from "@/lib/hooks/multi-agent";
import { useActiveRepo, useRepoNotFound } from "../../../../../lib/repo-context";
import { ApiError } from "../../../../../lib/api";
import { githubPrUrl } from "../../../../../lib/github-urls";
import { MAX_LINE } from "@/lib/line-numbers";
import type { FindingRecord } from "@devdigest/shared";

/**
 * A line number someone could have typed into the address bar.
 *
 * The WHOLE string is matched, and only then converted. `Number.parseInt` is the
 * wrong tool here and is deliberately not used: it reads `12abc` as 12, `1e3` as
 * 1 and ` 12` as 12, and it has no upper bound at all.
 *
 * Two separate jobs, and the split is why this is not the same function as
 * `BriefRef`'s `lineFor`: the pattern refuses the SHAPES a string can take
 * (`12abc`, `1e3`, ` 12`, `0`, a leading zero, a non-ASCII digit), and `MAX_LINE`
 * bounds the VALUE. The bound is shared with the reference renderer rather than
 * written out again here — a reference printing a line the jump then declines to
 * open is exactly what two independent literals would let happen.
 */
const USABLE_LINE = /^[1-9][0-9]*$/;

function usableLine(raw: string | null): number | null {
  if (raw == null || !USABLE_LINE.test(raw)) return null;
  const line = Number(raw);
  return line <= MAX_LINE ? line : null;
}

export default function PRDetailPage() {
  const params = useParams<{ repoId: string; number: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const { repoId, number } = params;
  const { activeRepo } = useActiveRepo();
  const repoNotFound = useRepoNotFound(repoId);
  // The route is keyed by PR number, but every PR API is keyed by the row's
  // uuid — resolve number → uuid via the (cached) pulls list before fetching.
  const { data: pulls, isLoading: pullsLoading } = usePulls(repoId);
  const prId = pulls?.find((p) => p.number === Number(number))?.id ?? null;
  const { data: pr, isLoading: detailLoading, isError, error, refetch } = usePullDetail(prId);

  const isLoading = pullsLoading || (prId != null && detailLoading);
  const { data: reviews, refetch: refetchReviews } = usePrReviews(prId);

  // Live run tracking is SERVER-SOURCED (agent_runs status='running'): survives
  // navigation AND reload, and self-clears via polling when runs finish.
  const qc = useQueryClient();
  const { data: activeRuns } = usePrActiveRuns(prId);
  const { data: prRuns } = usePrRuns(prId);
  const deleteRun = useDeleteRun(prId);
  const liveRunIds = (activeRuns ?? []).map((r) => r.run_id);
  const reviewRunning = liveRunIds.length > 0;
  const cancel = useCancelRun();
  const invalidateActiveRuns = () => {
    if (prId) qc.invalidateQueries({ queryKey: ["pr-active-runs", prId] });
  };
  // When a run settles (done OR failed) refresh the full run history too, so a
  // just-failed run shows up in "Run history" immediately — no page reload.
  const invalidateRunHistory = () => {
    if (prId) qc.invalidateQueries({ queryKey: ["pr-runs", prId] });
  };
  // A finished run is the only thing that changes a Smart Diff. Without this the
  // finding badges wait for a manual reload.
  const invalidateSmartDiff = () => {
    if (prId) qc.invalidateQueries({ queryKey: ["smart-diff", prId] });
  };

  // The way back to this PR's multi-agent comparison, from TWO sources.
  //
  // The freshly created id wins while it is there: the server was asked before
  // that run existed, so preferring its answer would point at the PREVIOUS
  // comparison for as long as the invalidated query takes to come back. The
  // server read is what makes the link survive a reload or a visit tomorrow —
  // an id kept only here dies with the page (R54; AC-88 covers only the moment
  // of launch).
  //
  // It is NOT a query parameter. The shareable address is the multi-run's own
  // URL, and keeping it out of the URL is what leaves `onRunStart` with the
  // single `setParams` call the comment below at :90-94 is about.
  const [justStartedMultiRunId, setJustStartedMultiRunId] = React.useState<string | null>(null);
  const { data: latestMultiRun } = useLatestMultiAgentRunForPull(prId);
  const multiRunId = justStartedMultiRunId ?? latestMultiRun?.id ?? null;
  const multiRunHref = multiRunId
    ? `/repos/${repoId}/multi-agent/${encodeURIComponent(multiRunId)}`
    : null;

  const tab = search.get("tab") ?? "overview";
  const traceRunId = search.get("trace");
  // Several keys at once, because one router.replace per key races: each builds
  // its params from the same stale `search`, so the last write wins and the
  // others are lost. Jumping to a finding sets three.
  const setParams = (entries: Record<string, string | null>) => {
    const sp = new URLSearchParams(search.toString());
    for (const [key, val] of Object.entries(entries)) {
      if (val == null) sp.delete(key);
      else sp.set(key, val);
    }
    router.replace(`/repos/${repoId}/pulls/${number}${sp.toString() ? `?${sp.toString()}` : ""}`);
  };
  const setParam = (key: string, val: string | null) => setParams({ [key]: val });
  const setTab = (t: string) => setParam("tab", t);
  // The severity filter rides in the URL like ?tab and ?trace, so a filtered
  // view survives a reload and can be handed to someone else. An unknown value
  // is ignored rather than trusted — see SeverityFilterBar/helpers.ts.
  const sevParam = search.get("sev");
  const severity = isSeverityLevel(sevParam) ? sevParam : null;
  const setSeverity = (next: SeverityLevel | null) => setParam("sev", next);
  // Set by a Smart Diff severity chip: which finding the Agent runs tab should
  // open and scroll to. The severity filter is cleared along with it, or the
  // target could land behind a filter that hides it.
  const targetFindingId = search.get("finding");
  const openFinding = (id: string) => setParams({ tab: "findings", finding: id, sev: null });
  // Set by a review-focus item in the PR Brief: which file — and, when the brief
  // knows one, which LINE — the Files changed tab should open and scroll to.
  // Three keys, ONE `setParams`: three `setParam` calls would build their params
  // from the same captured `search`, race, and leave only the last one
  // (`client/INSIGHTS.md:585-592`). A jump with no line CLEARS the key rather
  // than leaving the previous one behind, or the reader lands on a line the
  // reference they just pressed never named.
  const targetFile = search.get("file");
  const targetLine = usableLine(search.get("line"));
  const openFile = (path: string, line?: number) =>
    setParams({ tab: "diff", file: path, line: line != null ? String(line) : null });
  // Risk order is the default: GitHub's order is what Smart Diff exists to fix.
  // Only the explicit opt-out is written, so the URL stays clean until asked.
  const smartOrder = search.get("diffOrder") !== "original";
  const setSmartOrder = (next: boolean) => setParam("diffOrder", next ? null : "original");

  // Reviews come newest-first; each is its own run (grouped into accordions).
  const runs = reviews ?? [];
  const allFindings: FindingRecord[] = React.useMemo(
    () => (reviews ?? []).flatMap((r) => r.findings),
    [reviews],
  );
  const lethalTrifecta = allFindings.filter((f) => f.kind === "lethal_trifecta");
  const findingsCount = allFindings.length;

  const repoName = activeRepo?.full_name ?? repoId;
  // The real "owner/repo" (null until the repo is loaded) — used to build
  // github.com deep-links for the header and finding file references.
  const repoFullName = activeRepo?.full_name ?? null;
  const crumb = [
    { label: repoName, mono: true, href: `/repos/${repoId}/pulls` },
    { label: "Pull Requests", href: `/repos/${repoId}/pulls` },
    { label: `#${number}`, mono: true },
  ];

  // Stale/unknown :repoId → friendly empty state instead of a 404 error.
  if (repoNotFound) {
    return (
      <AppShell crumb={crumb}>
        <RepoNotFound />
      </AppShell>
    );
  }

  if (isLoading) {
    return (
      <AppShell crumb={crumb}>
        <div style={{ padding: "28px 32px", display: "flex", flexDirection: "column", gap: 16, maxWidth: 1080, margin: "0 auto" }}>
          <Skeleton height={28} width={420} />
          <Skeleton height={16} width={300} />
          <Skeleton height={200} />
        </div>
      </AppShell>
    );
  }

  if (isError || !pr) {
    return (
      <AppShell crumb={crumb}>
        <ErrorState
          fullScreen
          title="Couldn't load this pull request"
          body={error instanceof ApiError ? error.message : `PR #${number} could not be loaded.`}
          onRetry={() => refetch()}
        />
      </AppShell>
    );
  }

  return (
    <AppShell crumb={crumb}>
      <PrDetailHeader
        pr={pr}
        prId={prId}
        tab={tab}
        findingsCount={findingsCount}
        githubUrl={repoFullName ? githubPrUrl(repoFullName, pr.number) : null}
        onSetTab={setTab}
        onRunStart={() => setTab("findings")}
        onRunsStarted={(started) => {
          setJustStartedMultiRunId(started.multiRunId);
          invalidateActiveRuns();
        }}
      />

      <div style={{ padding: "24px 32px 44px", display: "flex", flexDirection: "column", gap: 24, maxWidth: 1080, margin: "0 auto" }}>
        {tab === "overview" && (
          <OverviewTab
            prBody={pr.body}
            prId={prId}
            headSha={pr.head_sha}
            prFiles={pr.files}
            repoFullName={repoFullName}
            reviews={reviews}
            prRuns={prRuns}
            onOpenFile={openFile}
          />
        )}

        {tab === "findings" && (
          <FindingsTab
            prId={prId}
            multiRunHref={multiRunHref}
            liveRunIds={liveRunIds}
            reviewRunning={reviewRunning}
            lethalTrifecta={lethalTrifecta}
            runs={runs}
            prRuns={prRuns}
            prCommits={pr.commits}
            repoFullName={repoFullName}
            headSha={pr.head_sha}
            severity={severity}
            onSeverityChange={setSeverity}
            targetFindingId={targetFindingId}
            cancelMutation={cancel}
            onOpenTrace={(id) => setParam("trace", id)}
            onDelete={(id) => {
              if (window.confirm("Delete this run from history? (its logs are removed too)"))
                deleteRun.mutate(id);
            }}
            onRunDone={() => {
              invalidateActiveRuns();
              invalidateRunHistory();
              invalidateSmartDiff();
              refetchReviews();
            }}
          />
        )}

        {tab === "diff" && (
          <DiffTab
            prId={prId}
            filesCount={pr.files_count}
            files={pr.files}
            findings={allFindings}
            canComment={pr.status === "open"}
            onOpenFinding={openFinding}
            targetFile={targetFile}
            targetLine={targetLine}
            smartOrder={smartOrder}
            onSmartOrderChange={setSmartOrder}
          />
        )}
      </div>

      {prId && traceRunId && (
        <RunTraceDrawer
          // Remount on a run switch: `tab` is derived from `running` at mount.
          key={traceRunId}
          runId={traceRunId}
          running={liveRunIds.includes(traceRunId)}
          prNumber={pr.number}
          findings={runs.find((r) => r.run_id === traceRunId)?.findings ?? []}
          agentName={runs.find((r) => r.run_id === traceRunId)?.agent_name ?? null}
          onClose={() => setParam("trace", null)}
        />
      )}
    </AppShell>
  );
}
