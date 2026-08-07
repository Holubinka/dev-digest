import type { CSSProperties } from "react";
import type { SmartDiffRole } from "@devdigest/shared";

/** Co-located styles for SmartDiffViewer. */
export const s = {
  wrap: { display: "flex", flexDirection: "column", gap: 22 } satisfies CSSProperties,
  group: { display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
  groupHeader: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    fontSize: 13,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  groupLabel: { fontWeight: 600, color: "var(--text-primary)" } satisfies CSSProperties,
  groupHint: { fontSize: 12.5, color: "var(--text-muted)" } satisfies CSSProperties,
  groupCount: { marginLeft: "auto", fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  /** The red dot the mock puts after the path of a file carrying findings. */
  fileDot: {
    width: 6,
    height: 6,
    borderRadius: 99,
    background: "var(--crit)",
    flexShrink: 0,
  } satisfies CSSProperties,
  bareButton: {
    background: "none",
    border: "none",
    padding: 0,
    cursor: "pointer",
    lineHeight: 1,
    display: "inline-flex",
  } satisfies CSSProperties,
  callout: {
    border: "1px solid var(--border)",
    borderLeft: "3px solid var(--warn)",
    borderRadius: 7,
    background: "var(--bg-elevated)",
    padding: "12px 14px",
    display: "flex",
    flexDirection: "column",
    gap: 6,
  } satisfies CSSProperties,
  calloutTitle: { fontSize: 13, fontWeight: 600, color: "var(--text-primary)" } satisfies CSSProperties,
  calloutBody: { fontSize: 13, color: "var(--text-secondary)" } satisfies CSSProperties,
  splitList: { margin: 0, paddingLeft: 18, fontSize: 13, color: "var(--text-secondary)" } satisfies CSSProperties,
} as const;

const ROLE_DOT: Record<SmartDiffRole, string> = {
  core: "var(--accent)",
  wiring: "var(--warn)",
  boilerplate: "var(--text-muted)",
};

/** The colour chip in front of a group label. */
export function roleDotFor(role: SmartDiffRole): CSSProperties {
  return { width: 9, height: 9, borderRadius: 2, background: ROLE_DOT[role], flexShrink: 0 };
}
