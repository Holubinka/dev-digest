import type { CSSProperties } from "react";

/**
 * Co-located styles for the compare-runs modal.
 *
 * `grid-template-columns` for the four tiles is declared ONLY in
 * `app/globals.css` under `.dd-eval-compare-tiles`: an inline style beats a
 * media query whatever the selector, so leaving it here would stop the row
 * responding at 680px with every gate still green.
 */
export const s = {
  body: { padding: "20px 24px 24px" } satisfies CSSProperties,
  tiles: { display: "grid", gap: 12, marginBottom: 24 } satisfies CSSProperties,
  tile: {
    borderRadius: 9,
    border: "1px solid var(--border)",
    background: "var(--bg-surface)",
    padding: "14px 16px",
  } satisfies CSSProperties,
  tileLabel: {
    fontSize: 10.5,
    fontWeight: 700,
    letterSpacing: "0.08em",
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  tileRow: {
    display: "flex",
    alignItems: "baseline",
    gap: 8,
    marginTop: 10,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  tileOld: { fontSize: 15, color: "var(--text-muted)" } satisfies CSSProperties,
  tileArrow: { fontSize: 13, color: "var(--text-muted)" } satisfies CSSProperties,
  tileNew: (color: string): CSSProperties => ({ fontSize: 24, fontWeight: 700, color }),
  tileDelta: (color: string): CSSProperties => ({
    display: "inline-flex",
    alignItems: "center",
    gap: 3,
    fontSize: 12.5,
    fontWeight: 600,
    color,
  }),
  warning: {
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
    padding: "12px 14px",
    borderRadius: 8,
    border: "1px solid var(--warn)",
    fontSize: 13,
    lineHeight: 1.5,
    color: "var(--text-primary)",
    marginBottom: 20,
  } satisfies CSSProperties,
  legend: {
    display: "flex",
    gap: 18,
    fontSize: 12.5,
    color: "var(--text-secondary)",
    marginBottom: 10,
  } satisfies CSSProperties,
  legendItem: { display: "inline-flex", alignItems: "center", gap: 7 } satisfies CSSProperties,
  legendSwatch: (color: string): CSSProperties => ({
    width: 10,
    height: 10,
    borderRadius: 3,
    background: color,
  }),
  promptBox: {
    borderRadius: 9,
    border: "1px solid var(--border)",
    background: "var(--bg-surface)",
    padding: "14px 16px",
    maxHeight: 300,
    overflow: "auto",
  } satisfies CSSProperties,
  promptLine: (changed: boolean): CSSProperties => ({
    display: "block",
    fontSize: 12.5,
    lineHeight: 1.7,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    color: "var(--text-secondary)",
    background: changed ? "var(--ok-bg, rgba(52,199,123,0.14))" : "transparent",
    borderRadius: changed ? 3 : 0,
  }),
  unchanged: {
    fontSize: 13.5,
    lineHeight: 1.6,
    color: "var(--text-secondary)",
    padding: "14px 16px",
    borderRadius: 9,
    border: "1px dashed var(--border-strong)",
  } satisfies CSSProperties,
  promoted: {
    fontSize: 13,
    lineHeight: 1.5,
    color: "var(--ok)",
    marginTop: 14,
  } satisfies CSSProperties,
  footer: { display: "flex", gap: 8 } satisfies CSSProperties,
  loading: { padding: 28, fontSize: 13, color: "var(--text-muted)" } satisfies CSSProperties,
} as const;
