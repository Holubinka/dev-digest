import type { CSSProperties } from "react";

/* Co-located styles for BlastRadiusCard. Tokens only — no literal colours, and
   no breakpoint: the card sits in `OverviewTab`'s two-column `cardRow`, which
   declares none, and every row here wraps instead of reflowing. A property a
   media query would change belongs in `app/globals.css` keyed on a `dd-` class
   (`client/AGENTS.md`), so if a breakpoint is ever wanted, it goes there — not
   back into this file. */
export const s = {
  /** Same frame as the INTENT card beside it, so the row reads as one pair. */
  card: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
    padding: 18,
  } satisfies CSSProperties,

  statRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: 18,
    marginBottom: 4,
  } satisfies CSSProperties,
  stat: { display: "flex", alignItems: "baseline", gap: 6 } satisfies CSSProperties,
  statValue: {
    fontSize: 18,
    fontWeight: 700,
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  statLabel: {
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
  } satisfies CSSProperties,

  /** `tree | graph`, in the card header. Segmented, so the two read as one control. */
  viewToggle: {
    display: "inline-flex",
    border: "1px solid var(--border)",
    borderRadius: 6,
    overflow: "hidden",
  } satisfies CSSProperties,
  viewBtn: {
    padding: "3px 9px",
    border: "none",
    background: "transparent",
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
    cursor: "pointer",
  } satisfies CSSProperties,
  viewBtnOn: {
    background: "var(--bg-hover)",
    color: "var(--text-primary)",
  } satisfies CSSProperties,

  /** The modal body has no padding of its own (`vendor/ui/kit/Modal.tsx:60`). */
  graphBody: { padding: "16px 24px 22px" } satisfies CSSProperties,

  /** Positioned, so the legend can sit over the canvas rather than under it. */
  graphCanvas: {
    position: "relative",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
    overflow: "hidden",
  } satisfies CSSProperties,

  /** Bottom-left, which is where the reference design puts it. */
  legend: {
    position: "absolute",
    left: 14,
    bottom: 12,
    display: "flex",
    flexDirection: "column",
    gap: 5,
    margin: 0,
    padding: 0,
    listStyle: "none",
    fontSize: 12,
    color: "var(--text-secondary)",
    pointerEvents: "none",
  } satisfies CSSProperties,
  legendItem: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  } satisfies CSSProperties,
  legendDot: {
    width: 9,
    height: 9,
    borderRadius: "50%",
    flexShrink: 0,
  } satisfies CSSProperties,

  /** `partial` / `degraded` is its own visible state, never a shorter list. */
  banner: {
    display: "flex",
    alignItems: "flex-start",
    gap: 8,
    padding: "8px 10px",
    borderRadius: 6,
    marginBottom: 14,
    fontSize: 12.5,
    lineHeight: 1.5,
  } satisfies CSSProperties,
  bannerPartial: {
    color: "var(--warn)",
    background: "var(--warn-bg)",
  } satisfies CSSProperties,
  bannerDegraded: {
    color: "var(--crit)",
    background: "var(--crit-bg)",
  } satisfies CSSProperties,

  /**
   * The one part of this card that grows with the answer, so the one part that
   * is capped. Measured on PR #20 at 1440×1000 (headless Chrome over CDP,
   * `client/INSIGHTS.md:133`): 365 symbols made the list 22 422px and the card
   * 22 617px, beside a 1 719px INTENT — 13× its neighbour, and `main` scrolled
   * 25 108px.
   *
   * The LIST is capped and not the card, because the counters above it are what
   * make the cut honest: "365 symbols" has to stay on screen while the list
   * scrolls, or the reader loses the number that explains the scrollbar.
   *
   * 570 is ten collapsed rows — a row measures 57px, or 75px when the path wraps
   * to a second line. The card's fixed chrome measures 196px (label 26 + stale
   * index note 36 + counters 27 + margins, then a 60px footer), so a capped card
   * is 766px: one screen of `main` (~818px) on the 1512×982pt display this was
   * reported on, with room to spare for the ~49px a `partial` index banner adds.
   * On the four PRs measured, INTENT ran 1507-2040px, so at 766px this card no
   * longer sets the height of the row.
   *
   * No breakpoint changes it, so it stays here rather than in `globals.css`
   * (`client/AGENTS.md`): below 1024px the cards stack full-width and the rows
   * get shorter, not taller, because fewer paths wrap.
   */
  symbolList: {
    marginTop: 14,
    maxHeight: 570,
    overflowY: "auto",
    /* Reaching the end of the list must not hand the scroll on to the page
       behind it — `components/findings-preview/styles.ts:72` for the same
       nested-scroller reason. */
    overscrollBehavior: "contain",
  } satisfies CSSProperties,
  symbol: { borderTop: "1px solid var(--border)", padding: "9px 0" } satisfies CSSProperties,
  /**
   * No `display` override, and that is load-bearing twice over. A `<summary>`
   * loses its native disclosure triangle the moment it is given a `display`
   * other than `list-item` — and laying the three spans out as a flex row put
   * every symbol on three lines instead of one, thirty of them on the demo PR.
   * Inline text already wraps at the spaces between the spans; the only thing
   * missing was permission for the path itself to break, which is on
   * `symbolSite` below.
   */
  disclosure: {
    cursor: "pointer",
    fontSize: 13,
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  symbolName: { fontWeight: 600 } satisfies CSSProperties,
  /**
   * The whole fix at this level. A repository path has no space in it —
   * `server/src/modules/reviews/run-executor.ts:184` is one unbreakable word —
   * so once the Overview columns were allowed to shrink below their content,
   * this span was what ran past the card edge.
   *
   * `break-word`, not `anywhere`: `anywhere` splits the path at whatever column
   * the line happens to end on, which left `helpers.ts:` on one line and `82` on
   * the next. `break-word` moves the whole path down first and only breaks it
   * when it still cannot fit.
   */
  symbolSite: {
    display: "block",
    fontSize: 12,
    color: "var(--text-muted)",
    overflowWrap: "break-word",
  } satisfies CSSProperties,
  callerCount: {
    marginLeft: 8,
    fontSize: 12,
    color: "var(--text-secondary)",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,

  callerList: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    margin: "8px 0 0",
    padding: "0 0 0 18px",
    listStyle: "none",
  } satisfies CSSProperties,
  callerRow: {
    display: "flex",
    alignItems: "baseline",
    flexWrap: "wrap",
    gap: 8,
  } satisfies CSSProperties,
  callerSymbol: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  /** A caller whose link cannot be built renders as text, never as a dead link. */
  callerPlain: {
    fontSize: 13,
    color: "var(--text-secondary)",
    overflowWrap: "break-word",
  } satisfies CSSProperties,

  chipRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
    margin: "8px 0 0 18px",
  } satisfies CSSProperties,

  summary: {
    margin: "14px 0 0",
    padding: "10px 12px",
    borderRadius: 6,
    background: "var(--bg-hover)",
    fontSize: 13,
    lineHeight: 1.6,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,

  footer: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 12,
    marginTop: 14,
  } satisfies CSSProperties,
  note: {
    margin: "0 0 4px",
    fontSize: 13,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  hint: { margin: "8px 0 0", fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  skeletonRow: { marginBottom: 10 } satisfies CSSProperties,
} as const;
