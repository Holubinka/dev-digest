import type { CSSProperties } from "react";

/** Co-located styles for the document reading pane. */
export const s = {
  wrap: { fontSize: 13, lineHeight: 1.6 } satisfies CSSProperties,
  link: { color: "var(--accent-text)", textDecoration: "underline" } satisfies CSSProperties,
  /** A refused protocol: the text stays readable, the link does not work. */
  blockedLink: {
    color: "var(--text-muted)",
    textDecoration: "underline dotted",
  } satisfies CSSProperties,
  image: { maxWidth: "100%", height: "auto" } satisfies CSSProperties,
  pre: {
    padding: "10px 12px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
    overflowX: "auto",
    fontSize: 12,
  } satisfies CSSProperties,
  code: {
    fontSize: "0.92em",
    padding: "1px 6px",
    borderRadius: 4,
    background: "var(--bg-hover)",
    color: "var(--accent-text)",
  } satisfies CSSProperties,
} as const;
