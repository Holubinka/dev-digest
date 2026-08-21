import type { CSSProperties } from "react";

/**
 * Co-located styles for REVIEW FOCUS. Tokens only — no literal colours.
 *
 * Nothing here declares a property a breakpoint changes. The section is a
 * SIBLING of `.dd-overview-cards`, not a child of it, so the natural document
 * order already stacks it last below 1024px and it needs no rule of its own —
 * and an inline style would beat one anyway (`client/AGENTS.md`).
 */
export const s = {
  card: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
    padding: 18,
  } satisfies CSSProperties,
  /** The full list's length, beside the heading rather than at the far end. */
  countBadge: { marginLeft: 8, verticalAlign: "middle" } satisfies CSSProperties,
  list: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: 10,
  } satisfies CSSProperties,
  /** Reference and reason on ONE line — a section called "read these first"
      whose reasons need a click has cancelled itself (AC-56). */
  focus: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "baseline",
    gap: 8,
  } satisfies CSSProperties,
  marker: { color: "var(--accent-text)", flexShrink: 0 } satisfies CSSProperties,
  reason: {
    fontSize: 12.5,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  more: {
    marginTop: 10,
    fontSize: 12,
    color: "var(--text-muted)",
    cursor: "pointer",
    listStyle: "none",
  } satisfies CSSProperties,
  moreList: {
    listStyle: "none",
    margin: "10px 0 0",
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: 10,
  } satisfies CSSProperties,
  /** What the brief was built from, and what it cost (AC-33, AC-70). */
  provenance: {
    marginTop: 18,
    paddingTop: 14,
    borderTop: "1px solid var(--border)",
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
  /** The BRIEF's cost, under its own label — never summed with the run's. */
  costRow: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 8,
    marginTop: 10,
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  note: {
    margin: "0 0 4px",
    fontSize: 13,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  skeletonRow: { marginBottom: 10 } satisfies CSSProperties,
} as const;
