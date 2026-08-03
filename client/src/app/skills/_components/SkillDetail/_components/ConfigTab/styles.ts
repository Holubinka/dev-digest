import type { CSSProperties } from "react";

/** Co-located styles for the skill Config tab. */
export const s = {
  wrap: {
    padding: "20px 28px 40px",
    display: "flex",
    flexDirection: "column",
    gap: 16,
    maxWidth: 820,
  } satisfies CSSProperties,
  actions: { display: "flex", alignItems: "center", gap: 12 } satisfies CSSProperties,
} as const;
