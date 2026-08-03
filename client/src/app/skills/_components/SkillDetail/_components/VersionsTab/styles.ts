import type { CSSProperties } from "react";

/** Co-located styles for the skill Versions tab. */
export const s = {
  wrap: {
    padding: "20px 28px 40px",
    display: "flex",
    flexDirection: "column",
    gap: 12,
    maxWidth: 900,
  } satisfies CSSProperties,
  h2: { fontSize: 14, fontWeight: 700 } satisfies CSSProperties,
  hint: { fontSize: 13, color: "var(--text-secondary)" } satisfies CSSProperties,
  entry: {
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
    overflow: "hidden",
  } satisfies CSSProperties,
  entryHead: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 14px",
    borderBottom: "1px solid var(--border)",
  } satisfies CSSProperties,
  version: { fontSize: 13, fontWeight: 600 } satisfies CSSProperties,
  when: { marginLeft: "auto", fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  body: {
    margin: 0,
    padding: 14,
    fontSize: 12,
    lineHeight: 1.6,
    whiteSpace: "pre-wrap",
    overflowX: "auto",
  } satisfies CSSProperties,
  empty: { fontSize: 13, color: "var(--text-muted)" } satisfies CSSProperties,
} as const;
