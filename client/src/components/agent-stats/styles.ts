import type { CSSProperties } from "react";

/** Co-located styles for the agent stats panel. */
export const s = {
  panel: {
    display: "flex",
    flexWrap: "wrap",
    gap: 28,
    padding: "16px 18px 18px",
    background: "var(--bg-subtle)",
    borderTop: "1px solid var(--border)",
  } satisfies CSSProperties,
  block: { display: "flex", flexDirection: "column", gap: 6, minWidth: 150 } satisfies CSSProperties,
  blockLabel: {
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: "0.04em",
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  line: { fontSize: 13, color: "var(--text-secondary)" } satisfies CSSProperties,
  strong: { fontSize: 13, color: "var(--text-primary)", fontWeight: 600 } satisfies CSSProperties,
  sev: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" } satisfies CSSProperties,
  note: {
    fontSize: 12,
    color: "var(--text-muted)",
    lineHeight: 1.5,
    width: "100%",
  } satisfies CSSProperties,
} as const;
