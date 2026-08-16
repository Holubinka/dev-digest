"use client";

import React from "react";
import { Markdown, SectionLabel } from "@devdigest/ui";
import { usePrBrief, useComputeBrief } from "@/lib/hooks/brief";
import { usePrIntent, useRecomputeIntent } from "@/lib/hooks/core";
import type { PrFile } from "@/lib/types";
import { BlastRadiusCard } from "../BlastRadiusCard";
import { IntentCard } from "../IntentCard";
import { PrBriefCard } from "../PrBriefCard";
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
  /** Hands a path up to the page, which opens it in Files changed. */
  onOpenFile: (path: string) => void;
}

export function OverviewTab({
  prBody,
  prId,
  headSha,
  prFiles,
  repoFullName,
  onOpenFile,
}: OverviewTabProps) {
  // The tab owns the data so `IntentCard` and `PrBriefCard` stay presentational.
  const { data: intent, isLoading, isError } = usePrIntent(prId);
  const recompute = useRecomputeIntent(prId);

  const brief = usePrBrief(prId, headSha);
  const compute = useComputeBrief(prId, headSha);
  const { mutate: computeBrief } = compute;
  const { data: briefData } = brief;

  /**
   * Which `(prId, headSha)` this tab has already fired the automatic
   * computation for. A ref rather than state because nothing renders from it,
   * and a ref rather than nothing at all because a re-render, a refetch and
   * StrictMode's deliberate double-invoke would each otherwise start a second
   * paid computation for the same state.
   */
  const autoComputed = React.useRef<string | null>(null);

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
   * be one: this effect is the only automatic trigger, and it marks the state
   * as fired in the same tick it fires. A failed computation therefore does NOT
   * retry itself either — the button is the retry, and a self-retrying loop on
   * a route that costs money is the opposite of what AC-3 asks for.
   */
  React.useEffect(() => {
    if (!prId || !headSha) return;
    if (briefData !== null) return;
    const state = `${prId}:${headSha}`;
    if (autoComputed.current === state) return;
    autoComputed.current = state;
    computeBrief();
  }, [prId, headSha, briefData, computeBrief]);

  // The mutation's failure is the interesting one — it is the paid path, and it
  // carries `config_error` — but a failed GET must not read as an empty card.
  const briefFailure = compute.error ?? brief.error;

  return (
    <>
      <div className="dd-overview-cards" style={s.cardRow}>
        {/* First in the row: it is the card that answers "where do I start". */}
        <PrBriefCard
          brief={briefData}
          isLoading={brief.isLoading}
          isError={briefFailure != null}
          error={briefFailure}
          computing={compute.isPending}
          onCompute={() => computeBrief()}
          prFiles={prFiles}
          repoFullName={repoFullName}
          onOpenFile={onOpenFile}
        />
        <IntentCard
          intent={intent}
          isLoading={isLoading}
          isError={isError}
          onRecompute={() => recompute.mutate()}
          recomputing={recompute.isPending}
        />
        <BlastRadiusCard prId={prId} />
      </div>

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
