import type { CSSProperties } from "react";

/** Colocated styles for OnboardingTourView.
 *
 *  What is NOT here is the point: the rail/content split lives on
 *  `.dd-tour-layout` in `app/globals.css`, because a breakpoint collapses it —
 *  and an inline style beats a stylesheet rule whatever the selector, so a
 *  property a breakpoint changes must be declared only there
 *  (`client/AGENTS.md`). Nothing below declares `display`, `grid-template-
 *  columns` or `position` for that element. */
export const s = {
  /** `padding` belongs to `.dd-page` — a breakpoint changes it. */
  page: {
    maxWidth: 1180,
    margin: "0 auto",
  } satisfies CSSProperties,
  /** The five cards, in the order `SECTION_ORDER` fixes. */
  sections: {
    display: "flex",
    flexDirection: "column",
    gap: 16,
    minWidth: 0,
  } satisfies CSSProperties,
  loadingStack: {
    display: "flex",
    flexDirection: "column",
    gap: 16,
    marginTop: 24,
  } satisfies CSSProperties,
  /** The heading on the screens that have no tour to head. */
  bareTitle: {
    fontSize: 26,
    fontWeight: 700,
    letterSpacing: "-0.02em",
    lineHeight: 1.25,
    margin: "0 0 24px",
  } satisfies CSSProperties,
  /** The repo name inside it, set apart the way `TourHeader` sets it apart —
   *  the same heading, and the screen before the tour exists. */
  bareTitleRepo: { color: "var(--accent-text)" } satisfies CSSProperties,
} as const;
