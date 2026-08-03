import type { CSSProperties } from "react";

/** Co-located styles for the body editor's header bar. */
export const s = {
  wrap: { display: "flex", flexDirection: "column" } satisfies CSSProperties,
  bar: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 12px",
    borderRadius: "7px 7px 0 0",
    border: "1px solid var(--border-strong)",
    borderBottom: "none",
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
  barIcon: { color: "var(--text-muted)", flexShrink: 0 } satisfies CSSProperties,
  filename: { fontSize: 12, color: "var(--text-secondary)" } satisfies CSSProperties,
  tokens: { marginLeft: "auto", fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
} as const;
