"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Icon, SectionLabel, Skeleton } from "@devdigest/ui";
import { RunCostBadge } from "@/components/run-cost-badge";
import type { PrFile, ReviewFocusItem, RiskBriefInput, RiskBriefRefLine } from "@/lib/types";
import { BriefRef } from "../BriefRef";
import { FOCUS_SHOWN, statusKey } from "./constants";
import { s } from "./styles";

interface ReviewFocusSectionProps {
  /** The brief's `review_focus`. `null` = there is no brief for this head. */
  items: ReviewFocusItem[] | null;
  refLines: RiskBriefRefLine[];
  linkSha: string | null;
  headSha: string | null;
  indexMatchesHead: boolean;
  /** The PR's changed files — what decides whether a row can be a control. */
  prFiles: PrFile[];
  onOpenFile: (path: string, line?: number) => void;
  /** Provenance: which inputs went in, and what became of each (AC-33). */
  inputs: RiskBriefInput[] | null;
  /** The BRIEF's own cost and token count — never the review run's (AC-70). */
  costUsd: number | null;
  tokensIn: number | null;
  isLoading: boolean;
}

/**
 * REVIEW FOCUS — READ THESE FIRST: its own full-width section under the card
 * row, with the FULL count in its heading.
 *
 * Full width because it is a reading order, not a property of either card, and
 * a sibling of `.dd-overview-cards` rather than a child of it — which is what
 * makes it stack last below 1024px with no CSS at all.
 *
 * EVERY model-written string below is rendered as `{value}`. No `<Markdown>`,
 * no `dangerouslySetInnerHTML`.
 */
export function ReviewFocusSection({
  items,
  refLines,
  linkSha,
  headSha,
  indexMatchesHead,
  prFiles,
  onOpenFile,
  inputs,
  costUsd,
  tokensIn,
  isLoading,
}: ReviewFocusSectionProps) {
  const t = useTranslations("brief");

  if (isLoading) {
    return (
      <section style={s.card}>
        <SectionLabel icon="ListChecks">{t("riskBrief.reviewFocus")}</SectionLabel>
        <Skeleton height={14} style={s.skeletonRow} />
        <Skeleton width="70%" height={12} />
      </section>
    );
  }

  // No brief for this head — or one that failed. The banner above carries the
  // reason; repeating it here would put the same sentence on screen twice.
  if (items == null) {
    return (
      <section style={s.card}>
        <SectionLabel icon="ListChecks">{t("riskBrief.reviewFocus")}</SectionLabel>
        <p style={s.note}>{t("riskBrief.sectionUnavailable")}</p>
      </section>
    );
  }

  // Derived during render, not stored: a `useState` mirror of query data is the
  // anti-pattern `react-best-practices` opens with.
  const changedPaths = new Set(prFiles.map((f) => f.path));
  const shown = items.slice(0, FOCUS_SHOWN);
  const hidden = items.slice(FOCUS_SHOWN);

  return (
    <section style={s.card}>
      <SectionLabel icon="ListChecks">
        {t("riskBrief.reviewFocus")}
        {/* The FULL list length, not the number of rows on screen — that is what
            makes the truncation below loud. */}
        <Badge color="var(--accent-text)" bg="var(--accent-bg)" style={s.countBadge}>
          {items.length}
        </Badge>
      </SectionLabel>

      {/* A ternary, never `{items.length && …}`: a zero-length list would render
          a literal `0` on the page (`react-best-practices` § Conditional
          Rendering). The section stays put either way (AC-72). */}
      {items.length > 0 ? (
        <>
          <ul style={s.list}>
            {shown.map((item, i) => (
              <FocusRow
                key={`${item.ref}-${i}`}
                item={item}
                refLines={refLines}
                linkSha={linkSha}
                headSha={headSha}
                indexMatchesHead={indexMatchesHead}
                changedPaths={changedPaths}
                onOpenFile={onOpenFile}
              />
            ))}
          </ul>
          {hidden.length > 0 && (
            <details className="dd-brief-disclosure">
              <summary style={s.more}>{t("riskBrief.moreFocus", { count: hidden.length })}</summary>
              <ul style={s.moreList}>
                {hidden.map((item, i) => (
                  <FocusRow
                    key={`${item.ref}-${FOCUS_SHOWN + i}`}
                    item={item}
                    refLines={refLines}
                    linkSha={linkSha}
                    headSha={headSha}
                    indexMatchesHead={indexMatchesHead}
                    changedPaths={changedPaths}
                    onOpenFile={onOpenFile}
                  />
                ))}
              </ul>
            </details>
          )}
        </>
      ) : (
        <p style={s.note}>{t("riskBrief.reviewFocusEmpty")}</p>
      )}

      {inputs != null && (
        <div style={s.provenance}>
          <div style={s.colLabel}>{t("riskBrief.inputs")}</div>
          <ul style={s.inputList}>
            {inputs.map((input) => {
              const key = statusKey(input.status);
              return (
                <li key={input.id} style={s.inputRow}>
                  <span className="mono" style={s.inputId}>
                    {input.id}
                  </span>
                  <Badge>{key ? t(key) : input.status}</Badge>
                  {input.detail != null && <span style={s.inputDetail}>{input.detail}</span>}
                </li>
              );
            })}
          </ul>
          {/* The brief's own cost, under a label that names the brief. The
              review run's cost lives in the banner under its own label, and the
              two are never summed (AC-70). */}
          <div style={s.costRow}>
            <span>{t("riskBrief.briefCost")}</span>
            <RunCostBadge costUsd={costUsd} />
            {tokensIn != null && (
              <span className="mono">{t("riskBrief.briefTokens", { count: tokensIn })}</span>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * One review-focus item: its reference and its reason, on one line, the reason
 * ALWAYS visible (AC-56).
 *
 * The reference becomes a control only when it names a file this PR changed and
 * the path survives the URL rules — `BriefRef` owns both tests, plus the third
 * that decides whether the jump carries a line.
 */
function FocusRow({
  item,
  refLines,
  linkSha,
  headSha,
  indexMatchesHead,
  changedPaths,
  onOpenFile,
}: {
  item: ReviewFocusItem;
  refLines: RiskBriefRefLine[];
  linkSha: string | null;
  headSha: string | null;
  indexMatchesHead: boolean;
  changedPaths: ReadonlySet<string>;
  onOpenFile: (path: string, line?: number) => void;
}) {
  return (
    <li style={s.focus}>
      <Icon.ChevronRight size={12} style={s.marker} />
      <BriefRef
        as="open"
        refValue={item.ref}
        refLines={refLines}
        linkSha={linkSha}
        headSha={headSha}
        indexMatchesHead={indexMatchesHead}
        changedPaths={changedPaths}
        onOpenFile={onOpenFile}
      />
      <span style={s.reason}>— {item.reason}</span>
    </li>
  );
}
