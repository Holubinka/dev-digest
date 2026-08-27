import type { CSSProperties } from "react";

/** Co-located styles for RunReviewDropdown's own popover.

   It draws its own panel rather than reusing the vendored `Dropdown`, so the
   panel chrome below is copied from that primitive on purpose — same elevation,
   border, radius and pop animation, so the control still looks like every other
   menu on the page. */
export const s = {
  root: {
    position: "relative",
    display: "inline-block",
  } satisfies CSSProperties,
  dimmedTrigger: {
    opacity: 0.6,
  } satisfies CSSProperties,
  menu: (width: number): CSSProperties => ({
    position: "absolute",
    top: "calc(100% + 6px)",
    right: 0,
    width,
    background: "var(--bg-elevated)",
    border: "1px solid var(--border-strong)",
    borderRadius: 9,
    boxShadow: "var(--shadow-modal)",
    padding: 6,
    zIndex: 40,
    animation: "ddpop .12s ease",
  }),
  warnRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "8px 10px",
    fontSize: 13,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  warnIcon: {
    color: "var(--warn)",
    flexShrink: 0,
  } satisfies CSSProperties,
  mutedIcon: {
    color: "var(--text-muted)",
    flexShrink: 0,
  } satisfies CSSProperties,
  /** Anchors the fade below. The list itself cannot host it: the fade has to sit
      OVER the last visible card, and an overlay inside a scrolling box scrolls
      away with the content. */
  listWrap: {
    position: "relative",
  } satisfies CSSProperties,
  list: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    maxHeight: 320,
    overflowY: "auto",
    padding: 2,
  } satisfies CSSProperties,
  /**
   * The "there is more below" edge.
   *
   * `maxHeight` on a list of cards whose heights vary with the length of each
   * description will land mid-card, and what showed through the cut was 1px of
   * the NEXT card's coloured top border — which reads as a stray line rather than
   * as a list that continues (screenshot, 2026-08-26). The rows are opaque, so
   * the usual pure-CSS `background-attachment: local` scroll shadow paints behind
   * them and is never seen; this is an overlay on top instead.
   *
   * Rendered ONLY while something is actually below (`moreBelow`), so a picker
   * with two agents has no fade under its last card, and it disappears the moment
   * the reader scrolls to the end. `pointerEvents: none` keeps the card under it
   * clickable.
   */
  listFade: {
    position: "absolute",
    left: 2,
    right: 2,
    bottom: 0,
    height: 24,
    borderRadius: "0 0 7px 7px",
    background: "linear-gradient(transparent, var(--bg-elevated))",
    pointerEvents: "none",
  } satisfies CSSProperties,
  agentRow: (on: boolean, color: string): CSSProperties => ({
    padding: "7px 9px",
    borderRadius: 7,
    borderTop: "1px solid " + (on ? color : "var(--border)"),
    borderRight: "1px solid " + (on ? color : "var(--border)"),
    borderBottom: "1px solid " + (on ? color : "var(--border)"),
    borderLeft: "3px solid " + color,
    background: on ? color + "12" : "var(--bg-surface)",
  }),
  agentLabelRow: {
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
    minWidth: 0,
  } satisfies CSSProperties,
  agentLabel: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    minWidth: 0,
  } satisfies CSSProperties,
  agentNameRow: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    minWidth: 0,
  } satisfies CSSProperties,
  disabledTag: {
    padding: "0 5px",
    borderRadius: 4,
    border: "1px solid var(--border-strong)",
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: "0.02em",
    color: "var(--text-muted)",
    flexShrink: 0,
  } satisfies CSSProperties,
  agentName: {
    fontSize: 13,
    fontWeight: 600,
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  agentHint: {
    fontSize: 11.5,
    lineHeight: 1.45,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  ceilingHint: {
    padding: "6px 10px 2px",
    fontSize: 11.5,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  footer: {
    padding: "8px 4px 4px",
  } satisfies CSSProperties,
  linkRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    width: "100%",
    padding: "8px 10px",
    marginTop: 4,
    borderRadius: 6,
    border: "none",
    borderTop: "1px solid var(--border)",
    background: "transparent",
    color: "var(--text-secondary)",
    fontSize: 13,
    fontWeight: 500,
    fontFamily: "inherit",
    textAlign: "left",
    cursor: "pointer",
  } satisfies CSSProperties,
} as const;
