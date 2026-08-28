import type { CSSProperties } from "react";
import { GRID, GRID_GAP } from "./constants";

/** Co-located styles for the CI Runs page. */
export const s = {
  /** `padding` belongs to `.dd-page` in globals.css — a breakpoint changes it,
   *  and an inline value would win over the media query. */
  page: { maxWidth: 1240, margin: "0 auto" } satisfies CSSProperties,
  /** `gap` and the stacking direction belong to `.dd-page-header`. */
  header: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
  } satisfies CSSProperties,
  title: { fontSize: 26, fontWeight: 700, letterSpacing: "-0.02em" } satisfies CSSProperties,
  subtitle: {
    fontSize: 13.5,
    color: "var(--text-muted)",
    marginTop: 7,
    lineHeight: 1.5,
  } satisfies CSSProperties,
  actions: { display: "flex", alignItems: "center", gap: 12 } satisfies CSSProperties,
  polled: { fontSize: 12, color: "var(--text-muted)", whiteSpace: "nowrap" } satisfies CSSProperties,
  banner: {
    display: "flex",
    gap: 10,
    alignItems: "flex-start",
    padding: "11px 13px",
    borderRadius: 8,
    border: "1px solid var(--warn)",
    background: "var(--warn-bg)",
    marginTop: 20,
  } satisfies CSSProperties,
  bannerIcon: { color: "var(--warn)", flexShrink: 0, marginTop: 1 } satisfies CSSProperties,
  bannerTitle: { fontSize: 13, fontWeight: 600 } satisfies CSSProperties,
  bannerLine: {
    fontSize: 12.5,
    color: "var(--text-secondary)",
    marginTop: 4,
    lineHeight: 1.5,
    overflowWrap: "anywhere",
  } satisfies CSSProperties,
  tableCard: {
    marginTop: 20,
    border: "1px solid var(--border)",
    borderRadius: 10,
    overflow: "hidden",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  headRow: {
    display: "grid",
    gridTemplateColumns: GRID,
    gap: GRID_GAP,
    padding: "10px 18px",
    borderBottom: "1px solid var(--border)",
    background: "var(--bg-surface)",
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: "0.06em",
    color: "var(--text-muted)",
    textTransform: "uppercase",
  } satisfies CSSProperties,
  headCell: (alignRight: boolean): CSSProperties => ({
    textAlign: alignRight ? "right" : "left",
  }),
  loadingStack: {
    padding: 18,
    display: "flex",
    flexDirection: "column",
    gap: 14,
  } satisfies CSSProperties,
} as const;
