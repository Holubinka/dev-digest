import type { CSSProperties } from "react";

/** Co-located styles for the wizard's Target step. */
export const s = {
  base: { fontSize: 12, color: "var(--text-muted)", marginTop: 8 } satisfies CSSProperties,
  notice: {
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
    padding: "11px 13px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-surface)",
    fontSize: 12.5,
    color: "var(--text-secondary)",
    lineHeight: 1.5,
    marginBottom: 18,
  } satisfies CSSProperties,
  noticeIcon: { color: "var(--text-muted)", flexShrink: 0, marginTop: 1 } satisfies CSSProperties,
  grid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 12,
  } satisfies CSSProperties,
  card: (selected: boolean, dim: boolean): CSSProperties => ({
    textAlign: "left",
    padding: 16,
    borderRadius: 10,
    cursor: dim ? "default" : "pointer",
    background: "var(--bg-surface)",
    border: `1.5px solid ${selected ? "var(--accent)" : "var(--border)"}`,
    opacity: dim ? 0.6 : 1,
    fontFamily: "inherit",
    color: "inherit",
  }),
  cardHead: { display: "flex", alignItems: "center", gap: 10 } satisfies CSSProperties,
  cardIcon: (selected: boolean): CSSProperties => ({
    width: 34,
    height: 34,
    borderRadius: 8,
    background: "var(--bg-elevated)",
    display: "grid",
    placeItems: "center",
    color: selected ? "var(--accent)" : "var(--text-secondary)",
    flexShrink: 0,
  }),
  cardName: { fontSize: 14, fontWeight: 600 } satisfies CSSProperties,
  cardBadge: { marginLeft: "auto" } satisfies CSSProperties,
  cardDesc: {
    fontSize: 12,
    color: "var(--text-muted)",
    marginTop: 8,
  } satisfies CSSProperties,
} as const;
