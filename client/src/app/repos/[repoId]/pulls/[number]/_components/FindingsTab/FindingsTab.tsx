"use client";

import React, { useCallback } from "react";
import { useTranslations } from "next-intl";
import { Icon, Badge, Button, SectionLabel, EmptyState } from "@devdigest/ui";
import { RunStatus } from "../RunStatus";
import { RunHistory } from "../RunHistory/RunHistory";
import { ReviewRunAccordion } from "../ReviewRunAccordion";
import { SeverityFilterBar, type SeverityLevel } from "../SeverityFilterBar";
import { runsWithSeverity } from "./helpers";
import { s } from "./styles";
import type { FindingRecord, ReviewRecord, RunSummary, PrCommit } from "@devdigest/shared";
import type { UseMutationResult } from "@tanstack/react-query";

interface FindingsTabProps {
  prId: string | null;
  liveRunIds: string[];
  reviewRunning: boolean;
  lethalTrifecta: FindingRecord[];
  runs: ReviewRecord[];
  prRuns: RunSummary[] | undefined;
  prCommits: PrCommit[];
  cancelMutation: UseMutationResult<any, any, string, any>;
  /** owner/repo + head sha — used to deep-link a finding's file:line to GitHub. */
  repoFullName?: string | null;
  headSha?: string | null;
  /** Severity the findings lists are narrowed to; null shows every level. */
  severity: SeverityLevel | null;
  onSeverityChange: (next: SeverityLevel | null) => void;
  onOpenTrace: (id: string) => void;
  onDelete: (id: string) => void;
  onRunDone: () => void;
}

export function FindingsTab({
  prId,
  liveRunIds,
  reviewRunning,
  lethalTrifecta,
  runs,
  prRuns,
  prCommits,
  cancelMutation,
  repoFullName,
  headSha,
  severity,
  onSeverityChange,
  onOpenTrace,
  onDelete,
  onRunDone,
}: FindingsTabProps) {
  const t = useTranslations("prReview");
  const handleCancelAll = useCallback(() => {
    liveRunIds.forEach((id) => cancelMutation.mutate(id));
  }, [liveRunIds, cancelMutation]);

  const handleOpenFirstTrace = useCallback(() => {
    if (liveRunIds[0]) onOpenTrace(liveRunIds[0]);
  }, [liveRunIds, onOpenTrace]);

  const handleOpenTrace = useCallback(
    (id: string) => {
      onOpenTrace(id);
    },
    [onOpenTrace],
  );

  const handleDelete = useCallback(
    (id: string) => {
      onDelete(id);
    },
    [onDelete],
  );

  // A review carries no cost of its own — that lives on the agent_runs row the
  // timeline already renders. Both arrive here, so match them up by run_id
  // rather than widening the review contract.
  const runById = React.useMemo(
    () => new Map((prRuns ?? []).map((r) => [r.run_id, r])),
    [prRuns],
  );

  // The timeline rows carry only a findings COUNT; the per-severity split lives
  // on the review. Both are already here — key the reviews by run so the rows
  // can show severity without another request.
  const findingsByRun = React.useMemo(() => {
    const map = new Map<string, FindingRecord[]>();
    for (const review of runs) {
      if (review.run_id) map.set(review.run_id, review.findings);
    }
    return map;
  }, [runs]);

  // Timeline → Review-runs navigation: clicking an agent name in the timeline
  // opens + scrolls to that run's accordion below. The nonce re-triggers the
  // scroll even when the same run is clicked twice.
  const [target, setTarget] = React.useState<{ runId: string; n: number } | null>(null);
  const handleGoToReview = useCallback((runId: string) => {
    setTarget((p) => ({ runId, n: (p?.n ?? 0) + 1 }));
  }, []);

  // The severity bar counts the whole PR, so it reads across every run; the
  // accordions below it drop to those that hold a finding at the chosen level.
  const allFindings = React.useMemo(() => runs.flatMap((r) => r.findings), [runs]);
  const shownRuns = React.useMemo(() => runsWithSeverity(runs, severity), [runs, severity]);
  const hiddenRuns = runs.length - shownRuns.length;

  return (
    <section>
      {liveRunIds.length > 0 && (
        <div style={s.liveRunSection}>
          <SectionLabel
            icon="Sparkles"
            right={
              <div style={s.cancelActions}>
                <Button
                  kind="danger"
                  size="sm"
                  icon="X"
                  loading={cancelMutation.isPending}
                  onClick={handleCancelAll}
                >
                  Cancel
                </Button>
                <Button kind="ghost" size="sm" icon="FileText" onClick={handleOpenFirstTrace}>
                  Open run trace
                </Button>
              </div>
            }
          >
            Live review
          </SectionLabel>
          <RunStatus runIds={liveRunIds} onDone={onRunDone} />
        </div>
      )}

      {reviewRunning && (
        <div style={s.reviewInProgress}>
          <Icon.RefreshCw size={16} style={{ color: "var(--accent)", animation: "ddspin 1s linear infinite" }} />
          <span style={s.reviewInProgressText}>Review in progress…</span>
          <span style={s.reviewInProgressSub}>
            the agent is analyzing the diff — this can take a while on large PRs.
          </span>
        </div>
      )}

      {lethalTrifecta.length > 0 && (
        <div style={s.lethalTrifecta}>
          <Icon.Shield size={16} style={{ color: "var(--crit)" }} />
          <span style={s.lethalTrifectaTitle}>Lethal Trifecta detected</span>
          <Badge color="var(--crit)" bg="transparent">
            {lethalTrifecta.length} finding(s)
          </Badge>
        </div>
      )}

      {((prRuns && prRuns.length > 0) || prCommits.length > 0) && (
        <div style={s.timelineSection}>
          <SectionLabel
            icon="Activity"
            right={<span style={{ fontSize: 12, color: "var(--text-muted)" }}>runs &amp; commits · newest first</span>}
          >
            Timeline
          </SectionLabel>
          <RunHistory
            runs={prRuns ?? []}
            commits={prCommits}
            findingsByRun={findingsByRun}
            onOpenTrace={handleOpenTrace}
            onGoToReview={handleGoToReview}
            onDelete={handleDelete}
          />
        </div>
      )}

      <SectionLabel
        icon="AlertOctagon"
        right={<span style={{ fontSize: 12, color: "var(--text-muted)" }}>grouped by run · newest first</span>}
      >
        Review runs
      </SectionLabel>
      {allFindings.length > 0 && (
        <SeverityFilterBar
          findings={allFindings}
          active={severity}
          onChange={onSeverityChange}
        />
      )}
      {runs.length === 0 ? (
        reviewRunning || liveRunIds.length > 0 ? null : (
          <EmptyState
            icon="Sparkles"
            title="No findings yet"
            body="Run a review to generate findings. Use Run Review ▾ above (run all enabled agents or a specific one)."
          />
        )
      ) : (
        prId && (
          <>
            {shownRuns.map((review, i) => (
              <ReviewRunAccordion
                key={review.id}
                review={review}
                run={review.run_id ? runById.get(review.run_id) ?? null : null}
                prId={prId}
                defaultOpen={i === 0}
                repoFullName={repoFullName}
                headSha={headSha}
                targetRunId={target?.runId ?? null}
                targetNonce={target?.n ?? 0}
                severity={severity}
              />
            ))}
            {severity && hiddenRuns > 0 && (
              <div style={s.hiddenRuns}>
                {t("severityFilter.hiddenRuns", { count: hiddenRuns, severity })}
              </div>
            )}
          </>
        )
      )}
    </section>
  );
}
