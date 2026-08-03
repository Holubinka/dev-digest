/* FindingSeverityBadge — `SeverityBadge` reads `SEV[severity].icon` with no
   fallback and `findings.severity` is a plain `text` column, so one bad row used
   to take the whole route down (INSIGHTS.md). Degrade instead: keep the finding,
   label it with what the database actually holds. */
"use client";

import { Badge, SeverityBadge } from "@devdigest/ui";
import { isKnownSeverity } from "./helpers";

export function FindingSeverityBadge({
  severity,
  compact,
  count,
}: {
  /** `string`, not `Severity`: the column is unconstrained. */
  severity: string;
  compact?: boolean;
  count?: number;
}) {
  if (isKnownSeverity(severity)) {
    return <SeverityBadge severity={severity} compact={compact} count={count} />;
  }
  return <Badge color="var(--text-muted)">{severity || "UNKNOWN"}</Badge>;
}
