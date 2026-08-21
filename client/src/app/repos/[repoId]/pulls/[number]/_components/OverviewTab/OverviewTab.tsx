"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Markdown, SectionLabel } from "@devdigest/ui";
import { useBriefComputeAttempted, usePrBrief, useComputeBrief } from "@/lib/hooks/brief";
import { usePrIntent, useRecomputeIntent } from "@/lib/hooks/core";
import type { PrFile } from "@/lib/types";
import type { ReviewRecord, RunSummary } from "@devdigest/shared";
import { BlastRadiusCard } from "../BlastRadiusCard";
import { IntentCard } from "../IntentCard";
import { PrBriefBanner } from "../PrBriefBanner";
import { hasReviewForOtherState, reviewsForHead } from "../PrBriefBanner/helpers";
import { RiskAreas } from "../RiskAreas";
import { ReviewFocusSection } from "../ReviewFocusSection";
import { s } from "./styles";

interface OverviewTabProps {
  prBody: string | null | undefined;
  prId: string | null;
  /**
   * The PR's head commit. Required and nullable rather than optional: it keys
   * the brief cache, and a prop with a default is invisible to `tsc` — which is
   * how a whole feature was disabled in silence twice
   * (`client/INSIGHTS.md:163-249`).
   */
  headSha: string | null;
  prFiles: PrFile[];
  repoFullName: string | null;
  /**
   * Every persisted review for this PR, from the page (which already fetches
   * them). The banner needs to know which state each describes.
   */
  reviews: ReviewRecord[] | undefined;
  /**
   * Every `agent_runs` row for this PR. Joined to the reviews by `run_id` HERE
   * rather than by widening `ReviewRecord`: cost, tokens and blockers are run
   * telemetry and belong on the run (`client/INSIGHTS.md:497-511`).
   */
  prRuns: RunSummary[] | undefined;
  /** Hands a path — and a line, when one is known — up to the page. */
  onOpenFile: (path: string, line?: number) => void;
}

