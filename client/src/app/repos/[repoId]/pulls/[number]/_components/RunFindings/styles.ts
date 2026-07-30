import type { CSSProperties } from "react";

export const s = {
  /**
   * Blockers is a different axis from severity — it is the agent's CI gate, not
   * a severity bucket — so it sits behind a divider rather than in the row of
   * chips.
   */
  blockers: {
    display: "inline-flex",
    alignItems: "center",
    gap: 3,
    paddingLeft: 10,
    borderLeft: "1px solid var(--border)",
    color: "var(--crit)",
    fontVariantNumeric: "tabular-nums",
  } satisfies CSSProperties,
} as const;
