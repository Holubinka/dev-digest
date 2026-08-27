import type { CSSProperties } from "react";

/** Co-located styles for the Export Wizard's modal chrome. */
export const s = {
  steps: { padding: "18px 20px", borderBottom: "1px solid var(--border)" } satisfies CSSProperties,
  body: { padding: 20 } satisfies CSSProperties,
  footer: { display: "flex", alignItems: "center" } satisfies CSSProperties,
  footerRight: { marginLeft: "auto" } satisfies CSSProperties,
} as const;
