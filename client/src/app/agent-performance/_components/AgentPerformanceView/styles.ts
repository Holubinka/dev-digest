import type { CSSProperties } from "react";

export const s = {
  /** `padding` belongs to `.dd-page` in globals.css — a breakpoint changes it. */
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
  skeletons: { display: "flex", flexDirection: "column", gap: 14, marginTop: 22 } satisfies CSSProperties,
  section: { marginTop: 30 } satisfies CSSProperties,
} as const;
