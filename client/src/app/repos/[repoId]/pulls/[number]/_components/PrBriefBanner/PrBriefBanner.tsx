"use client";

import React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button, Icon, Skeleton } from "@devdigest/ui";
import { ApiError } from "@/lib/api";
import { blockersForRun } from "@/lib/blockers";
import type { RiskBriefRecord } from "@/lib/types";
import type { ReviewRecord, RunSummary, Verdict } from "@devdigest/shared";
import { VerdictBanner } from "../VerdictBanner";
import { s } from "./styles";

interface PrBriefBannerProps {
  /** `null` = the server holds no brief for this head; `undefined` = not asked yet. */
  brief: RiskBriefRecord | null | undefined;
  isLoading: boolean;
  isError: boolean;
  /** The query's failure or the compute mutation's, whichever the tab saw last. */
  error: unknown;
  computing: boolean;
  onCompute: () => void;
  /**
   * The completed review for the CURRENT head, chosen by `pickReviewForHead`, or
   * null. A review belonging to another state contributes nothing here — not a
   * verdict, not a score, not a cost (AC-69).
   */
  review: ReviewRecord | null;
  /**
   * How many completed reviews exist for this head, `review` among them.
   *
   * The banner speaks with ONE of them and multi-agent review is first-class, so
   * the number has to be visible: a reader who sees a single verdict must be able
   * to tell that there were others. Nothing is summed across them.
   */
  reviewCount: number;
  /**
   * The `agent_runs` row behind that review. Cost, tokens and the blocker count
   * come off it and off nothing else: `blockers` is the agent's own gate
   * threshold applied server-side and cannot be recomputed on the client
   * (`client/INSIGHTS.md:512-524`, AC-68). `src/lib/blockers.ts` is the one place
   * both this banner and `ReviewRunAccordion` read it from.
   */
  run: RunSummary | null;
  /** A completed review exists for some other state of the PR (AC-75). */
  hasOtherStateReview: boolean;
}

/**
 * The full-width banner over the Overview cards.
 *
 * It shows REVIEW data — verdict, findings and blocker counts, PR SCORE, the
 * run's cost and tokens. The brief produces none of those five (D15), and it
 * writes no number into the `PR SCORE` slot: `risk_level` stays a three-value
 * badge on the RISK AREAS section (D16).
 *
 * Two states and no third:
 *
 *  - a completed review for THIS head → the shared `VerdictBanner`, and the
 *    brief's `what`/`why` leave the screen (AC-74). They stay in the record and
 *    in the route's answer; what changes is which of the two the reader needs.
 *  - none → our own banner: the brief's `what`/`why` as the prose (AC-73), the
 *    words that this state has not been reviewed, an empty `PR SCORE` slot, and
 *    NEITHER a verdict NOR zero counters (AC-66). A zero next to "blockers"
 *    reads as "we looked and found none", which nobody has.
 */
