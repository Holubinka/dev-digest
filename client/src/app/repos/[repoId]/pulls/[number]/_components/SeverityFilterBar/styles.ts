import type { CSSProperties } from "react";

/** Co-located styles for SeverityFilterBar. */
export const s = {
  bar: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
    margin: "0 0 14px",
  } satisfies CSSProperties,
  chip: (color: string, bg: string, active: boolean, empty: boolean): CSSProperties => ({
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "5px 11px",
    borderRadius: 6,
    fontSize: 12,
    fontWeight: 600,
    letterSpacing: "0.04em",
    lineHeight: 1.4,
    whiteSpace: "nowrap",
    color: empty ? "var(--text-muted)" : color,
    background: active ? bg : "transparent",
    border: `1px solid ${active ? color : "var(--border)"}`,
    opacity: empty ? 0.55 : 1,
    cursor: empty ? "default" : "pointer",
    transition: "background .12s, border-color .12s",
  }),
  count: {
    fontVariantNumeric: "tabular-nums",
  } satisfies CSSProperties,
} as const;
