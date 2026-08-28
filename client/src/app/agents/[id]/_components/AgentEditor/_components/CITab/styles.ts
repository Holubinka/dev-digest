import type { CSSProperties } from "react";

/** Co-located styles for the agent editor's CI tab. */
export const s = {
  /* No width cap: the deployment list, the `Fail CI on` card and the repo
     rows all read better full-width, and `ContextTab` already sets the
     precedent for an uncapped tab. The 720 this carried came from the
     design prototype and left ~177px unused beside the rows. */
  wrap: { width: "100%" } satisfies CSSProperties,
  header: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginBottom: 16,
  } satisfies CSSProperties,
  heading: { fontSize: 16, fontWeight: 700 } satisfies CSSProperties,
  headerActions: { marginLeft: "auto", display: "flex", gap: 8 } satisfies CSSProperties,
  failOn: {
    display: "flex",
    alignItems: "center",
    gap: 14,
    padding: "12px 14px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
    marginBottom: 16,
  } satisfies CSSProperties,
  failOnText: { minWidth: 0, flex: 1 } satisfies CSSProperties,
  failOnLabel: { fontSize: 13, fontWeight: 600 } satisfies CSSProperties,
  failOnDesc: {
    fontSize: 11.5,
    color: "var(--text-muted)",
    marginTop: 2,
    lineHeight: 1.45,
  } satisfies CSSProperties,
  failOnNote: {
    fontSize: 11.5,
    color: "var(--text-muted)",
    marginTop: 6,
    lineHeight: 1.45,
  } satisfies CSSProperties,
  failOnCurrent: { fontSize: 11.5, color: "var(--warn)", marginTop: 6 } satisfies CSSProperties,
  failOnSaved: { fontSize: 11.5, color: "var(--ok)", marginTop: 6 } satisfies CSSProperties,
  failOnError: { fontSize: 11.5, color: "var(--crit)", marginTop: 6 } satisfies CSSProperties,
  segmented: {
    display: "flex",
    gap: 2,
    background: "var(--bg-surface)",
    border: "1px solid var(--border)",
    borderRadius: 7,
    padding: 2,
    flexShrink: 0,
  } satisfies CSSProperties,
  segment: (active: boolean): CSSProperties => ({
    padding: "5px 12px",
    fontSize: 12,
    fontWeight: 600,
    borderRadius: 5,
    border: "none",
    cursor: "pointer",
    fontFamily: "inherit",
    background: active ? "var(--bg-elevated)" : "transparent",
    color: active ? "var(--text-primary)" : "var(--text-muted)",
  }),
  /* The card. One line when the installation is confirmed — which is every row
     the mockup shows — and two when a reason has to be named (AC-147…AC-149);
     the `gap` only exists in the second case. */
  row: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    padding: "13px 14px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
    marginBottom: 8,
  } satisfies CSSProperties,
  rowLine: {
    display: "flex",
    alignItems: "center",
    gap: 12,
  } satisfies CSSProperties,
  /* The path in here wraps rather than pushing the card wide: a workflow file
     name carries the agent's slug, so it is long and it is the point. */
  unconfirmedNote: {
    margin: 0,
    fontSize: 11.5,
    lineHeight: 1.5,
    color: "var(--text-secondary)",
    overflowWrap: "anywhere",
  } satisfies CSSProperties,
  rowIcon: { color: "var(--text-muted)", flexShrink: 0 } satisfies CSSProperties,
  rowRepo: {
    fontSize: 13,
    fontWeight: 600,
    flex: 1,
    minWidth: 0,
    overflowWrap: "anywhere",
  } satisfies CSSProperties,
  rowTime: { fontSize: 11.5, color: "var(--text-muted)", whiteSpace: "nowrap" } satisfies CSSProperties,
  staleDetail: { fontSize: 11.5, color: "var(--warn)", whiteSpace: "nowrap" } satisfies CSSProperties,
  addRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    width: "100%",
    padding: "12px 14px",
    borderRadius: 8,
    border: "1px dashed var(--border-strong)",
    background: "transparent",
    color: "var(--text-secondary)",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "inherit",
    marginTop: 2,
  } satisfies CSSProperties,
  /* Centred, not left-aligned: the cap keeps the copy readable, and
     `margin: 0 auto` is what puts it in the middle of the tab rather than
     against its left edge. */
  empty: { maxWidth: 600, margin: "0 auto" } satisfies CSSProperties,
  loading: { display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
} as const;
