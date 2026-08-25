/* FindingCard — ported from findings.jsx (createElement → TSX).
   Severity icon+label, category, file:line, confidence, markdown rationale +
   suggestion, accept/dismiss actions. Accept/dismiss reflect persisted
   timestamps. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, MonoLink, ConfidenceNum, Button, Markdown } from "@devdigest/ui";
import type { FindingRecord, FindingActionKind } from "@devdigest/shared";
import { FindingSeverityBadge, severityColor } from "@/components/severity-badge";
import { FindingCategoryTag } from "@/components/category-tag";
import { lineLabel } from "./helpers";
import { githubBlobUrl } from "@/lib/github-urls";
import { s } from "./styles";

export function FindingCard({
  f,
  focused,
  defaultExpanded,
  onAction,
  pending,
  repoFullName,
  headSha,
  onTurnIntoEvalCase,
  evalCasePending,
}: {
  f: FindingRecord;
  focused?: boolean;
  defaultExpanded?: boolean;
  onAction?: (action: FindingActionKind, reply?: string) => void;
  pending?: boolean;
  repoFullName?: string | null;
  headSha?: string | null;
  /**
   * Turn this finding into an eval case (SPEC-05 AC-1/AC-2). A SEPARATE prop
   * rather than a third `FindingActionKind`: that enum lives in
   * `vendor/shared/contracts/findings.ts`, is vendored twice, and widening it
   * would drag both copies into this feature's diff for a control that writes
   * to a different table than accept/dismiss do.
   */
  onTurnIntoEvalCase?: () => void;
  evalCasePending?: boolean;
}) {
  const t = useTranslations("prReview");
  const [expanded, setExpanded] = React.useState(defaultExpanded ?? false);
  const sevColor = severityColor(f.severity);
  const fileHref =
    repoFullName && headSha
      ? githubBlobUrl(repoFullName, headSha, f.file, f.start_line, f.end_line)
      : undefined;
  const accepted = !!f.accepted_at;
  const dismissed = !!f.dismissed_at;
  const muted = accepted || dismissed;
  // The decision IS the expectation's polarity — accepted → must_find,
  // dismissed → must_not_flag — so an undecided finding has nothing to make a
  // case out of (AC-3, spec D12).
  const decided = accepted || dismissed;

  return (
    <div data-finding-id={f.id} style={s.card(!!focused, sevColor, muted)}>
      <div onClick={() => setExpanded((e) => !e)} style={s.header}>
        <div style={s.badgeWrap}>
          <FindingSeverityBadge severity={f.severity} compact />
        </div>
        <div style={s.headerMain}>
          <div style={s.titleRow}>
            <span style={s.title(muted, dismissed)}>{f.title}</span>
            <FindingCategoryTag category={f.category} />
            {accepted && <span style={s.acceptedTag}>{t("finding.accepted")}</span>}
            {dismissed && <span style={s.dismissedTag}>{t("finding.dismissed")}</span>}
          </div>
          <div style={s.metaRow}>
            <MonoLink href={fileHref}>
              {f.file}:{lineLabel(f)}
            </MonoLink>
            <ConfidenceNum value={f.confidence} />
          </div>
        </div>
        <Icon.ChevronDown size={16} style={s.chevron(expanded)} />
      </div>

      {expanded && (
        <div style={s.body}>
          <div style={s.prose}>
            <Markdown>{f.rationale}</Markdown>
          </div>
          {f.suggestion && (
            <div style={s.suggestionWrap}>
              <div style={s.suggestionLabel}>{t("finding.suggestedFix")}</div>
              <div style={s.prose}>
                <Markdown>{f.suggestion}</Markdown>
              </div>
            </div>
          )}

          <div style={s.actions}>
            <Button
              kind="secondary"
              size="sm"
              icon="Check"
              disabled={pending}
              active={accepted}
              onClick={() => onAction?.("accept")}
            >
              {t("finding.accept")}
            </Button>
            <Button
              kind="ghost"
              size="sm"
              icon="X"
              disabled={pending}
              active={dismissed}
              onClick={() => onAction?.("dismiss")}
            >
              {t("finding.dismiss")}
            </Button>
            {onTurnIntoEvalCase && (
              /* Rendered DISABLED with the reason, never hidden (AC-3). A
                 button that vanishes teaches nothing; this one says why it is
                 inert, and says it in the accessible name so a screen reader
                 gets the same sentence a tooltip gives a mouse. */
              <Button
                kind="secondary"
                size="sm"
                icon="FlaskConical"
                disabled={!decided}
                loading={evalCasePending}
                aria-label={decided ? undefined : t("finding.turnIntoEvalCaseNeedsDecision")}
                title={
                  decided
                    ? t("finding.turnIntoEvalCase")
                    : t("finding.turnIntoEvalCaseNeedsDecision")
                }
                onClick={() => onTurnIntoEvalCase()}
              >
                {evalCasePending
                  ? t("finding.turnIntoEvalCaseBusy")
                  : t("finding.turnIntoEvalCase")}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
