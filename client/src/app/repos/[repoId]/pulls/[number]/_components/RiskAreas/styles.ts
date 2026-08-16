import type { CSSProperties } from "react";

/**
 * Co-located styles for RISK AREAS. Tokens only — no literal colours.
 *
 * Nothing here declares a property a breakpoint changes. The section sits inside
 * `IntentCard`, which sits in `.dd-overview-cards`, whose columns collapse at
 * 1024px from `app/globals.css` — and an inline style beats any stylesheet rule
 * (`client/AGENTS.md`).
 */
export const s = {
  /** A rule above the section, as the design draws it, not a second card. */
  section: {
    marginTop: 18,
    paddingTop: 16,
    borderTop: "1px solid var(--border)",
  } satisfies CSSProperties,
  headRow: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 10,
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
  } satisfies CSSProperties,
  list: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: 8,
  } satisfies CSSProperties,
  /** One risk, in its own bordered box — the shape the design draws. */
  risk: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-surface)",
    padding: "10px 12px",
  } satisfies CSSProperties,
  /** The row that is always on screen: icon, level, title, chevron. */
  summary: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    cursor: "pointer",
    listStyle: "none",
  } satisfies CSSProperties,
  riskTitle: {
    fontSize: 13,
    fontWeight: 600,
    color: "var(--text-primary)",
    minWidth: 0,
  } satisfies CSSProperties,
  /** Pushed to the far end, so the chevron sits where the design puts it. */
  chevron: {
    marginLeft: "auto",
    flexShrink: 0,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  explanation: {
    margin: "8px 0 0",
    fontSize: 12.5,
    lineHeight: 1.55,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  refRow: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 10,
    marginTop: 6,
  } satisfies CSSProperties,
  /** A reference that could not become a link. Text, never a dead control. */
  refPlain: { fontSize: 12.5, color: "var(--text-muted)" } satisfies CSSProperties,
  /** A bare button: the affordance is the underline, not a second box. */
  refButton: {
    background: "none",
    border: "none",
    padding: 0,
    fontSize: 12.5,
    cursor: "pointer",
    color: "var(--accent-text)",
    textDecoration: "underline",
    textUnderlineOffset: 2,
  } satisfies CSSProperties,
  /** The overflow disclosure: how many rows the section is not showing. */
  more: {
    marginTop: 8,
    fontSize: 12,
    color: "var(--text-muted)",
    cursor: "pointer",
    listStyle: "none",
  } satisfies CSSProperties,
  moreList: {
    listStyle: "none",
    margin: "8px 0 0",
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: 8,
  } satisfies CSSProperties,
  note: {
    margin: "0 0 4px",
    fontSize: 13,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  hint: {
    margin: "0 0 8px",
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  skeletonRow: { marginBottom: 8 } satisfies CSSProperties,
} as const;
