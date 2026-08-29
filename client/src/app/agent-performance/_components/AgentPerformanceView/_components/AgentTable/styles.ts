import type { CSSProperties } from "react";

/** The seven-column grid the mockup draws; `.dd-perf-table` owns the responsive half. */
export const GRID = "minmax(180px, 2fr) 90px 100px 100px 130px 100px 64px";

export const s = {
  /** Seven columns do not fit a phone. The TABLE scrolls sideways, never the
   *  page — the root `AGENTS.md` rule for wide content. Nothing here is
   *  breakpoint-dependent, so it stays inline. */
  scroller: { marginTop: 22, overflowX: "auto" } satisfies CSSProperties,
  table: {
    minWidth: 780,
    background: "var(--bg-elevated)",
    border: "1px solid var(--border)",
    borderRadius: 9,
    overflow: "hidden",
  } satisfies CSSProperties,
  head: {
    display: "grid",
    gridTemplateColumns: GRID,
    alignItems: "center",
    gap: 12,
    padding: "12px 18px",
    borderBottom: "1px solid var(--border)",
  } satisfies CSSProperties,
  th: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    background: "none",
    border: "none",
    padding: 0,
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: "0.05em",
    color: "var(--text-muted)",
    cursor: "pointer",
    textAlign: "left",
  } satisfies CSSProperties,
  thNumeric: { justifyContent: "flex-end" } satisfies CSSProperties,
  thActive: { color: "var(--text-primary)" } satisfies CSSProperties,
  row: {
    display: "grid",
    gridTemplateColumns: GRID,
    alignItems: "center",
    gap: 12,
    width: "100%",
    padding: "14px 18px",
    background: "none",
    border: "none",
    borderTop: "1px solid var(--border)",
    color: "inherit",
    textAlign: "left",
    cursor: "pointer",
    font: "inherit",
  } satisfies CSSProperties,
  agentCell: { display: "flex", alignItems: "center", gap: 12, minWidth: 0 } satisfies CSSProperties,
  swatch: {
    width: 28,
    height: 28,
    borderRadius: 7,
    display: "grid",
    placeItems: "center",
    flexShrink: 0,
  } satisfies CSSProperties,
  name: {
    fontSize: 14,
    fontWeight: 600,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  num: { fontSize: 13.5, textAlign: "right" } satisfies CSSProperties,
  muted: { fontSize: 13, color: "var(--text-muted)" } satisfies CSSProperties,
  accept: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 6,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  acceptOf: { fontSize: 11.5, color: "var(--text-muted)" } satisfies CSSProperties,
  view: { fontSize: 13, color: "var(--text-secondary)", textAlign: "right" } satisfies CSSProperties,
} as const;
