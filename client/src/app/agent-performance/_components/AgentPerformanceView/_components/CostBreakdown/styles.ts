import type { CSSProperties } from "react";

export const s = {
  /** `flexDirection` is NOT here: `.dd-perf-cost` in globals.css stacks these
   *  on a narrow screen, and an inline value would beat the media query. */
  row: { display: "flex", gap: 18, marginTop: 14 } satisfies CSSProperties,
  card: {
    flex: 1,
    minWidth: 0,
    background: "var(--bg-elevated)",
    border: "1px solid var(--border)",
    borderRadius: 9,
    padding: 18,
  } satisfies CSSProperties,
  title: { fontSize: 13, color: "var(--text-secondary)", marginBottom: 14 } satisfies CSSProperties,
  empty: { fontSize: 13, color: "var(--text-muted)" } satisfies CSSProperties,
  note: { fontSize: 11.5, color: "var(--text-muted)", marginTop: 12, lineHeight: 1.5 } satisfies CSSProperties,
} as const;
