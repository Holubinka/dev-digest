import type { CSSProperties } from "react";

export const s = {
  /** `color + "1f"` is a 12% alpha suffix on a 6-digit hex — the reason
      `agentColor` returns hex rather than a `var(--…)` a suffix cannot extend. */
  square: (size: number, color: string): CSSProperties => ({
    width: size,
    height: size,
    borderRadius: 8,
    display: "grid",
    placeItems: "center",
    flexShrink: 0,
    background: color + "1f",
    color,
    fontSize: Math.round(size * 0.45),
    fontWeight: 700,
    lineHeight: 1,
    userSelect: "none",
  }),
} as const;
