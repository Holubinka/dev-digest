/* FindingsPreview — severity counts with a card previewing the findings behind
   them, opened on hover or keyboard focus.

   Presentational on purpose: it takes already-translated strings and an
   already-ordered list, so the PR list (PrMeta columns) and the timeline's run
   row (one run's FindingRecords) can both drive it without the component
   knowing either shape.

   The card is interactive — it scrolls, and every finding links to its file — so
   it has to survive the cursor leaving the chips. The close delay, the
   focus-containment check and the stopped click below are what that costs. */
"use client";

import React from "react";
import {
  Icon,
  SEV,
  CategoryTag,
  ConfidenceNum,
  type Severity,
  type Category,
} from "@devdigest/ui";
import type { ListFinding } from "@devdigest/shared";
import { FindingSeverityBadge } from "@/components/severity-badge";
import { githubBlobUrl } from "@/lib/github-urls";
import { FileRef } from "./FileRef";
import { CARD_MAX_HEIGHT, CARD_WIDTH, s } from "./styles";

/** Gap between the trigger and the card, and the margin kept from the viewport edge. */
const CARD_OFFSET = 8;
const CARD_MARGIN = 12;

/** Grace period for crossing the CARD_OFFSET gap from the chips into the card. */
const CLOSE_DELAY_MS = 150;

/** Findings rendered at once, and how many more each extension adds. */
export const PAGE_SIZE = 10;
/**
 * Roughly two items' worth of pixels. The window extends while the 8th is still
 * on screen, so the list never visibly bottoms out before it grows.
 */
const LOAD_MORE_PX = 160;

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
  repoFullName,
  headSha,
  onOpenChange,
}: {
  /** Worst severity first — the array order is the render order. */
  counts: SeverityCount[];
  /** Already ordered by the caller. Empty means no card opens. */
  findings: ListFinding[];
  /** Card header, already translated. */
  header: string;
  /** Group label for screen readers, already translated. */
  ariaLabel: string;
  /** Rendered after the chips — the run row puts its blockers chip here. */
  extra?: React.ReactNode;
  /** `owner/repo`. With `headSha`, every citation becomes a link to the file. */
  repoFullName?: string | null;
  /** The PR's head sha, so a linked line number still points at the right line. */
  headSha?: string | null;
  /** Fires when the card opens or closes — callers load the rest of the findings
      on the first open. Keep the identity stable. */
  onOpenChange?: (open: boolean) => void;
}) {
  const [anchor, setAnchor] = React.useState<{ top: number; left: number } | null>(null);
  const [shown, setShown] = React.useState(PAGE_SIZE);
  const closeTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const cardRef = React.useRef<HTMLDivElement | null>(null);

  const cancelClose = React.useCallback(() => {
    if (closeTimer.current === null) return;
    clearTimeout(closeTimer.current);
    closeTimer.current = null;
  }, []);

  const close = React.useCallback(() => {
    cancelClose();
    setAnchor(null);
    setShown(PAGE_SIZE);
  }, [cancelClose]);

  const closeSoon = React.useCallback(() => {
    cancelClose();
    closeTimer.current = setTimeout(close, CLOSE_DELAY_MS);
  }, [cancelClose, close]);

  const open = React.useCallback(
    (el: HTMLElement) => {
      cancelClose();
      if (findings.length === 0) return;
      const r = el.getBoundingClientRect();
      const below = r.bottom + CARD_OFFSET;
      const fitsBelow = below + CARD_MAX_HEIGHT < window.innerHeight;
      setAnchor({
        top: fitsBelow ? below : Math.max(CARD_MARGIN, r.top - CARD_OFFSET - CARD_MAX_HEIGHT),
        left: Math.min(r.left, window.innerWidth - CARD_WIDTH - CARD_MARGIN),
      });
    },
    [cancelClose, findings.length],
  );

  React.useEffect(() => cancelClose, [cancelClose]);

  const isOpen = anchor !== null;
  React.useEffect(() => {
    onOpenChange?.(isOpen);
  }, [isOpen, onOpenChange]);

  React.useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    // The card is position:fixed, so a page scroll would leave it floating beside
    // a row that has moved on. Scrolling inside the card is the whole point of
    // it, though, so those events are not the page's.
    //
    // The instanceof guard is not ceremony: a scroll event dispatched straight
    // at `window` has a non-Node target, and `Node.contains` throws on one —
    // which would abort the handler and strand the card open.
    const onScroll = (e: Event) => {
      const target = e.target;
      if (target instanceof Node && cardRef.current?.contains(target)) return;
      close();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", close);
    };
  }, [isOpen, close]);

  const extend = (el: HTMLElement) => {
    if (el.scrollTop + el.clientHeight < el.scrollHeight - LOAD_MORE_PX) return;
    setShown((n) => (n < findings.length ? n + PAGE_SIZE : n));
  };

  const canLink = Boolean(repoFullName && headSha);
  const visible = findings.slice(0, shown);

  return (
    <div
      style={s.cell}
      tabIndex={0}
      aria-label={ariaLabel}
      onMouseEnter={(e) => open(e.currentTarget)}
      onFocus={(e) => open(e.currentTarget)}
      onMouseLeave={closeSoon}
      // Tabbing into a link inside the card keeps focus in the subtree; only a
      // real exit closes it.
      onBlur={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        close();
      }}
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
        <div
          ref={cardRef}
          style={s.card(anchor.top, anchor.left)}
          onMouseEnter={cancelClose}
          onMouseLeave={closeSoon}
          // The PR list row navigates on click; the card sits inside it.
          onClick={(e) => e.stopPropagation()}
        >
          <div style={s.cardHeader}>
            <Icon.AlertOctagon size={12} />
            {header}
          </div>
          <div style={s.cardBody} role="list" onScroll={(e) => extend(e.currentTarget)}>
            {visible.map((f, i) => (
              <div key={f.id} style={s.item(i === 0)} role="listitem">
                <div style={s.itemTitleRow}>
                  {/* `ListFinding.severity` is plain `string` — the column is
                      `text`. `SeverityBadge` has no fallback, so a cast here
                      would be a widening one wearing a narrowing shape. */}
                  <FindingSeverityBadge severity={f.severity} compact />
                  <span style={s.itemTitle}>{f.title}</span>
                  <CategoryTag category={f.category as Category} />
                </div>
                <div style={s.itemMetaRow}>
                  <FileRef
                    file={f.file}
                    startLine={f.start_line}
                    endLine={f.end_line}
                    href={
                      canLink
                        ? githubBlobUrl(repoFullName!, headSha!, f.file, f.start_line, f.end_line)
                        : undefined
                    }
                  />
                  <span style={s.itemConfidence}>
                    <ConfidenceNum value={f.confidence} />
                  </span>
                </div>
                <p style={s.itemRationale}>{f.rationale}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default FindingsPreview;