export function PrBriefBanner({
  brief,
  isLoading,
  isError,
  error,
  computing,
  onCompute,
  review,
  reviewCount,
  run,
  hasOtherStateReview,
}: PrBriefBannerProps) {
  const t = useTranslations("brief");
  const reviewed = review != null && review.verdict != null;

  // The brief's own non-record states. `null` when there is a record, which is
  // what lets the reviewed branch below stay silent about the brief in the
  // ordinary case and still surface a failure the reader can act on (AC-3,
  // AC-42).
  const briefState = <BriefState brief={brief} isLoading={isLoading} isError={isError} error={error} computing={computing} />;
  const hasBriefState = computing || isLoading || isError || brief == null;

  /**
   * The action names the BRIEF as its subject whatever prose stands beside it
   * (AC-71), and it is disabled by its own in-flight mutation and by nothing else
   * — a retry taken away in the state it recovers from is no retry at all
   * (`client/INSIGHTS.md:316-331`).
   *
   * It sits INSIDE the banner card, in the right-hand column and UNDER the
   * `PR SCORE` slot. Both states of the banner place it the same way, which is
   * what keeps it from moving when a review lands for this state.
   */
  const action =
    brief == null || isError ? (
      <Button
        kind="ghost"
        size="sm"
        icon="Sparkles"
        onClick={onCompute}
        disabled={computing}
        aria-label={t("riskBrief.compute")}
      >
        {t("riskBrief.compute")}
      </Button>
    ) : (
      <Button
        kind="ghost"
        size="sm"
        icon="RefreshCw"
        onClick={onCompute}
        disabled={computing}
        title={t("riskBrief.regenerate")}
        aria-label={t("riskBrief.regenerate")}
      />
    );

  return (
    <>
      {reviewed ? (
        <div>
          <VerdictBanner
            verdict={review.verdict as Verdict}
            summary={review.summary}
            score={review.score}
            findingsCount={review.findings.length}
            /* The one place both banners on this page read the count from
               (`src/lib/blockers.ts`). A client-side recount would hardcode
               CRITICAL and ignore the agent's own `ciFailOn`, which is not a
               second opinion about the number — it is the wrong number for every
               agent whose threshold is not `critical` (AC-68). */
            blockers={blockersForRun(run)}
            agentName={review.agent_name}
            costUsd={run?.cost_usd ?? null}
            tokensIn={run?.tokens_in ?? null}
            tokensOut={run?.tokens_out ?? null}
            action={action}
          />
          {/* One verdict is on screen and more than one was produced. Saying so
              is what keeps this from reading as THE answer for the state. */}
          {reviewCount > 1 && (
            <p style={s.hint}>{t("riskBrief.severalReviews", { count: reviewCount })}</p>
          )}
          {hasBriefState && <div style={s.briefState}>{briefState}</div>}
        </div>
      ) : (
        <div style={s.card}>
          <div style={s.iconBox}>
            <Icon.Gauge size={22} />
          </div>
          <div style={s.main}>
            <span style={s.title}>{t("riskBrief.notReviewed")}</span>
            {/* The prose and the failure are no longer alternatives. A brief
                that is on screen stays on screen when a REGENERATION fails —
                the record is still the server's answer for this head — and the
                failure prints beneath it. Only `computing`/`isLoading` take the
                prose away, because those are the states in which showing it
                would present a previous state as current (AC-7). */}
            {brief != null && !computing && !isLoading && (
              <>
                <div style={s.colLabel}>{t("riskBrief.what")}</div>
                <p style={s.prose}>{brief.what}</p>
                <div style={s.colLabel}>{t("riskBrief.why")}</div>
                <p style={s.prose}>{brief.why}</p>
              </>
            )}
            {hasBriefState && briefState}
            {hasOtherStateReview && <p style={s.hint}>{t("riskBrief.reviewedEarlierState")}</p>}
          </div>
          {/* The empty PR SCORE slot — the label and an em dash — with the
              action under it. No verdict, no zero counters: the state was not
              reviewed, so there is nothing to count (AC-66). Same corner and
              same order as the reviewed banner, so the control does not move
              when a review lands. */}
          <div style={s.aside}>
            <div style={s.scoreCol}>
              <span style={s.scoreDash}>—</span>
              <ScoreLabel />
            </div>
            {action}
          </div>
        </div>
      )}
    </>
  );
}

/** `PR SCORE`, from the copy the verdict banner beside it already uses. */
function ScoreLabel() {
  const t = useTranslations("prReview");
  return <span style={s.scoreLabel}>{t("verdict.prScore")}</span>;
}

/**
 * The brief's own state, or `null` when there is a record to render instead.
 *
 * Four states, in this order, none masking another. `computing` leads because a
 * regeneration replaces the record of the head already on screen, and showing
 * the old one under a spinner is the "presents a previous state as current" that
 * AC-7 forbids. Across heads the cache key does that job on its own —
 * `["brief", prId, headSha]` cannot resolve to another head's brief.
 */
function BriefState({
  brief,
  isLoading,
  isError,
  error,
  computing,
}: {
  brief: RiskBriefRecord | null | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  computing: boolean;
}) {
  const t = useTranslations("brief");

  if (computing || isLoading) {
    return (
      <>
        <p role="status" style={s.note}>
          {t("riskBrief.computing")}
        </p>
        <Skeleton height={14} style={s.skeletonRow} />
        <Skeleton width="70%" height={12} />
      </>
    );
  }

  if (isError) return <FailureBody error={error} />;

  // Where a DISABLED query lands too: without a `prId` or a `head_sha` the query
  // is `enabled: false`, and a disabled TanStack v5 query reports
  // `isLoading === false` with `data === undefined` (`client/INSIGHTS.md:490-517`),
  // so "we have not asked yet" falls through to here and never to a skeleton
  // that never resolves.
  if (brief == null) {
    return (
      <>
        <p style={s.note}>{t("unavailable")}</p>
        <p style={s.hint}>{t("unavailableHint")}</p>
      </>
    );
  }

  return null;
}

/**
 * What went wrong, in the reader's terms.
 *
 * A missing provider key is not a failure the reader can retry into success, so
 * it gets its own copy and a way to fix it; everything else shows the server's
 * own sentence under a stable heading, which is what makes "shows the reason"
 * more than a generic apology.
 */
function FailureBody({ error }: { error: unknown }) {
  const t = useTranslations("brief");

  if (error instanceof ApiError && error.code === "config_error") {
    return (
      <>
        <p style={s.note}>{t("riskBrief.notConfigured")}</p>
        <p style={s.hint}>
          <Link href="/settings/models" style={s.link}>
            {t("riskBrief.notConfiguredLink")}
          </Link>
        </p>
      </>
    );
  }

  const detail =
    error instanceof ApiError
      ? error.status === 429
        ? t("riskBrief.rateLimited")
        : error.message
      : null;

  return (
    <>
      <p style={s.note}>{t("riskBrief.failed")}</p>
      {detail != null && <p style={s.hint}>{detail}</p>}
    </>
  );
}
