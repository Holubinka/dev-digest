import type { CSSProperties } from "react";

export const s = {
  list: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: 14,
  } satisfies CSSProperties,
  item: { display: "flex", alignItems: "flex-start", gap: 12 } satisfies CSSProperties,
  /** The mockup's numbered circle. `<ol>` carries the order; this draws it. */
  number: {
    display: "inline-grid",
    placeItems: "center",
    width: 22,
    height: 22,
    flexShrink: 0,
    borderRadius: 99,
    background: "var(--sugg-bg)",
    color: "var(--accent-text)",
    fontSize: 11.5,
    fontWeight: 600,
  } satisfies CSSProperties,
  body: { minWidth: 0 } satisfies CSSProperties,
  reason: {
    margin: "3px 0 0",
    fontSize: 12.5,
    lineHeight: 1.5,
    color: "var(--text-muted)",
    overflowWrap: "break-word",
  } satisfies CSSProperties,
  empty: {
    margin: 0,
    fontSize: 13,
    lineHeight: 1.6,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
} as const;
