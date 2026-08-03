import type { CSSProperties } from "react";

/** Co-located styles for ConventionsView. */
export const s = {
  header: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 16,
    marginBottom: 20,
  } satisfies CSSProperties,
  title: { fontSize: 24, fontWeight: 700, letterSpacing: "-0.02em" } satisfies CSSProperties,
  repo: { color: "var(--accent-text)" } satisfies CSSProperties,
  subtitle: {
    fontSize: 13,
    color: "var(--text-muted)",
    marginTop: 6,
    lineHeight: 1.5,
  } satisfies CSSProperties,
  toolbar: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "10px 0 16px",
  } satisfies CSSProperties,
  count: { fontSize: 13, color: "var(--text-muted)", marginRight: "auto" } satisfies CSSProperties,
  loadingStack: { display: "flex", flexDirection: "column", gap: 12 } satisfies CSSProperties,
} as const;
