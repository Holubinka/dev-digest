import type { CSSProperties } from "react";

/** Co-located styles for the Evals tab. */
export const s = {
  wrap: { padding: "22px 24px 32px" } satisfies CSSProperties,
  metricRow: {
    display: "flex",
    gap: 14,
    marginBottom: 28,
  } satisfies CSSProperties,
  dashboardLink: {
    fontSize: 13,
    fontWeight: 500,
    color: "var(--accent)",
    textDecoration: "none",
  } satisfies CSSProperties,
  casesHead: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    marginBottom: 14,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  h2: { fontSize: 18, fontWeight: 700, margin: 0 } satisfies CSSProperties,
  headActions: { marginLeft: "auto", display: "flex", gap: 8 } satisfies CSSProperties,
  list: { display: "flex", flexDirection: "column", gap: 8 } satisfies CSSProperties,
  row: {
    display: "flex",
    alignItems: "center",
    gap: 14,
    padding: "12px 16px",
    borderRadius: 9,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  rowMain: { flex: 1, minWidth: 0 } satisfies CSSProperties,
  name: {
    fontSize: 14,
    fontWeight: 600,
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  sub: { fontSize: 12.5, color: "var(--text-muted)", marginTop: 3 } satisfies CSSProperties,
  rowActions: { display: "flex", alignItems: "center", gap: 2 } satisfies CSSProperties,
  empty: {
    fontSize: 14,
    color: "var(--text-secondary)",
    lineHeight: 1.6,
    padding: "26px 0 6px",
  } satisfies CSSProperties,
  emptyHint: { fontSize: 13, color: "var(--text-muted)", marginTop: 8 } satisfies CSSProperties,
  loading: { fontSize: 13, color: "var(--text-muted)", padding: "20px 0" } satisfies CSSProperties,
} as const;
