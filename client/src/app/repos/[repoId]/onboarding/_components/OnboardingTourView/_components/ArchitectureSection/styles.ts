import type { CSSProperties } from "react";

export const s = {
  diagram: { marginTop: 12 } satisfies CSSProperties,
  /**
   * The line that takes verified-path status away from the diagram's boxes
   * (AC-77). It sits under the diagram, not inside it — mermaid owns that
   * subtree's markup.
   */
  note: {
    margin: "8px 0 0",
    fontSize: 12,
    lineHeight: 1.5,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  empty: {
    margin: 0,
    fontSize: 13,
    lineHeight: 1.6,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
} as const;
