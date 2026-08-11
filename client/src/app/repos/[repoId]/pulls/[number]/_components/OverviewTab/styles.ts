import type { CSSProperties } from "react";

export const s = {
  /**
   * INTENT + BLAST RADIUS, side by side.
   *
   * `display` and `grid-template-columns` are DELIBERATELY absent here and live
   * in `app/globals.css` under `.dd-overview-cards`. An inline style beats any
   * stylesheet rule, so a property a breakpoint changes must be declared only in
   * the media-query block — declare it here as well and the row silently stops
   * responding (`client/AGENTS.md`). Only what no breakpoint touches stays.
   */
  cardRow: {
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
