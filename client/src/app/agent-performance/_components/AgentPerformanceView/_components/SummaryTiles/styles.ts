import type { CSSProperties } from "react";

export const s = {
  /** Only the WRAPPING is responsive; `.dd-perf-tiles` in globals.css owns it. */
  row: { display: "flex", gap: 14, marginTop: 22 } satisfies CSSProperties,
  note: { fontSize: 11.5, color: "var(--text-muted)", marginTop: 8, lineHeight: 1.45 } satisfies CSSProperties,
  card: {
    flex: 1,
    background: "var(--bg-elevated)",
    border: "1px solid var(--border)",
    borderRadius: 9,
    padding: 18,
  } satisfies CSSProperties,
  cardLabel: {
    fontSize: 12,
    fontWeight: 600,
    color: "var(--text-muted)",
    letterSpacing: "0.03em",
  } satisfies CSSProperties,
  agent: { display: "flex", alignItems: "center", gap: 11, marginTop: 14 } satisfies CSSProperties,
  swatch: {
    width: 30,
    height: 30,
    borderRadius: 7,
    display: "grid",
    placeItems: "center",
    flexShrink: 0,
  } satisfies CSSProperties,
  agentName: { fontSize: 15, fontWeight: 700, letterSpacing: "-0.01em" } satisfies CSSProperties,
  agentMeta: { fontSize: 12.5, color: "var(--text-muted)", marginTop: 2 } satisfies CSSProperties,
  none: { fontSize: 13, color: "var(--text-muted)", marginTop: 16 } satisfies CSSProperties,
} as const;
