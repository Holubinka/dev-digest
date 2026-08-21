/* VerdictBanner — ported from findings.jsx.
   request_changes / approve / comment + summary + finding/blocker counts + score. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, Badge, CircularScore } from "@devdigest/ui";
import type { Verdict } from "@devdigest/shared";
import { RunCostBadge } from "@/components/run-cost-badge";
import { VERDICT_META } from "./constants";
import { s } from "./styles";

export function VerdictBanner({
  verdict,
  summary,
  score,
  findingsCount,
  blockers,
  agentName,
  costUsd = null,
  tokensIn = null,
  tokensOut = null,
  action = null,
}: {
  verdict: Verdict;
  summary: string | null;
  score: number | null;
  findingsCount: number;
  blockers: number;
  agentName?: string | null;
  /** What the run behind this verdict cost; null hides the badge entirely. */
  costUsd?: number | null;
  tokensIn?: number | null;
  tokensOut?: number | null;
  /**
   * An optional control for the card's right-hand column, UNDER the gauge and
   * its `PR SCORE` label. The mockup draws it left of the gauge; it was moved
   * below on 2026-08-17 at the request of the person reading the screen.
   *
   * A SLOT rather than knowledge of what the control does: this banner is shared
   * with `ReviewRunAccordion`, which has no such control and passes nothing, so
   * its appearance is unchanged by construction rather than by inspection.
   */
  action?: React.ReactNode;
}) {
  const t = useTranslations("prReview");
  const m = VERDICT_META[verdict] ?? VERDICT_META.comment;
  const VIcon = Icon[m.icon];
  const countsHint = t("verdict.countsHint");
  return (
    <div style={s.wrap}>
      <div style={s.iconBox(m.bg, m.c)}>
        <VIcon size={22} />
      </div>
      <div style={s.main}>
        <div style={s.titleRow}>
          <span style={s.label(m.c)}>{t(`verdict.${m.labelKey}`)}</span>
          <Badge color="var(--text-secondary)">
            {t("verdict.findingsCount", { count: findingsCount })}
            {blockers > 0 ? t("verdict.blockers", { count: blockers }) : ""}
          </Badge>
          {/* The mockup's ⓘ beside the counts. It exists because the two numbers
              cannot say for themselves why "2 blockers" sits beside five
              criticals: the threshold is the AGENT's (`ciFailOn`), and the count
              was taken when the run finished. Nothing on screen carries either
              fact. `role="img"` + `aria-label` is what gives an icon with no text
              an accessible name; `title` is the pointer half of the same
              sentence. */}
          <span style={s.countsHint} role="img" aria-label={countsHint} title={countsHint}>
            <Icon.Info size={14} aria-hidden />
          </span>
          {agentName && (
            <Badge color="var(--accent-text)" bg="var(--accent-bg)" icon="Cpu">
              {agentName}
            </Badge>
          )}
        </div>
        {summary && <p style={s.summary}>{summary}</p>}
      </div>
      {/* The right-hand column, top to bottom: the gauge, its label, the action
          under them, and the run's cost last. Rendered only when it would hold
          something — an empty column would still take its gap. */}
      {(action != null || score != null || costUsd != null) && (
        <div style={s.aside}>
          {score != null && (
            <div style={s.scoreCol}>
              <CircularScore score={score} size={52} stroke={5} />
              <span style={s.scoreLabel}>{t("verdict.prScore")}</span>
            </div>
          )}
          {action}
          {costUsd != null && (
            <RunCostBadge
              costUsd={costUsd}
              tokensIn={tokensIn}
              tokensOut={tokensOut}
              variant="detailed"
            />
          )}
        </div>
      )}
    </div>
  );
}
