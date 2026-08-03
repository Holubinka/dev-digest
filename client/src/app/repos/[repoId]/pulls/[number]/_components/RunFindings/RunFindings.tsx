/* RunFindings — one timeline row's severity readout: counts derived from that
   run's own findings, a scrollable card listing them, and the CI-gate blocker
   chip beside them. The widget is shared with the PR list; this file is the
   adapter from one run's `FindingRecord[]` to it.

   Nothing is capped here. The run's findings are already in memory from
   `GET /pulls/:id/reviews`, so the card can show all of them and let the reader
   scroll — there is no request to save by truncating. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { FindingRecord } from "@devdigest/shared";
import {
  FindingsPreview,
  rankFindings,
  type SeverityCount,
} from "@/components/findings-preview";
// The two modules, not the folder's barrel: this row needs the level list and
// the tally, and the barrel would bring `SeverityFilterBar.tsx` with them.
import { SEVERITY_LEVELS } from "../SeverityFilterBar/constants";
import { countBySeverity } from "../SeverityFilterBar/helpers";
import { s } from "./styles";

export function RunFindings({
  findings,
  blockers,
  repoFullName,
  headSha,
}: {
  /** This run's findings — not the PR's. */
  findings: FindingRecord[];
  /** Findings that trip this agent's CI gate; not a severity bucket. */
  blockers: number | null;
  /** `owner/repo`, so each finding can link to its file. */
  repoFullName?: string | null;
  /** The PR's head sha, so a linked line number still points at the right line. */
  headSha?: string | null;
}) {
  const t = useTranslations("prReview");

  // Reuse the filter bar's tally rather than writing a second one: it drops
  // severities outside the contract, and `SEV` has no fallback for them.
  const counts = React.useMemo(() => countBySeverity(findings), [findings]);
  const ranked = React.useMemo(() => rankFindings(findings), [findings]);

  const chips: SeverityCount[] = SEVERITY_LEVELS.map((sev) => ({ sev, n: counts[sev] }));
  const total = SEVERITY_LEVELS.reduce((sum, sev) => sum + counts[sev], 0);
  const gated = blockers ?? 0;

  const ariaLabel =
    chips.map(({ sev, n }) => `${n ?? 0} ${sev.toLowerCase()}`).join(", ") +
    (gated > 0 ? `, ${gated} blockers` : "");

  return (
    <FindingsPreview
      counts={chips}
      findings={ranked}
      header={t("timeline.findingsInRun", { count: total })}
      ariaLabel={ariaLabel}
      repoFullName={repoFullName}
      headSha={headSha}
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
