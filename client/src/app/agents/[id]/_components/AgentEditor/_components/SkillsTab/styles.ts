import type { CSSProperties } from "react";

/** Co-located styles for the agent Skills tab. */
export const s = {
  wrap: {
    padding: "20px 28px 40px",
    display: "flex",
    flexDirection: "column",
    gap: 14,
    maxWidth: 860,
  } satisfies CSSProperties,
  header: { display: "flex", alignItems: "center", gap: 12 } satisfies CSSProperties,
  h2: { fontSize: 16, fontWeight: 700 } satisfies CSSProperties,
  filter: {
    marginLeft: "auto",
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "6px 10px",
    borderRadius: 7,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
    width: 200,
  } satisfies CSSProperties,
  filterInput: {
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    background: "transparent",
    border: "none",
    outline: "none",
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  hint: { fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.5 } satisfies CSSProperties,
  /** A bound row reads as active; an unbound one recedes, as in the design. */
  row: (bound: boolean, dragging: boolean): CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "8px 12px",
    borderRadius: 8,
    border: "1px solid " + (bound ? "var(--border-strong)" : "var(--border)"),
    background: dragging
      ? "var(--bg-hover)"
      : bound
        ? "var(--bg-elevated)"
        : "transparent",
    marginBottom: 6,
  }),
  handle: (bound: boolean): CSSProperties => ({
    color: "var(--text-muted)",
    cursor: bound ? "grab" : "default",
    opacity: bound ? 1 : 0.35,
    flexShrink: 0,
  }),
  name: {
    fontSize: 13,
    fontWeight: 600,
    minWidth: 0,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  } satisfies CSSProperties,
  spacer: { marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 } satisfies CSSProperties,
  arrow: (disabled: boolean): CSSProperties => ({
    background: "none",
    border: "1px solid var(--border)",
    borderRadius: 6,
    padding: 3,
    display: "inline-flex",
    cursor: disabled ? "not-allowed" : "pointer",
    color: disabled ? "var(--text-muted)" : "var(--text-secondary)",
    opacity: disabled ? 0.4 : 1,
  }),
  empty: { fontSize: 13, color: "var(--text-muted)" } satisfies CSSProperties,
} as const;
