import type { CSSProperties } from "react";

export const s = {
  wrap: { padding: 24, maxWidth: 900 } satisfies CSSProperties,
  head: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 16,
  } satisfies CSSProperties,
  h2: { fontSize: 17, fontWeight: 700, letterSpacing: "-0.01em" } satisfies CSSProperties,
  hint: {
    fontSize: 13,
    color: "var(--text-muted)",
    marginTop: 6,
    lineHeight: 1.5,
    maxWidth: 560,
  } satisfies CSSProperties,
  runs: { display: "flex", gap: 22, marginTop: 20, flexWrap: "wrap" } satisfies CSSProperties,
  stat: { display: "flex", flexDirection: "column", gap: 4 } satisfies CSSProperties,
  statLabel: {
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: "0.04em",
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  statValue: { fontSize: 22, fontWeight: 700, letterSpacing: "-0.01em" } satisfies CSSProperties,
  panel: {
    marginTop: 18,
    border: "1px solid var(--border)",
    borderRadius: 9,
    overflow: "hidden",
  } satisfies CSSProperties,
  link: {
    display: "inline-block",
    marginTop: 18,
    fontSize: 13,
    color: "var(--accent)",
  } satisfies CSSProperties,
} as const;
