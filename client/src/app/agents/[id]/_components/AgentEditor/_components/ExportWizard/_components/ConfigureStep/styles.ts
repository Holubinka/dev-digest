import type { CSSProperties } from "react";

/** Co-located styles for the wizard's Configure step. */
export const s = {
  /* Fills the modal body. The 600px cap this carried came from the design
     prototype, whose modal was narrower than the 720px one actually used —
     it left dead space on the right while Target and Preview, which never
     had a cap, ran the full width. */
  wrap: { width: "100%" } satisfies CSSProperties,
  chips: { display: "flex", flexWrap: "wrap", gap: 7 } satisfies CSSProperties,
  reason: {
    fontSize: 12,
    color: "var(--warn)",
    marginTop: 8,
  } satisfies CSSProperties,
  radios: { display: "flex", flexDirection: "column", gap: 7 } satisfies CSSProperties,
  radioRow: {
    display: "flex",
    alignItems: "center",
    gap: 9,
    fontSize: 13,
    color: "var(--text-secondary)",
    cursor: "pointer",
  } satisfies CSSProperties,
  radio: { width: 16, height: 16, accentColor: "var(--accent)", margin: 0 } satisfies CSSProperties,
  error: {
    padding: "11px 13px",
    borderRadius: 8,
    border: "1px solid var(--crit)",
    background: "var(--crit-bg)",
    fontSize: 12.5,
    color: "var(--text-primary)",
    lineHeight: 1.5,
  } satisfies CSSProperties,
  info: {
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
    padding: "11px 13px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
  infoIcon: { color: "var(--text-muted)", flexShrink: 0, marginTop: 1 } satisfies CSSProperties,
  infoBody: {
    fontSize: 12.5,
    color: "var(--text-secondary)",
    lineHeight: 1.5,
  } satisfies CSSProperties,
  infoStrong: { fontWeight: 600, color: "var(--text-primary)" } satisfies CSSProperties,
  dialog: {
    marginTop: 16,
    padding: "13px 15px",
    borderRadius: 8,
    border: "1px solid var(--warn)",
    background: "var(--warn-bg)",
  } satisfies CSSProperties,
  dialogTitle: { fontSize: 13, fontWeight: 700, color: "var(--text-primary)" } satisfies CSSProperties,
  dialogBody: {
    fontSize: 12.5,
    color: "var(--text-secondary)",
    lineHeight: 1.5,
    marginTop: 4,
  } satisfies CSSProperties,
  dialogActions: { display: "flex", gap: 8, marginTop: 12 } satisfies CSSProperties,
} as const;
