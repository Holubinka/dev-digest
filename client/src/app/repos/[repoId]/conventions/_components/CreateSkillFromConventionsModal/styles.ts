import type { CSSProperties } from "react";

/** Co-located styles. Mirrors CreateSkillModal — same modal, different source. */
export const s = {
  body: {
    padding: "18px 24px",
    display: "flex",
    flexDirection: "column",
  } satisfies CSSProperties,
  banner: {
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
    padding: "13px 15px",
    marginBottom: 20,
    borderRadius: 8,
    border: "1px solid var(--accent-border, var(--border-strong))",
    background: "var(--accent-bg)",
    color: "var(--text-secondary)",
    fontSize: 13.5,
    lineHeight: 1.55,
  } satisfies CSSProperties,
  bannerIcon: { color: "var(--accent)", flexShrink: 0, marginTop: 2 } satisfies CSSProperties,
  bannerStrong: { color: "var(--text-primary)", fontWeight: 600 } satisfies CSSProperties,
  bannerRepo: { color: "var(--accent-text)" } satisfies CSSProperties,
  /** Two even columns: the mockup puts Enabled at the midpoint, not hard right. */
  row: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 24,
    alignItems: "start",
  } satisfies CSSProperties,
  footer: { display: "flex", alignItems: "center", gap: 10 } satisfies CSSProperties,
  footerNote: {
    fontSize: 12,
    color: "var(--text-muted)",
    marginRight: "auto",
  } satisfies CSSProperties,
} as const;
