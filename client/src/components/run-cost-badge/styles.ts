import type { CSSProperties } from "react";

/** Co-located styles for RunCostBadge. */
export const s = {
  wrap: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    fontSize: 12,
    color: "var(--text-muted)",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  cost: { color: "var(--text-secondary)" } satisfies CSSProperties,
  sep: { color: "var(--text-muted)" } satisfies CSSProperties,
} as const;
