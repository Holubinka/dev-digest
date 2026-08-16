"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Icon, Skeleton } from "@devdigest/ui";
import type { RiskBriefRefLine } from "@/lib/types";
import type { IntentFreshness, Risk } from "@devdigest/shared";
import { BriefRef } from "./BriefRef";
import { riskChip, riskTone, RISKS_SHOWN } from "./constants";
import { shortSha } from "./helpers";
import { s } from "./styles";

interface RiskAreasProps {
  /** The BRIEF's risks (D18) — never `Intent.risk_areas`. `null` = no brief. */
  risks: Risk[] | null;
  riskLevel: string | null;
  refLines: RiskBriefRefLine[];
  linkSha: string | null;
  indexMatchesHead: boolean;
  /** `owner/repo`, or null until the repo loads. No repo, no github.com link. */
  repoFullName: string | null;
  intentFreshness: IntentFreshness | null;
  /** `null` means there was no intent at all, which is not an age to report. */
  intentComputedAt: string | null;
  /** The brief is being computed or fetched. The section stays, the rows wait. */
  isLoading: boolean;
}

/**
 * RISK AREAS — the brief's `risks[]`, inside the INTENT area.
 *
 * It is fed by the BRIEF, not by `Intent.risk_areas` (D18), which is why it
 * renders in every one of INTENT's states including "no intent derived": its
 * producer is a different derivation, and a section that vanished with the
 * intent would be reporting the wrong thing's absence (R33).
 *
 * Presentational. `OverviewTab` owns the query and hands the fields down, the
 * same way it does for `IntentCard` — a section that fetched on mount would
 * fetch again in every state its parent re-renders in.
 *
 * EVERY model-written string below is rendered as `{value}`. No `<Markdown>`,
 * no `dangerouslySetInnerHTML` — the PR body two blocks away in the same tab
 * uses the former, and this is exactly where that would become stored XSS.
 */
