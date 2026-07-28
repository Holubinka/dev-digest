/* FindingsCell — the list's FINDINGS column: one count per severity, plus a
   read-only card on hover/focus previewing the worst few findings behind them.
   Everything comes from the list payload, so hovering costs no request. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, SEV, SeverityBadge, CategoryTag, ConfidenceNum, type Severity, type Category } from "@devdigest/ui";
import type { PrMeta } from "@/lib/types";
import { FINDINGS_FIELDS } from "../../constants";
import { lineRef, shortPath } from "./helpers";
import { s } from "./styles";

/** Gap between the row and the card, and the margin kept from the viewport edge. */
const CARD_OFFSET = 8;
const CARD_MARGIN = 12;
/** Rough card height used to decide whether it still fits below the row. */
const CARD_MAX_HEIGHT = 320;

export function FindingsCell({ pr }: { pr: PrMeta }) {
  const t = useTranslations("prReview");
  const [anchor, setAnchor] = React.useState<{ top: number; left: number } | null>(null);

  const counts = FINDINGS_FIELDS.map(({ sev, field }) => ({ sev, n: pr[field] }));
  // null everywhere = never reviewed. Zeroes = reviewed and clean. The two are
  // different answers and the column says so.
  const reviewed = counts.some(({ n }) => n != null);
  const preview = pr.findings_top ?? [];
  const total = counts.reduce((sum, { n }) => sum + (n ?? 0), 0);

  const open = React.useCallback((el: HTMLElement) => {
    if (preview.length === 0) return;
    const r = el.getBoundingClientRect();
    const below = r.bottom + CARD_OFFSET;
    const fitsBelow = below + CARD_MAX_HEIGHT < window.innerHeight;
    setAnchor({
      top: fitsBelow ? below : Math.max(CARD_MARGIN, r.top - CARD_OFFSET - CARD_MAX_HEIGHT),
      left: Math.min(r.left, window.innerWidth - 380 - CARD_MARGIN),
    });
  }, [preview.length]);

  if (!reviewed) return <div style={s.cell}>—</div>;

  return (
    <div
      style={s.cell}
      tabIndex={0}
      aria-label={counts.map(({ sev, n }) => `${n ?? 0} ${sev.toLowerCase()}`).join(", ")}
      onMouseEnter={(e) => open(e.currentTarget)}
      onFocus={(e) => open(e.currentTarget)}
      onMouseLeave={() => setAnchor(null)}
      onBlur={() => setAnchor(null)}
    >
      {counts.map(({ sev, n }) => {
        const meta = SEV[sev];
        const SevIcon = Icon[meta.icon];
        return (
          <span key={sev} style={s.chip(meta.c, !n)}>
            <SevIcon size={13} />
            {n ?? 0}
          </span>
        );
      })}

      {anchor && (
        <div style={s.card(anchor.top, anchor.left)} role="tooltip">
          <div style={s.cardHeader}>
            <Icon.AlertOctagon size={12} />
            {t("list.findings.total", { count: total })}
          </div>
          {preview.map((f, i) => (
            <div key={f.id} style={s.item(i === 0)}>
              <div style={s.itemTitleRow}>
                <SeverityBadge severity={f.severity as Severity} compact />
                <span style={s.itemTitle}>{f.title}</span>
                <CategoryTag category={f.category as Category} />
              </div>
              <div style={s.itemMetaRow}>
                <span className="mono" style={s.itemFile} title={`${f.file}:${lineRef(f.start_line, f.end_line)}`}>
                  <span style={s.itemPath}>{shortPath(f.file)}</span>
                  <span style={s.itemLine}>:{lineRef(f.start_line, f.end_line)}</span>
                </span>
                <span style={s.itemConfidence}>
                  <ConfidenceNum value={f.confidence} />
                </span>
              </div>
              <p style={s.itemRationale}>{f.rationale}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default FindingsCell;
