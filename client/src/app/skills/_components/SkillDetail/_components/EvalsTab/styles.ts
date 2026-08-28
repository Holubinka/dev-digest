import type { CSSProperties } from "react";

/** Co-located styles for the skill's Evals tab. */
export const s = {
  wrap: {
    padding: "20px 28px 40px",
    display: "flex",
    flexDirection: "column",
    gap: 14,
  } satisfies CSSProperties,
  head: { display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" } satisfies CSSProperties,
  h2: { fontSize: 14, fontWeight: 700, margin: 0 } satisfies CSSProperties,
  hint: { fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.5 } satisfies CSSProperties,
  list: { display: "flex", flexDirection: "column", gap: 8 } satisfies CSSProperties,
  row: {
    display: "flex",
    alignItems: "center",
    gap: 14,
    padding: "12px 16px",
    borderRadius: 9,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
    textDecoration: "none",
    color: "inherit",
  } satisfies CSSProperties,
  rowMain: { flex: 1, minWidth: 0 } satisfies CSSProperties,
  nameLine: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" } satisfies CSSProperties,
  name: { fontSize: 14, fontWeight: 600, color: "var(--text-primary)" } satisfies CSSProperties,
  sub: { fontSize: 12.5, color: "var(--text-muted)", marginTop: 3 } satisfies CSSProperties,
  chevron: { color: "var(--text-muted)", flexShrink: 0 } satisfies CSSProperties,
  empty: {
    fontSize: 14,
    color: "var(--text-secondary)",
    lineHeight: 1.6,
    padding: "26px 0 6px",
  } satisfies CSSProperties,
  emptyHint: { fontSize: 13, color: "var(--text-muted)", marginTop: 8 } satisfies CSSProperties,
  loading: { fontSize: 13, color: "var(--text-muted)", padding: "20px 0" } satisfies CSSProperties,
} as const;
