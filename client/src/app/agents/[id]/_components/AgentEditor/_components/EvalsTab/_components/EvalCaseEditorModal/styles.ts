import type { CSSProperties } from "react";

/**
 * Co-located styles for the eval case editor.
 *
 * The two-column split is declared ONLY in `app/globals.css` under
 * `.dd-eval-case-cols`, never here: an inline style beats a media query
 * whatever the selector, so a `gridTemplateColumns` left in this file would
 * make the modal stop responding below 680px without any gate noticing.
 */
export const s = {
  cols: { display: "grid", gap: 0 } satisfies CSSProperties,
  colLeft: {
    padding: "20px 22px",
    borderRight: "1px solid var(--border)",
    minWidth: 0,
  } satisfies CSSProperties,
  colRight: { padding: "20px 22px", minWidth: 0 } satisfies CSSProperties,
  label: {
    fontSize: 13,
    fontWeight: 600,
    color: "var(--text-secondary)",
    marginBottom: 8,
  } satisfies CSSProperties,
  inputTabs: { marginBottom: 12 } satisfies CSSProperties,
  hint: {
    fontSize: 12,
    color: "var(--text-muted)",
    marginTop: 8,
    lineHeight: 1.45,
  } satisfies CSSProperties,
  filesList: {
    margin: 0,
    padding: "10px 12px",
    listStyle: "none",
    borderRadius: 7,
    border: "1px solid var(--border-strong)",
    background: "var(--bg-elevated)",
    minHeight: 120,
  } satisfies CSSProperties,
  fileRow: {
    fontSize: 13,
    color: "var(--text-primary)",
    padding: "3px 0",
    overflowWrap: "anywhere",
  } satisfies CSSProperties,
  expectedHead: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginBottom: 8,
  } satisfies CSSProperties,
  expectedActions: { marginLeft: "auto" } satisfies CSSProperties,
  error: {
    fontSize: 12.5,
    color: "var(--crit)",
    marginTop: 8,
    lineHeight: 1.5,
  } satisfies CSSProperties,
  resultStrip: (passed: boolean): CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginTop: 14,
    padding: "10px 14px",
    borderRadius: 8,
    border: "1px solid " + (passed ? "var(--ok)" : "var(--crit)"),
    background: "var(--bg-surface)",
    fontSize: 13,
    flexWrap: "wrap",
  }),
  resultTitle: { fontWeight: 700, color: "var(--text-primary)" } satisfies CSSProperties,
  resultMeta: { color: "var(--text-secondary)" } satisfies CSSProperties,
  footer: {
    display: "flex",
    alignItems: "center",
    gap: 12,
  } satisfies CSSProperties,
  footerRight: { marginLeft: "auto", display: "flex", gap: 8 } satisfies CSSProperties,
  runOnSave: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    fontSize: 13,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  loading: { padding: 28, fontSize: 13, color: "var(--text-muted)" } satisfies CSSProperties,
} as const;
