import type { CSSProperties } from "react";

/** Nothing here declares a property a breakpoint changes: these blocks are full
 *  width in every layout. */
export const s = {
  block: {
    background: "var(--bg-elevated)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    padding: "16px 18px",
  } satisfies CSSProperties,
  title: {
    margin: 0,
    fontSize: 15,
    fontWeight: 600,
    color: "var(--text-primary)",
    letterSpacing: "-0.01em",
  } satisfies CSSProperties,
  body: {
    margin: "8px 0 0",
    fontSize: 13,
    lineHeight: 1.6,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  hint: {
    margin: "8px 0 0",
    fontSize: 12.5,
    lineHeight: 1.5,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  running: {
    margin: 0,
    fontSize: 13,
    lineHeight: 1.6,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  link: { color: "var(--accent-text)" } satisfies CSSProperties,
} as const;
