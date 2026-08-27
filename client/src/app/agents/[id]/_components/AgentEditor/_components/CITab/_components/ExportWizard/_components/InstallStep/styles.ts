import type { CSSProperties } from "react";

/** Co-located styles for the wizard's Install step. */
export const s = {
  /* Fills the modal body. The 600px cap this carried came from the design
     prototype, whose modal was narrower than the 720px one actually used —
     it left dead space on the right while Target and Preview, which never
     had a cap, ran the full width. */
  wrap: { width: "100%" } satisfies CSSProperties,
  prCard: (selected: boolean): CSSProperties => ({
    width: "100%",
    textAlign: "left",
    padding: 18,
    borderRadius: 10,
    border: `1.5px solid ${selected ? "var(--accent)" : "var(--border-strong)"}`,
    background: selected ? "var(--accent-bg)" : "var(--bg-surface)",
    cursor: "pointer",
    marginBottom: 12,
    fontFamily: "inherit",
    color: "inherit",
  }),
  prHead: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginBottom: 8,
  } satisfies CSSProperties,
  prIcon: { color: "var(--accent)", flexShrink: 0 } satisfies CSSProperties,
  prTitle: { fontSize: 14, fontWeight: 700 } satisfies CSSProperties,
  badge: { marginLeft: "auto" } satisfies CSSProperties,
  prBody: { fontSize: 12.5, color: "var(--text-secondary)", lineHeight: 1.5 } satisfies CSSProperties,
  /* Quieter than `prBody`: the deletion is a consequence of the choice above,
     not a second choice. */
  removalNote: {
    margin: "8px 0 0",
    fontSize: 11.5,
    color: "var(--text-muted)",
    lineHeight: 1.5,
  } satisfies CSSProperties,
  /* One path per line, so a second entry can never run into the first. */
  removalPath: {
    display: "block",
    color: "var(--text-secondary)",
    overflowWrap: "anywhere",
  } satisfies CSSProperties,
  zipCard: (selected: boolean): CSSProperties => ({
    width: "100%",
    textAlign: "left",
    padding: 16,
    borderRadius: 10,
    border: `1.5px solid ${selected ? "var(--accent)" : "var(--border-strong)"}`,
    background: selected ? "var(--accent-bg)" : "var(--bg-surface)",
    cursor: "pointer",
    fontFamily: "inherit",
    color: "inherit",
  }),
  zipHead: { display: "flex", alignItems: "center", gap: 10 } satisfies CSSProperties,
  zipIcon: { color: "var(--text-secondary)", flexShrink: 0 } satisfies CSSProperties,
  zipTitle: { fontSize: 13.5, fontWeight: 600 } satisfies CSSProperties,
  zipHint: { marginLeft: "auto", fontSize: 11.5, color: "var(--text-muted)" } satisfies CSSProperties,
  zipWarning: {
    fontSize: 11.5,
    color: "var(--text-muted)",
    lineHeight: 1.5,
    marginTop: 10,
  } satisfies CSSProperties,
  error: {
    marginTop: 14,
    padding: "11px 13px",
    borderRadius: 8,
    border: "1px solid var(--crit)",
    background: "var(--crit-bg)",
    fontSize: 12.5,
    color: "var(--text-primary)",
    lineHeight: 1.5,
  } satisfies CSSProperties,
  success: {
    padding: 18,
    borderRadius: 10,
    border: "1px solid var(--ok)",
    background: "var(--ok-bg)",
  } satisfies CSSProperties,
  successHead: { display: "flex", alignItems: "center", gap: 9 } satisfies CSSProperties,
  successTitle: { fontSize: 14, fontWeight: 700 } satisfies CSSProperties,
  successIcon: { color: "var(--ok)", flexShrink: 0 } satisfies CSSProperties,
  link: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    marginTop: 10,
    fontSize: 13,
    color: "var(--accent-text)",
    overflowWrap: "anywhere",
  } satisfies CSSProperties,
  secretNote: {
    fontSize: 12.5,
    color: "var(--text-secondary)",
    lineHeight: 1.5,
    marginTop: 12,
  } satisfies CSSProperties,
  done: { fontSize: 12.5, color: "var(--ok)", marginTop: 12 } satisfies CSSProperties,
} as const;
