import type { CSSProperties } from "react";

export const s = {
  /** INTENT + the reserved BLAST RADIUS slot. Cut once, so nothing is re-cut later. */
  cardRow: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 16,
    marginBottom: 24,
    alignItems: "start",
  } satisfies CSSProperties,
  /** No `whiteSpace: pre-wrap` here: `<Markdown>` owns block layout, and pre-wrap
      turns every source newline inside a paragraph into a visible line break —
      which is what made a GitHub PR body render as its own source. */
  descriptionBox: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
    padding: 18,
    fontSize: 14,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
} as const;
