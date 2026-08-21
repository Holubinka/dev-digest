import type { CSSProperties } from "react";

/** Co-located styles for IntentCard. Tokens only — no literal colours. */
export const s = {
  card: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
    padding: 18,
  } satisfies CSSProperties,
  goal: {
    margin: "0 0 16px",
    fontSize: 14,
    fontStyle: "italic",
    lineHeight: 1.55,
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  grid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 16,
  } satisfies CSSProperties,
  colLabel: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.07em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
    marginBottom: 6,
  } satisfies CSSProperties,
  list: {
    margin: 0,
    paddingLeft: 18,
    // The marker is set here because the global reset strips it: a bare `ul`
    // computes to `list-style: none`, so the 18px indent was reserving space
    // for a bullet that never rendered. A string marker keeps it a real
    // `::marker` — no extra DOM — and it inherits the colour below rather than
    // needing one of its own.
    listStyleType: '"·  "',
    fontSize: 13,
    lineHeight: 1.6,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  /** Without it every `li` is `margin-bottom: 0` and the items read as one paragraph. */
  listItem: { marginBottom: 6 } satisfies CSSProperties,
  /** An empty scope list renders this, never an invented bullet. */
  dash: { fontSize: 13, color: "var(--text-muted)" } satisfies CSSProperties,
  footer: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginTop: 16,
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  note: {
    margin: "0 0 4px",
    fontSize: 13,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  hint: {
    margin: "0 0 12px",
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  skeletonRow: { marginBottom: 10 } satisfies CSSProperties,
} as const;
