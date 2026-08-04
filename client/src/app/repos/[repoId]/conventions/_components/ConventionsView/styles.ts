import type { CSSProperties } from "react";

/** Co-located styles for ConventionsView.
 *  `<main>` in AppFrame carries no padding — every page supplies its own — and
 *  this one is a centred reading column rather than the full-bleed table the PR
 *  list uses: a card is a rule plus a quote of code, and a quote stretched
 *  across an ultrawide monitor is unreadable. */
export const s = {
  page: {
    maxWidth: 1180,
    margin: "0 auto",
    padding: "28px 32px 56px",
  } satisfies CSSProperties,
  header: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 24,
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
  count: { fontSize: 13, color: "var(--text-muted)", marginRight: "auto" } satisfies CSSProperties,
  loadingStack: { display: "flex", flexDirection: "column", gap: 16 } satisfies CSSProperties,
} as const;
