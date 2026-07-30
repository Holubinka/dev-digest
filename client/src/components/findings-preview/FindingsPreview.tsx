/* FindingsPreview — severity counts with a read-only card previewing the worst
   findings behind them, opened on hover or keyboard focus.

   Presentational on purpose: it takes already-translated strings and an
   already-ordered, already-capped list, so the PR list (PrMeta columns) and the
   timeline's run row (one run's FindingRecords) can both drive it without the
   component knowing either shape. */
"use client";

import React from "react";
import {
  Icon,
  SEV,
  SeverityBadge,
  CategoryTag,
  ConfidenceNum,
  type Severity,
  type Category,
} from "@devdigest/ui";
import type { ListFinding } from "@devdigest/shared";
import { lineRef, shortPath } from "./helpers";
import { CARD_WIDTH, s } from "./styles";

/** Gap between the trigger and the card, and the margin kept from the viewport edge. */
const CARD_OFFSET = 8;
const CARD_MARGIN = 12;
/** Rough card height used to decide whether it still fits below the trigger. */
const CARD_MAX_HEIGHT = 320;

export interface SeverityCount {
  sev: Severity;
  /** Rendered as 0 when null — callers that mean "no data" render something else. */
  n: number | null;
}

export function FindingsPreview({
  counts,
  findings,
  header,
  ariaLabel,
  extra,
}: {
  /** Worst severity first — the array order is the render order. */
  counts: SeverityCount[];
  /** Already ordered and capped by the caller. Empty means no card opens. */
  findings: ListFinding[];
  /** Card header, already translated. */
  header: string;
  /** Group label for screen readers, already translated. */
  ariaLabel: string;
  /** Rendered after the chips — the run row puts its blockers chip here. */
  extra?: React.ReactNode;
}) {
  const [anchor, setAnchor] = React.useState<{ top: number; left: number } | null>(null);

  const open = React.useCallback(
    (el: HTMLElement) => {
      if (findings.length === 0) return;
      const r = el.getBoundingClientRect();
      const below = r.bottom + CARD_OFFSET;
      const fitsBelow = below + CARD_MAX_HEIGHT < window.innerHeight;
      setAnchor({
        top: fitsBelow ? below : Math.max(CARD_MARGIN, r.top - CARD_OFFSET - CARD_MAX_HEIGHT),
        left: Math.min(r.left, window.innerWidth - CARD_WIDTH - CARD_MARGIN),
      });
    },
    [findings.length],
  );

  return (
    <div
      style={s.cell}
      tabIndex={0}
      aria-label={ariaLabel}
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
      {extra}

      {anchor && (
        <div style={s.card(anchor.top, anchor.left)} role="tooltip">
          <div style={s.cardHeader}>
            <Icon.AlertOctagon size={12} />
            {header}
          </div>
          {findings.map((f, i) => (
            <div key={f.id} style={s.item(i === 0)}>
              <div style={s.itemTitleRow}>
                <SeverityBadge severity={f.severity as Severity} compact />
                <span style={s.itemTitle}>{f.title}</span>
                <CategoryTag category={f.category as Category} />
              </div>
              <div style={s.itemMetaRow}>
                <span
                  className="mono"
                  style={s.itemFile}
                  title={`${f.file}:${lineRef(f.start_line, f.end_line)}`}
                >
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

export default FindingsPreview;
