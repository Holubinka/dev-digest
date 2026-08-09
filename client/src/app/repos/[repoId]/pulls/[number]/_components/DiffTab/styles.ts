import type { CSSProperties } from "react";

/** Co-located styles for DiffTab. */
export const s = {
  actions: { display: "flex", alignItems: "center", gap: 8 } satisfies CSSProperties,
  summary: {
    fontSize: 12.5,
    color: "var(--text-muted)",
    margin: "-4px 0 14px",
  } satisfies CSSProperties,
  added: { color: "var(--code-add-text)" } satisfies CSSProperties,
  deleted: { color: "var(--code-del-text)" } satisfies CSSProperties,
} as const;
