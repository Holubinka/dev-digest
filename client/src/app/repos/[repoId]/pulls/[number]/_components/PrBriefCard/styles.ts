import type { CSSProperties } from "react";

/**
 * Co-located styles for PrBriefCard. Tokens only — no literal colours.
 *
 * Nothing here declares a property a breakpoint changes. The card sits in
 * `.dd-overview-cards`, whose columns collapse at 680px from `app/globals.css`,
 * and an inline style beats any stylesheet rule (`client/AGENTS.md`).
 */
export const s = {
  card: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
    padding: 18,
  } satisfies CSSProperties,
  /** The risk level and, when there are none, the sentence that says so. */
  levelRow: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 14,
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
  /** Model prose. Rendered as `{value}`, never through a markdown renderer. */
  prose: {
    margin: "0 0 14px",
    fontSize: 13.5,
    lineHeight: 1.6,
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  block: { marginTop: 16 } satisfies CSSProperties,
  list: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: 12,
  } satisfies CSSProperties,
  risk: {
    borderLeft: "2px solid var(--border-strong)",
    paddingLeft: 10,
  } satisfies CSSProperties,
  riskHead: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 4,
  } satisfies CSSProperties,
  riskTitle: {
    fontSize: 13,
    fontWeight: 600,
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  riskBody: {
    margin: "0 0 6px",
    fontSize: 12.5,
    lineHeight: 1.55,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  refRow: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 10,
  } satisfies CSSProperties,
  /** A reference that could not become a link. Text, never a dead control. */
  refPlain: { fontSize: 12.5, color: "var(--text-muted)" } satisfies CSSProperties,
  focus: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "baseline",
    gap: 8,
  } satisfies CSSProperties,
  /** A bare button: the affordance is the underline, not a second box. */
  focusButton: {
    background: "none",
    border: "none",
    padding: 0,
    fontSize: 12.5,
    cursor: "pointer",
    color: "var(--accent-text)",
    textDecoration: "underline",
    textUnderlineOffset: 2,
  } satisfies CSSProperties,
  focusReason: {
    fontSize: 12.5,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  inputList: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: 6,
  } satisfies CSSProperties,
  inputRow: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 8,
  } satisfies CSSProperties,
  inputId: { fontSize: 12, color: "var(--text-secondary)" } satisfies CSSProperties,
  inputDetail: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  footer: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 12,
    marginTop: 16,
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
  link: { color: "var(--accent-text)", textDecoration: "underline" } satisfies CSSProperties,
  skeletonRow: { marginBottom: 10 } satisfies CSSProperties,
} as const;
