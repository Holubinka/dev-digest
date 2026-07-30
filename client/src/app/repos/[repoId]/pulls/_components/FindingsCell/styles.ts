import type { CSSProperties } from "react";

/**
 * The chips and their card now live in `@/components/findings-preview`; what
 * stays here is the one thing that is the column's own business — how a PR
 * nobody has reviewed renders.
 */
export const s = {
  neverReviewed: {
    fontSize: 12.5,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
} as const;