export function OverviewTab({
  prBody,
  prId,
  headSha,
  prFiles,
  repoFullName,
  reviews,
  prRuns,
  onOpenFile,
}: OverviewTabProps) {
  const t = useTranslations("brief");
  // The tab owns the data so every block below stays presentational.
  const { data: intent, isLoading, isError } = usePrIntent(prId);
  const recompute = useRecomputeIntent(prId);

  const brief = usePrBrief(prId, headSha);
  const compute = useComputeBrief(prId, headSha);
  const { mutate: computeBrief } = compute;
  const { data: briefData } = brief;

  /**
   * Whether the automatic computation has already been fired for this
   * `(prId, headSha)` — asked of the mutation cache, which outlives this mount.
   *
   * It used to be a `useRef`, and the mismatch was the whole bug: the fact is
   * about the PR state, the ref's lifetime is one mount, and `page.tsx` renders
   * this tab as `{tab === "overview" && …}`, so it is unmounted on every switch
   * to Files changed. See `lib/hooks/brief.ts` for why it is a callback.
   */
  const alreadyComputed = useBriefComputeAttempted(prId, headSha);

  /**
   * The one `useEffect` in this tab, and the external system it synchronises is
   * the server's brief table: opening a PR state that has no brief computes one
   * with no user action (AC-2). Everything else on this tab is derived during
   * render.
   *
   * `briefData === null` is the ONLY trigger — that is the server saying "no
   * record for this head". `undefined` means the query has not settled, and a
   * record means there is nothing to do (AC-28: a stored brief costs zero model
   * calls, however many times it is read).
   *
   * There is no "and no mutation is in flight" condition because there cannot
   * be one: `alreadyComputed()` is true from the moment `mutate` registers the
   * mutation, in flight or settled. A failed computation therefore does NOT
   * retry itself — not on a re-render, not on StrictMode's deliberate
   * double-invoke, and not on the remount a tab switch causes. The button is the
   * retry, and a self-retrying loop on a route that costs money is the opposite
   * of what AC-3 asks for.
   */
  React.useEffect(() => {
    if (!prId || !headSha) return;
    if (briefData !== null) return;
    if (alreadyComputed()) return;
    computeBrief();
  }, [prId, headSha, briefData, computeBrief, alreadyComputed]);

  // The mutation's failure is the interesting one — it is the paid path, and it
  // carries `config_error` — but a failed GET must not read as an empty card.
  const briefFailure = compute.error ?? brief.error;

  /**
   * Derived during render, never mirrored into state — and DELIBERATELY not
   * gated on `briefFailure`.
   *
   * A failed *re*computation must not remove the record it was recomputing. The
   * mutation's `error` is sticky for the life of the mount, so a regenerate that
   * 429s (`riskBrief.rateLimited` exists for exactly that) used to empty RISK
   * AREAS, REVIEW FOCUS, the provenance block and the brief cost for the rest of
   * the visit — three regions saying "not computed" about a brief that is
   * computed and cached. A failed background refetch did the same to a query
   * that already had data.
   *
   * The failure is still surfaced, as a failure, by the banner — which owns that
   * copy. Losing the data is only right when there is no data, and `briefData` is
   * `null` exactly then: the cache key is `["brief", prId, headSha]`, so it can
   * never resolve to another head's record.
   */
  const record = briefData ?? null;
  const briefBusy = compute.isPending || brief.isLoading;

  const reviewList = reviews ?? [];
  const runsById = new Map((prRuns ?? []).map((r) => [r.run_id, r]));
  // Every completed review of THIS state, most blocking first. The banner speaks
  // with the first and reports how many there were — several agents can review
  // one head and disagree, and the top-level "should I merge" signal must not
  // pick the reassuring one of them in silence.
  const headReviews = reviewsForHead(reviewList, headSha);
  const bannerReview = headReviews[0] ?? null;
  const bannerRun =
    bannerReview?.run_id != null ? runsById.get(bannerReview.run_id) ?? null : null;

  return (
    <>
      {/* ONE heading over the banner, the card row and the review-focus section
          (AC-49). The three are siblings, which is also what gives R6 its
          stacking order below 1024px with no CSS at all. */}
      <section>
        <SectionLabel icon="FileText">{t("riskBrief.sectionTitle")}</SectionLabel>

        <PrBriefBanner
          brief={record}
          isLoading={brief.isLoading}
          isError={briefFailure != null}
          error={briefFailure}
          computing={compute.isPending}
          onCompute={() => computeBrief()}
          review={bannerReview}
          reviewCount={headReviews.length}
          run={bannerRun}
          hasOtherStateReview={hasReviewForOtherState(reviewList, headSha)}
        />

        {/* TWO cards (AC-46). The brief no longer has a card of its own — its
            places are the banner's prose slot, the risks section inside INTENT
            and the review-focus section below, so a missing brief leaves these
            two fully rendered and unresized (AC-50). */}
        <div className="dd-overview-cards" style={s.cardRow}>
          <IntentCard
            intent={intent}
            isLoading={isLoading}
            isError={isError}
            onRecompute={() => recompute.mutate()}
            recomputing={recompute.isPending}
            riskAreas={
              <RiskAreas
                risks={record?.risks ?? null}
                riskLevel={record?.risk_level ?? null}
                refLines={record?.ref_lines ?? []}
                linkSha={record?.link_sha ?? null}
                headSha={record?.head_sha ?? null}
                indexMatchesHead={record?.index_matches_head ?? false}
                repoFullName={repoFullName}
                intentFreshness={record?.intent_freshness ?? null}
                intentComputedAt={record?.intent_computed_at ?? null}
                isLoading={briefBusy}
                onRecompute={() => compute.mutate()}
                recomputing={compute.isPending}
              />
            }
          />
          <BlastRadiusCard prId={prId} />
        </div>

        <ReviewFocusSection
          items={record?.review_focus ?? null}
          refLines={record?.ref_lines ?? []}
          linkSha={record?.link_sha ?? null}
          headSha={record?.head_sha ?? null}
          indexMatchesHead={record?.index_matches_head ?? false}
          prFiles={prFiles}
          onOpenFile={onOpenFile}
          inputs={record?.inputs ?? null}
          costUsd={record?.cost_usd ?? null}
          tokensIn={record?.tokens_in ?? null}
          isLoading={briefBusy}
        />
      </section>

      {prBody && (
        <section>
          <SectionLabel icon="MessageSquare">Description</SectionLabel>
          <div style={s.descriptionBox}>
            <Markdown>{prBody}</Markdown>
          </div>
        </section>
      )}
    </>
  );
}
