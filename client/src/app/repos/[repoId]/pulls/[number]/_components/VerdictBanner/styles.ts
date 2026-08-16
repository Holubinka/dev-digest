import type { CSSProperties } from "react";

/** Co-located styles for VerdictBanner (extracted from inline styles). */
export const s = {
  wrap: {
    display: "flex",
    gap: 18,
    alignItems: "flex-start",
    padding: 18,
    borderRadius: 10,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  iconBox: (bg: string, color: string): CSSProperties => ({
    width: 40,
    height: 40,
    borderRadius: 9,
    display: "grid",
    placeItems: "center",
    background: bg,
    color,
    flexShrink: 0,
  }),
  main: { flex: 1, minWidth: 0 } satisfies CSSProperties,
  titleRow: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  label: (color: string): CSSProperties => ({ fontSize: 18, fontWeight: 700, color }),
  summary: {
    fontSize: 14,
    lineHeight: 1.55,
    color: "var(--text-secondary)",
    marginTop: 8,
  } satisfies CSSProperties,
  /** The icon beside the counts. Inline-flex so it sits on the text baseline. */
  countsHint: {
    display: "inline-flex",
    alignItems: "center",
    color: "var(--text-muted)",
    cursor: "help",
  } satisfies CSSProperties,
  /**
   * The card's right-hand column, right-aligned and stacked: the gauge, its
   * label, the action, then the run's cost.
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
  scoreLabel: {
    fontSize: 12,
    color: "var(--text-muted)",
    letterSpacing: "0.04em",
  } satisfies CSSProperties,
} as const;
