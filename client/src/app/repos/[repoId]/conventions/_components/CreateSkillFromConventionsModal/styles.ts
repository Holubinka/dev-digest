import type { CSSProperties } from "react";

/** Co-located styles. Mirrors CreateSkillModal — same modal, different source. */
export const s = {
  body: {
    padding: "18px 24px",
    display: "flex",
    flexDirection: "column",
  } satisfies CSSProperties,
  banner: {
    padding: "12px 14px",
    marginBottom: 18,
    borderRadius: 8,
    border: "1px solid var(--accent-border, var(--border-strong))",
    background: "var(--accent-bg)",
    color: "var(--text-secondary)",
    fontSize: 13,
    lineHeight: 1.5,
  } satisfies CSSProperties,
  row: {
    display: "grid",
    gridTemplateColumns: "1fr 220px",
    gap: 14,
    alignItems: "start",
  } satisfies CSSProperties,
  footer: { display: "flex", alignItems: "center", gap: 10 } satisfies CSSProperties,
  footerNote: {
    fontSize: 12,
    color: "var(--text-muted)",
    marginRight: "auto",
  } satisfies CSSProperties,
} as const;
