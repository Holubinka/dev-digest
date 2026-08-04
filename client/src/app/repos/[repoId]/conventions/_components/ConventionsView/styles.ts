import type { CSSProperties } from "react";

/** Co-located styles for ConventionsView.
 *  `<main>` in AppFrame carries no padding — every page supplies its own — and
 *  this one is a centred reading column rather than the full-bleed table the PR
 *  list uses: a card is a rule plus a quote of code, and a quote stretched
 *  across an ultrawide monitor is unreadable. */
export const s = {
  /** `padding` is set by the `.dd-page` rule in globals.css — a breakpoint
   *  changes it, and an inline value would win over the media query. */
  page: {
    maxWidth: 1180,
    margin: "0 auto",
  } satisfies CSSProperties,
  /** `gap` and the stacking direction belong to `.dd-page-header`. */
  header: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
  } satisfies CSSProperties,
  title: {
    fontSize: 26,
    fontWeight: 700,
    letterSpacing: "-0.02em",
    lineHeight: 1.25,
  } satisfies CSSProperties,
  repo: { color: "var(--accent-text)" } satisfies CSSProperties,
  subtitle: {
    fontSize: 13.5,
    color: "var(--text-muted)",
    marginTop: 7,
    lineHeight: 1.5,
  } satisfies CSSProperties,
  toolbar: {
    display: "flex",
    alignItems: "center",
    gap: 14,
    padding: "22px 0 18px",
  } satisfies CSSProperties,
  /** `marginRight` belongs to `.dd-toolbar-count`. */
  count: { fontSize: 13, color: "var(--text-muted)" } satisfies CSSProperties,
  loadingStack: { display: "flex", flexDirection: "column", gap: 16 } satisfies CSSProperties,
} as const;
