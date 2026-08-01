/* FindingsCell — the list's FINDINGS column: one count per severity, plus a
   scrollable card on hover/focus listing the findings behind them, each linked
   to its file on GitHub.

   The counts and the worst three findings ride along on the list payload, so the
   column paints and the card opens without a request. Opening it then fetches
   that PR's full review history once, so the card can scroll past those three —
   and it is the same query the detail page reads, so the click that usually
   follows lands on a warm cache.

   The widget itself is shared with the PR timeline's run row; this file is only
   the adapter from `PrMeta` to it. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import {
  FindingsPreview,
  rankFindings,
  type SeverityCount,
} from "@/components/findings-preview";
import { usePrReviews } from "@/lib/hooks";
import type { PrMeta } from "@/lib/types";
import { FINDINGS_FIELDS } from "../../constants";
import { s } from "./styles";

export function FindingsCell({
  pr,
  repoFullName,
}: {
  pr: PrMeta;
  /** `owner/repo`, so each finding in the card can link to its file. */
  repoFullName?: string | null;
}) {
  const t = useTranslations("prReview");

  // Latches on the first open. Re-arming it on close would re-run the query
  // every time the cursor crossed the row.
  const [opened, setOpened] = React.useState(false);
  const handleOpenChange = React.useCallback((open: boolean) => {
    if (open) setOpened(true);
  }, []);
  const { data: reviews } = usePrReviews(opened ? pr.id : null);

  const findings = React.useMemo(
    () =>
      rankFindings(
        reviews ? reviews.flatMap((r) => r.findings) : (pr.findings_top ?? []),
      ),
    [reviews, pr.findings_top],
  );

  const counts: SeverityCount[] = FINDINGS_FIELDS.map(({ sev, field }) => ({
    sev,
    n: pr[field] ?? null,
  }));
  // null everywhere = never reviewed. Zeroes = reviewed and clean. The two are
  // different answers and the column says so.
  const reviewed = counts.some(({ n }) => n != null);
  const total = counts.reduce((sum, { n }) => sum + (n ?? 0), 0);

  if (!reviewed) return <div style={s.neverReviewed}>—</div>;

  return (
    <FindingsPreview
      counts={counts}
      findings={findings}
      header={t("list.findings.total", { count: total })}
      ariaLabel={counts.map(({ sev, n }) => `${n ?? 0} ${sev.toLowerCase()}`).join(", ")}
      repoFullName={repoFullName}
      headSha={pr.head_sha}
      onOpenChange={handleOpenChange}
    />
  );
}

export default FindingsCell;
