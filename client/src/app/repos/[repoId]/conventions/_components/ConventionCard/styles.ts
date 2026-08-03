import type { CSSProperties } from "react";
import type { ConventionCandidate } from "@devdigest/shared";

/** Accent stripe: green once accepted, muted once rejected, neutral until judged. */
export function statusColor(status: ConventionCandidate["status"]): string {
  if (status === "accepted") return "var(--ok)";
  if (status === "rejected") return "var(--text-muted)";
  return "var(--border-strong)";
}

/** Co-located styles for ConventionCard. Mirrors FindingCard's evidence block. */
export const s = {
  card: (status: ConventionCandidate["status"]): CSSProperties => ({
    display: "flex",
    gap: 16,
    padding: 16,
    marginBottom: 12,
    borderRadius: 10,
    border: "1px solid var(--border)",
    borderLeft: `3px solid ${statusColor(status)}`,
    background: "var(--bg-elevated)",
    opacity: status === "rejected" ? 0.55 : 1,
  }),
  main: { flex: 1, minWidth: 0 } satisfies CSSProperties,
  rule: (rejected: boolean): CSSProperties => ({
    fontSize: 14.5,
    fontWeight: 600,
    fontStyle: "italic",
    lineHeight: 1.4,
    textDecoration: rejected ? "line-through" : "none",
  }),
  ruleRow: { display: "flex", alignItems: "flex-start", gap: 8 } satisfies CSSProperties,
  editButton: {
    background: "none",
    border: "none",
    cursor: "pointer",
    color: "var(--text-muted)",
    padding: 2,
    display: "inline-flex",
    flexShrink: 0,
  } satisfies CSSProperties,
  editRow: { display: "flex", gap: 8, marginTop: 8 } satisfies CSSProperties,
  evidence: {
    marginTop: 12,
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--code-bg)",
    overflow: "hidden",
  } satisfies CSSProperties,
  evidenceHeader: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 12px",
    borderBottom: "1px solid var(--border)",
  } satisfies CSSProperties,
  snippet: {
    margin: 0,
    padding: "12px 14px",
    fontSize: 12.5,
    lineHeight: 1.6,
    overflowX: "auto",
    whiteSpace: "pre",
  } satisfies CSSProperties,
  moreEvidence: {
    display: "flex",
    flexWrap: "wrap",
    gap: 10,
    padding: "8px 12px",
    borderTop: "1px solid var(--border)",
  } satisfies CSSProperties,
  metaRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginTop: 12,
  } satisfies CSSProperties,
  confidenceLabel: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  confidenceBar: { width: 140 } satisfies CSSProperties,
  confidenceValue: { fontSize: 12, color: "var(--text-secondary)" } satisfies CSSProperties,
  actions: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    width: 150,
    flexShrink: 0,
  } satisfies CSSProperties,
} as const;
