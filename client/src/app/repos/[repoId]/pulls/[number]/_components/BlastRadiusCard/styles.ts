import type { CSSProperties } from "react";

/* Co-located styles for BlastRadiusCard. Tokens only — no literal colours, and
   no breakpoint: the card sits in `OverviewTab`'s two-column `cardRow`, which
   declares none, and every row here wraps instead of reflowing. A property a
   media query would change belongs in `app/globals.css` keyed on a `dd-` class
   (`client/AGENTS.md`), so if a breakpoint is ever wanted, it goes there — not
   back into this file. */
export const s = {
  /** Same frame as the INTENT card beside it, so the row reads as one pair. */
  card: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
    padding: 18,
  } satisfies CSSProperties,

  statRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: 18,
    marginBottom: 4,
  } satisfies CSSProperties,
  stat: { display: "flex", alignItems: "baseline", gap: 6 } satisfies CSSProperties,
  statValue: {
    fontSize: 18,
    fontWeight: 700,
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  statLabel: {
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
  } satisfies CSSProperties,

  /** `partial` / `degraded` is its own visible state, never a shorter list. */
  banner: {
    display: "flex",
    alignItems: "flex-start",
    gap: 8,
    padding: "8px 10px",
    borderRadius: 6,
    marginBottom: 14,
    fontSize: 12.5,
    lineHeight: 1.5,
  } satisfies CSSProperties,
  bannerPartial: {
    color: "var(--warn)",
    background: "var(--warn-bg)",
  } satisfies CSSProperties,
  bannerDegraded: {
    color: "var(--crit)",
    background: "var(--crit-bg)",
  } satisfies CSSProperties,

  symbolList: { marginTop: 14 } satisfies CSSProperties,
  symbol: { borderTop: "1px solid var(--border)", padding: "9px 0" } satisfies CSSProperties,
  /** No `display` override: that is what keeps the native disclosure triangle. */
  disclosure: {
    cursor: "pointer",
    fontSize: 13,
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  symbolName: { fontWeight: 600 } satisfies CSSProperties,
  symbolSite: {
    marginLeft: 8,
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  callerCount: {
    marginLeft: 8,
    fontSize: 12,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,

  callerList: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    margin: "8px 0 0",
    padding: "0 0 0 18px",
    listStyle: "none",
  } satisfies CSSProperties,
  callerRow: {
    display: "flex",
    alignItems: "baseline",
    flexWrap: "wrap",
    gap: 8,
  } satisfies CSSProperties,
  callerSymbol: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  /** A caller whose link cannot be built renders as text, never as a dead link. */
  callerPlain: { fontSize: 13, color: "var(--text-secondary)" } satisfies CSSProperties,

  chipRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
    margin: "8px 0 0 18px",
  } satisfies CSSProperties,

  summary: {
    margin: "14px 0 0",
    padding: "10px 12px",
    borderRadius: 6,
    background: "var(--bg-hover)",
    fontSize: 13,
    lineHeight: 1.6,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,

  footer: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 12,
    marginTop: 14,
  } satisfies CSSProperties,
  note: {
    margin: "0 0 4px",
    fontSize: 13,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  hint: { margin: "8px 0 0", fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  skeletonRow: { marginBottom: 10 } satisfies CSSProperties,
} as const;
