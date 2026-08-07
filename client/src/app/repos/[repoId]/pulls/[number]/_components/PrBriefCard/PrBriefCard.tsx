/* PrBriefCard — the PR's headline verdict, above the fold on Overview.

   It is the LATEST review run, not a PR-wide aggregate: the verdict, summary and
   score all come from one agent's pass, and mixing its prose with counts summed
   across every run would describe two different things in one sentence. The
   Agent runs tab is where every run is listed.

   No request of its own beyond the two the page already makes, and no model
   call — a brief is a reading of reviews that have already happened. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SectionLabel, EmptyState } from "@devdigest/ui";
import type { Verdict } from "@devdigest/shared";
import { usePrReviews, usePrRuns } from "@/lib/hooks/reviews";
import { VerdictBanner } from "../VerdictBanner";
import { s } from "./styles";

export function PrBriefCard({ prId }: { prId: string | null }) {
  const t = useTranslations("brief");
  const { data: reviews } = usePrReviews(prId);
  const { data: runs } = usePrRuns(prId);

  // Newest first (see FindingsTab), so the first `review` is the latest one. A
  // `summary` row carries no verdict and is not a headline.
  const latest = (reviews ?? []).find((r) => r.kind === "review" && r.verdict != null);
  const run = latest?.run_id ? (runs ?? []).find((r) => r.run_id === latest.run_id) : undefined;

  return (
    <section style={s.wrap}>
      <SectionLabel icon="FileText">PR Brief</SectionLabel>
      {latest ? (
        <VerdictBanner
          verdict={latest.verdict as Verdict}
          summary={latest.summary}
          score={latest.score}
          findingsCount={latest.findings.length}
          // From the run, never recomputed from findings (INSIGHTS.md §blockers):
          // it is the agent's own `ciFailOn` threshold, not a CRITICAL tally, so
          // deriving it here would disagree with the Timeline on the same run.
          blockers={run?.blockers ?? 0}
          agentName={latest.agent_name}
          costUsd={run?.cost_usd ?? null}
          tokensIn={run?.tokens_in ?? null}
          tokensOut={run?.tokens_out ?? null}
        />
      ) : (
        <EmptyState icon="FileText" title={t("unavailable")} body={t("unavailableHint")} />
      )}
    </section>
  );
}
