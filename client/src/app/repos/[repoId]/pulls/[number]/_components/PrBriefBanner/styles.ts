import type { CSSProperties } from "react";

/**
 * Co-located styles for the PR Brief banner. Tokens only — no literal colours.
 *
 * Nothing here declares a property a breakpoint changes. The banner is a SIBLING
 * of `.dd-overview-cards`, not a child of it, so document order already puts it
 * first when the page goes to one column — and an inline style would beat any
 * media query anyway (`client/AGENTS.md`).
 */
export const s = {
  /** The never-reviewed banner, in the shape `VerdictBanner` gives the other one. */
  card: {
    display: "flex",
    gap: 18,
    alignItems: "flex-start",
    padding: 18,
    borderRadius: 10,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  iconBox: {
    width: 40,
    height: 40,
    borderRadius: 9,
    display: "grid",
    placeItems: "center",
    background: "var(--bg-hover)",
    color: "var(--text-muted)",
    flexShrink: 0,
  } satisfies CSSProperties,
  main: { flex: 1, minWidth: 0 } satisfies CSSProperties,
  title: {
    fontSize: 16,
    fontWeight: 700,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  colLabel: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.07em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
    marginTop: 10,
  } satisfies CSSProperties,
  /** Model prose. Rendered as `{value}`, never through a markdown renderer. */
  prose: {
    margin: "4px 0 0",
    fontSize: 13.5,
    lineHeight: 1.6,
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  /**
   * The card's right-hand column: the empty PR SCORE slot with the recompute
   * action under it — the same corner and the same order `VerdictBanner` uses,
   * so the control does not jump when a review appears for this state.
   */
  aside: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
    gap: 8,
    flexShrink: 0,
  } satisfies CSSProperties,
  scoreCol: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 5,
    flexShrink: 0,
  } satisfies CSSProperties,
  /**
   * The empty PR SCORE slot: the label and an em dash, in the shape the PR list
   * already gives a never-reviewed row (`PRRow.tsx`). `CircularScore` takes a
   * `score: number` and `vendor/ui` is a read-only copy, so the empty state is
   * ours to draw rather than its to gain a prop.
   */
  scoreDash: {
    fontSize: 22,
    fontWeight: 700,
    color: "var(--text-muted)",
    lineHeight: "52px",
  } satisfies CSSProperties,
  scoreLabel: {
    fontSize: 12,
    color: "var(--text-muted)",
    letterSpacing: "0.04em",
  } satisfies CSSProperties,
  /** The brief's own state when a review's summary already fills the prose. */
  briefState: {
    marginTop: 10,
    padding: "10px 14px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
  note: {
    margin: "0 0 4px",
    fontSize: 13,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  hint: {
    margin: "8px 0 0",
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  link: { color: "var(--accent-text)", textDecoration: "underline" } satisfies CSSProperties,
  skeletonRow: { margin: "8px 0" } satisfies CSSProperties,
  actionRow: { marginTop: 10 } satisfies CSSProperties,
} as const;
