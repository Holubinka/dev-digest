import type { CSSProperties } from "react";

/** Co-located styles for the skill Stats tab. */
export const s = {
  wrap: {
    padding: "20px 28px 40px",
    display: "flex",
    flexDirection: "column",
    gap: 14,
    maxWidth: 900,
  } satisfies CSSProperties,
  h2: { fontSize: 14, fontWeight: 700 } satisfies CSSProperties,
  hint: { fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.5 } satisfies CSSProperties,
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
    gap: 12,
  } satisfies CSSProperties,
  tile: {
    padding: 14,
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  label: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.06em",
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  value: { fontSize: 22, fontWeight: 700, marginTop: 6 } satisfies CSSProperties,
  muted: { fontSize: 13, color: "var(--text-muted)", fontWeight: 400 } satisfies CSSProperties,
  empty: { fontSize: 13, color: "var(--text-muted)" } satisfies CSSProperties,
} as const;
