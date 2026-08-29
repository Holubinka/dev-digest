import type { CSSProperties } from "react";

export const s = {
  form: { display: "flex", flexDirection: "column", gap: 14, padding: "18px 20px" } satisfies CSSProperties,
  row: { display: "flex", gap: 14 } satisfies CSSProperties,
  field: { flex: 1, display: "flex", flexDirection: "column", gap: 6 } satisfies CSSProperties,
  label: { fontSize: 12, fontWeight: 600, color: "var(--text-secondary)" } satisfies CSSProperties,
  error: { fontSize: 12.5, color: "var(--crit)" } satisfies CSSProperties,
  actions: { display: "flex", gap: 10, justifyContent: "flex-end" } satisfies CSSProperties,
} as const;
