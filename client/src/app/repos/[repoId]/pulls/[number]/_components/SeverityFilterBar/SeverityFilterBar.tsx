/* SeverityFilterBar — how bad is this PR, in one row. Counts every finding of
   every run by severity and doubles as the filter: click a level to show only
   its findings, click it again to clear. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, SEV } from "@devdigest/ui";
import type { FindingRecord } from "@devdigest/shared";
import { SEVERITY_LEVELS, type SeverityLevel } from "./constants";
import { countBySeverity } from "./helpers";
import { s } from "./styles";

export function SeverityFilterBar({
  findings,
  active,
  onChange,
}: {
  /** Every finding on the PR, across all runs. */
  findings: FindingRecord[];
  active: SeverityLevel | null;
  /** Called with the level to filter by, or null to clear. */
  onChange: (next: SeverityLevel | null) => void;
}) {
  const t = useTranslations("prReview");
  const counts = React.useMemo(() => countBySeverity(findings), [findings]);

  return (
    <div style={s.bar} role="group" aria-label={t("severityFilter.groupLabel")}>
      {SEVERITY_LEVELS.map((level) => {
        const meta = SEV[level];
        const LevelIcon = Icon[meta.icon];
        const count = counts[level];
        const isActive = active === level;
        return (
          <button
            key={level}
            type="button"
            aria-pressed={isActive}
            disabled={count === 0}
            title={
              isActive
                ? t("severityFilter.clearHint")
                : t("severityFilter.hint", { severity: level })
            }
            onClick={() => onChange(isActive ? null : level)}
            style={s.chip(meta.c, meta.bg, isActive, count === 0)}
          >
            <LevelIcon size={12.5} />
            <span style={s.count}>{count}</span>
            <span>{level}</span>
          </button>
        );
      })}
    </div>
  );
}

export default SeverityFilterBar;
