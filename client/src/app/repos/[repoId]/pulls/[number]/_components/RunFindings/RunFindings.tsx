/* RunFindings — one timeline row's severity readout: counts derived from that
   run's own findings, a card previewing its worst three, and the CI-gate
   blocker chip beside them. The widget is shared with the PR list; this file is
   the adapter from one run's `FindingRecord[]` to it. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { FindingRecord } from "@devdigest/shared";
import { FindingsPreview, type SeverityCount } from "@/components/findings-preview";
import { SEVERITY_LEVELS, countBySeverity } from "../SeverityFilterBar";
import { RUN_FINDINGS_PREVIEW, topFindings } from "./helpers";
import { s } from "./styles";

export function RunFindings({
  findings,
  blockers,
}: {
  /** This run's findings — not the PR's. */
  findings: FindingRecord[];
  /** Findings that trip this agent's CI gate; not a severity bucket. */
  blockers: number | null;
}) {
  const t = useTranslations("prReview");

  // Reuse the filter bar's tally rather than writing a second one: it drops
  // severities outside the contract, and `SEV` has no fallback for them.
  const counts = React.useMemo(() => countBySeverity(findings), [findings]);
  const preview = React.useMemo(() => topFindings(findings, RUN_FINDINGS_PREVIEW), [findings]);

  const chips: SeverityCount[] = SEVERITY_LEVELS.map((sev) => ({ sev, n: counts[sev] }));
  const total = SEVERITY_LEVELS.reduce((sum, sev) => sum + counts[sev], 0);
  const gated = blockers ?? 0;

  const ariaLabel =
    chips.map(({ sev, n }) => `${n ?? 0} ${sev.toLowerCase()}`).join(", ") +
    (gated > 0 ? `, ${gated} blockers` : "");

  return (
    <FindingsPreview
      counts={chips}
      findings={preview}
      header={t("timeline.findingsInRun", { count: total })}
      ariaLabel={ariaLabel}
      extra={
        gated > 0 ? (
          <span style={s.blockers} title={t("timeline.blockersHint", { count: gated })}>
            <Icon.Shield size={13} />
            {gated}
          </span>
        ) : null
      }
    />
  );
}

export default RunFindings;
