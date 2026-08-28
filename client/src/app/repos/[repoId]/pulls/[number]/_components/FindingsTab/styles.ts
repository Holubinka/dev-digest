import type { CSSProperties } from "react";

export const s = {
  reviewInProgress: {
    marginBottom: 18,
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "12px 16px",
    borderRadius: 8,
    border: "1px solid var(--border-strong)",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  reviewInProgressText: {
    fontSize: 14,
    fontWeight: 600,
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  reviewInProgressSub: {
    fontSize: 13,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  lethalTrifecta: {
    marginBottom: 18,
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "12px 16px",
    borderRadius: 8,
    border: "1px solid var(--crit)",
    background: "var(--crit-bg)",
  } satisfies CSSProperties,
  lethalTrifectaTitle: {
    fontSize: 14,
    fontWeight: 700,
    color: "var(--crit)",
  } satisfies CSSProperties,
  multiRunLink: {
    marginBottom: 18,
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 14px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  multiRunHint: {
    fontSize: 13,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  multiRunAnchor: {
    marginLeft: "auto",
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    fontSize: 13,
    fontWeight: 600,
    color: "var(--accent-text)",
  } satisfies CSSProperties,
  liveRunSection: {
    marginBottom: 18,
  } satisfies CSSProperties,
  timelineSection: {
    marginBottom: 18,
  } satisfies CSSProperties,
  cancelActions: {
    display: "flex",
    gap: 8,
  } satisfies CSSProperties,
  hiddenRuns: {
    fontSize: 12.5,
    color: "var(--text-muted)",
    padding: "2px 2px 6px",
  } satisfies CSSProperties,
} as const;
