import type { CSSProperties } from "react";
import type { ConventionCandidate } from "@devdigest/shared";

/** Accent stripe: green once accepted, muted once rejected, neutral until judged. */
export function statusColor(status: ConventionCandidate["status"]): string {
  if (status === "accepted") return "var(--ok)";
  if (status === "rejected") return "var(--text-muted)";
  return "var(--border-strong)";
}

/** Co-located styles for ConventionCard. The evidence block is a header strip
 *  carrying the citation and a copy button, then the quote on the code
 *  background — the same shape the diff viewer uses for a hunk. */
export const s = {
  card: (status: ConventionCandidate["status"]): CSSProperties => ({
    display: "flex",
    gap: 22,
    padding: "20px 22px",
    marginBottom: 16,
    borderRadius: 12,
    border: "1px solid var(--border)",
    borderLeft: `3px solid ${statusColor(status)}`,
    background: "var(--bg-elevated)",
    opacity: status === "rejected" ? 0.55 : 1,
  }),
  main: { flex: 1, minWidth: 0 } satisfies CSSProperties,
  rule: (rejected: boolean): CSSProperties => ({
    fontSize: 16,
    fontWeight: 600,
    fontStyle: "italic",
    lineHeight: 1.45,
    textDecoration: rejected ? "line-through" : "none",
  }),
  ruleRow: { display: "flex", alignItems: "flex-start", gap: 10 } satisfies CSSProperties,
  editButton: {
    background: "none",
    border: "none",
    cursor: "pointer",
    color: "var(--text-muted)",
    padding: 2,
    marginTop: 3,
    display: "inline-flex",
    flexShrink: 0,
  } satisfies CSSProperties,
  editRow: { display: "flex", gap: 8, marginTop: 10 } satisfies CSSProperties,
  evidence: {
    marginTop: 14,
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--code-bg)",
    overflow: "hidden",
  } satisfies CSSProperties,
  evidenceHeader: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "7px 7px 7px 14px",
    borderBottom: "1px solid var(--border)",
  } satisfies CSSProperties,
  evidencePath: { minWidth: 0, flex: 1 } satisfies CSSProperties,
  /** The server keeps up to twelve lines per site; a card is a glance, so the
   *  tall ones scroll here rather than pushing the next candidate off-screen. */
  snippet: {
    margin: 0,
    padding: "14px 16px",
    fontSize: 12.5,
    lineHeight: 1.7,
    maxHeight: 260,
    overflow: "auto",
    whiteSpace: "pre",
  } satisfies CSSProperties,
  moreEvidence: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 12,
    padding: "9px 14px",
    borderTop: "1px solid var(--border)",
  } satisfies CSSProperties,
  metaRow: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    marginTop: 14,
  } satisfies CSSProperties,
  /** A quiet tag, not a Chip: the category labels the card, it is not a filter. */
  category: {
    fontSize: 11.5,
    letterSpacing: "0.02em",
    color: "var(--text-muted)",
    background: "var(--bg-hover)",
    border: "1px solid var(--border)",
    borderRadius: 5,
    padding: "3px 8px",
  } satisfies CSSProperties,
  label: { fontSize: 12.5, color: "var(--text-muted)" } satisfies CSSProperties,
  confidenceBar: { width: 145 } satisfies CSSProperties,
  confidenceValue: { fontSize: 12.5, color: "var(--text-secondary)" } satisfies CSSProperties,
  actions: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
    width: 196,
    flexShrink: 0,
  } satisfies CSSProperties,
} as const;
