import type { CSSProperties } from "react";

export const s = {
  list: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: 8,
  } satisfies CSSProperties,
  /** A flow's own title, above its rows, only when there is more than one. */
  flowTitle: {
    margin: "14px 0 8px",
    fontSize: 12,
    fontWeight: 600,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  row: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "9px 10px 9px 12px",
    border: "1px solid var(--border)",
    borderRadius: 7,
    background: "var(--bg-primary)",
  } satisfies CSSProperties,
  icon: { color: "var(--text-muted)", flexShrink: 0 } satisfies CSSProperties,
  /** The path and its note share the flexible column; both must be breakable. */
  text: { flex: 1, minWidth: 0, overflowWrap: "break-word", fontSize: 13 } satisfies CSSProperties,
  path: { color: "var(--text-primary)" } satisfies CSSProperties,
  note: { color: "var(--text-muted)" } satisfies CSSProperties,
  /** An anchor, not a button: it opens a new tab, so middle-click must work. */
  open: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "4px 11px",
    borderRadius: 6,
    border: "1px solid var(--border-strong)",
    background: "var(--bg-elevated)",
    color: "var(--text-primary)",
    fontSize: 12.5,
    fontWeight: 500,
    textDecoration: "none",
    whiteSpace: "nowrap",
    flexShrink: 0,
  } satisfies CSSProperties,
  empty: {
    margin: 0,
    fontSize: 13,
    lineHeight: 1.6,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
} as const;
