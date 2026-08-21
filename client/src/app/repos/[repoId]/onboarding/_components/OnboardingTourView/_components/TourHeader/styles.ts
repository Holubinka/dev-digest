import type { CSSProperties } from "react";

/** `gap` and the stacking direction belong to `.dd-page-header` in
 *  `app/globals.css` — the 680px breakpoint changes both, and an inline value
 *  would win over the media query (`client/AGENTS.md`). */
export const s = {
  header: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: 24,
  } satisfies CSSProperties,
  title: {
    fontSize: 26,
    fontWeight: 700,
    letterSpacing: "-0.02em",
    lineHeight: 1.25,
    margin: 0,
  } satisfies CSSProperties,
  /** The repo name inside the heading: accent mono, as the mockup draws it.
   *  The face comes from the `mono` class in `vendor/ui/styles.css`; only the
   *  colour is the component's, the same pair `ConventionsView` uses. */
  repo: { color: "var(--accent-text)" } satisfies CSSProperties,
  /** The two facts of the provenance line, in one line, as the mockup has them. */
  provenance: {
    fontSize: 13.5,
    color: "var(--text-muted)",
    marginTop: 7,
    marginBottom: 0,
    lineHeight: 1.5,
  } satisfies CSSProperties,
  actions: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flexShrink: 0,
  } satisfies CSSProperties,
} as const;