export function RiskAreas({
  risks,
  riskLevel,
  refLines,
  linkSha,
  indexMatchesHead,
  repoFullName,
  intentFreshness,
  intentComputedAt,
  isLoading,
}: RiskAreasProps) {
  const t = useTranslations("brief");

  if (isLoading) {
    return (
      <section style={s.section}>
        <Heading />
        <Skeleton height={14} style={s.skeletonRow} />
        <Skeleton width="60%" height={12} />
      </section>
    );
  }

  // No brief for this head — or one that failed. The banner above carries the
  // reason; repeating it here would put the same sentence on screen twice.
  if (risks == null) {
    return (
      <section style={s.section}>
        <Heading />
        <p style={s.note}>{t("riskBrief.sectionUnavailable")}</p>
      </section>
    );
  }

  const tone = riskTone(riskLevel ?? "");
  const shown = risks.slice(0, RISKS_SHOWN);
  const hidden = risks.slice(RISKS_SHOWN);

  return (
    <section style={s.section}>
      <div style={s.headRow}>
        <Heading />
        {/* The WORD, not the colour alone (AC-4). */}
        {riskLevel != null && (
          <Badge color={tone.color} bg={tone.bg} icon={tone.icon}>
            {riskLevel}
          </Badge>
        )}
        {/* No risks is a sentence beside the level, not an empty list (AC-11). */}
        {risks.length === 0 && <span style={s.note}>{t("noRisks")}</span>}
      </div>

      {/* Three-valued, and all three branch. `unknown` is what an absent commit
          date produces, and rendering it as `fresh` would report a freshness the
          system does not have. `unknown` with no intent at all says nothing here
          — the provenance block under REVIEW FOCUS already reports the intent as
          missing. */}
      {intentFreshness === "stale" && <p style={s.hint}>{t("riskBrief.intentStale")}</p>}
      {intentFreshness === "unknown" && intentComputedAt != null && (
        <p style={s.hint}>{t("riskBrief.intentAgeUnknown")}</p>
      )}

      {/* The risks rest on the index at `link_sha`, not on the head. The note
          sits on the SECTION, which is the other half of R16: no reference below
          shows a line either, and this says why. */}
      {!indexMatchesHead && linkSha != null && (
        <p style={s.hint}>{t("riskBrief.staleIndex", { sha: shortSha(linkSha) })}</p>
      )}

      {risks.length > 0 && (
        <>
          <ul style={s.list}>
            {/* In the order the server sent. It sorts high → medium → low and
                keeps the model's order inside a level; re-sorting here would be
                a second, drifting implementation of AC-12. */}
            {shown.map((risk, i) => (
              <RiskRow
                key={`${risk.title}-${i}`}
                risk={risk}
                refLines={refLines}
                linkSha={linkSha}
                indexMatchesHead={indexMatchesHead}
                repoFullName={repoFullName}
              />
            ))}
          </ul>
          {/* The truncation is never silent: the count of what is NOT on screen
              is the disclosure's own label. */}
          {hidden.length > 0 && (
            <details className="dd-brief-disclosure">
              <summary style={s.more}>{t("riskBrief.moreRisks", { count: hidden.length })}</summary>
              <ul style={s.moreList}>
                {hidden.map((risk, i) => (
                  <RiskRow
                    key={`${risk.title}-${RISKS_SHOWN + i}`}
                    risk={risk}
                    refLines={refLines}
                    linkSha={linkSha}
                    indexMatchesHead={indexMatchesHead}
                    repoFullName={repoFullName}
                  />
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </section>
  );
}

/** The section's own label, identical in every state so none reads as another. */
function Heading() {
  const t = useTranslations("brief");
  return (
    <div style={s.colLabel}>
      <Icon.AlertTriangle size={12} />
      {t("riskBrief.riskAreas")}
    </div>
  );
}

/**
 * One risk: an icon from a finite dictionary, the level as a word, the title and
 * the references — all of them always on screen — with the explanation behind a
 * native `<details>`, which is keyboard-reachable without a line of JavaScript
 * (AC-54).
 *
 * The references sit OUTSIDE the disclosure deliberately: a `<summary>` holding
 * a link nests one control inside another, and AC-54 wants them visible while
 * the row is collapsed either way.
 */
function RiskRow({
  risk,
  refLines,
  linkSha,
  indexMatchesHead,
  repoFullName,
}: {
  risk: Risk;
  refLines: RiskBriefRefLine[];
  /**
   * The commit the references belong to — never `head_sha`. Null when the index
   * knows no commit, in which case every reference degrades to plain text:
   * there is no commit at which these paths are true, and a link to the head
   * would open the wrong file rather than no file.
   */
  linkSha: string | null;
  indexMatchesHead: boolean;
  repoFullName: string | null;
}) {
  // `Risk.kind` is `z.string()` from a model and `src/lib/api.ts` validates
  // nothing, so the dictionary is ordered rules with an explicit fallback: an
  // unknown kind gets the fallback icon, never an empty slot or a shifted row
  // (AC-53).
  const chip = riskChip(risk.kind);
  const KindIcon = Icon[chip.icon];
  const tone = riskTone(risk.severity);

  return (
    <li style={s.risk}>
      <details className="dd-brief-disclosure">
        <summary style={s.summary}>
          <KindIcon size={14} style={{ color: chip.color, flexShrink: 0 }} />
          <Badge color={tone.color} bg={tone.bg}>
            {risk.severity}
          </Badge>
          <span style={s.riskTitle}>{risk.title}</span>
          <Icon.ChevronDown size={14} style={s.chevron} />
        </summary>
        <p style={s.explanation}>{risk.explanation}</p>
      </details>
      {risk.file_refs.length > 0 && (
        <div style={s.refRow}>
          {risk.file_refs.map((ref, i) => (
            <BriefRef
              key={`${ref}-${i}`}
              as="link"
              refValue={ref}
              refLines={refLines}
              linkSha={linkSha}
              indexMatchesHead={indexMatchesHead}
              repoFullName={repoFullName}
            />
          ))}
        </div>
      )}
    </li>
  );
}
