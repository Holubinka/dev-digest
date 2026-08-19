import type { CSSProperties } from "react";

/** The rail's own `position` and the column it sits in are `.dd-tour-rail` and
 *  `.dd-tour-layout` in `app/globals.css` — a breakpoint changes both, and an
 *  inline style would win over the media query (`client/AGENTS.md`). Nothing
 *  below declares either. */
export const s = {
  nav: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
  } satisfies CSSProperties,
  /** The mockup's small, tracked-out, uppercase label. */
  label: {
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: "0.08em",
    color: "var(--text-muted)",
    margin: "0 0 12px 12px",
  } satisfies CSSProperties,
  link: (active: boolean) =>
    ({
      display: "block",
      padding: "6px 12px",
      fontSize: 13.5,
      lineHeight: 1.4,
      textDecoration: "none",
      /* The mockup marks the active entry with a rule down its left edge and
         nothing else; the others keep the same padding so no row shifts. */
      borderLeft: `2px solid ${active ? "var(--accent-text)" : "transparent"}`,
      color: active ? "var(--text-primary)" : "var(--text-secondary)",
      fontWeight: active ? 600 : 400,
    }) satisfies CSSProperties,
} as const;
