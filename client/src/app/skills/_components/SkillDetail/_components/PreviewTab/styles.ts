import type { CSSProperties } from "react";

/** Co-located styles for the skill Preview tab. */
export const s = {
  wrap: {
    padding: "20px 28px 40px",
    display: "flex",
    flexDirection: "column",
    gap: 24,
    maxWidth: 900,
  } satisfies CSSProperties,
  section: { display: "flex", flexDirection: "column", gap: 8 } satisfies CSSProperties,
  h2: { fontSize: 14, fontWeight: 700 } satisfies CSSProperties,
  hint: { fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.5 } satisfies CSSProperties,
  rendered: {
    padding: 16,
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  block: {
    padding: 16,
    borderRadius: 8,
    border: "1px solid var(--accent)",
    background: "var(--code-bg)",
    fontSize: 12,
    lineHeight: 1.6,
    whiteSpace: "pre-wrap",
    overflowX: "auto",
  } satisfies CSSProperties,
  empty: { padding: "28px", fontSize: 13, color: "var(--text-muted)" } satisfies CSSProperties,
} as const;
