/* FindingsCell — the list's FINDINGS column: one count per severity, plus a
   read-only card on hover/focus previewing the worst few findings behind them.
   Everything comes from the list payload, so hovering costs no request.

   The widget itself is shared with the PR timeline's run row; this file is only
   the adapter from `PrMeta` to it. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { FindingsPreview, type SeverityCount } from "@/components/findings-preview";
import type { PrMeta } from "@/lib/types";
import { FINDINGS_FIELDS } from "../../constants";
import { s } from "./styles";

export function FindingsCell({ pr }: { pr: PrMeta }) {
  const t = useTranslations("prReview");

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
      findings={pr.findings_top ?? []}
      header={t("list.findings.total", { count: total })}
      ariaLabel={counts.map(({ sev, n }) => `${n ?? 0} ${sev.toLowerCase()}`).join(", ")}
    />
  );
}

export default FindingsCell;
