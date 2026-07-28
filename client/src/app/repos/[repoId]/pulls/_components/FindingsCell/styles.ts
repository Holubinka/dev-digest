import type { CSSProperties } from "react";

/** Co-located styles for the list's FINDINGS cell and its hover card. */
export const s = {
  cell: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    fontSize: 12.5,
    color: "var(--text-secondary)",
    minWidth: 0,
  } satisfies CSSProperties,
  chip: (color: string, empty: boolean): CSSProperties => ({
    display: "inline-flex",
    alignItems: "center",
    gap: 3,
    fontVariantNumeric: "tabular-nums",
    color: empty ? "var(--text-muted)" : color,
    opacity: empty ? 0.5 : 1,
  }),
  // Fixed, not absolute: <main> scrolls with `overflow: auto`, which would clip
  // a card anchored inside the row — most visibly on the last one.
  card: (top: number, left: number): CSSProperties => ({
    position: "fixed",
    top,
    left,
    zIndex: 60,
    width: 380,
    padding: "10px 0 4px",
    borderRadius: 10,
    border: "1px solid var(--border-strong)",
    background: "var(--bg-elevated)",
    boxShadow: "0 12px 32px rgba(0,0,0,.28)",
    pointerEvents: "none",
  }),
  cardHeader: {
    display: "flex",
    alignItems: "center",
    gap: 7,
    padding: "0 14px 8px",
    fontSize: 11.5,
    fontWeight: 700,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  item: (first: boolean): CSSProperties => ({
    padding: "9px 14px",
    borderTop: first ? "none" : "1px solid var(--border)",
  }),
  itemTitleRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    minWidth: 0,
  } satisfies CSSProperties,
  itemTitle: {
    fontSize: 13,
    fontWeight: 600,
    color: "var(--text-primary)",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  } satisfies CSSProperties,
  itemMetaRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    margin: "4px 0 0",
  } satisfies CSSProperties,
  itemRationale: {
    margin: "5px 0 0",
    fontSize: 12,
    lineHeight: 1.45,
    color: "var(--text-secondary)",
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
  } satisfies CSSProperties,
} as const;
