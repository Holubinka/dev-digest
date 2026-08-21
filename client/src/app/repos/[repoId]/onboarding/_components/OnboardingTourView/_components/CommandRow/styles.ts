import type { CSSProperties } from "react";

export const s = {
  row: {
    border: "1px solid var(--border)",
    borderRadius: 7,
    background: "var(--bg-primary)",
    padding: "9px 10px 9px 12px",
  } satisfies CSSProperties,
  top: { display: "flex", alignItems: "center", gap: 10 } satisfies CSSProperties,
  /** The step number the mockup draws down the left of a single-package list. */
  index: {
    fontSize: 12,
    color: "var(--text-muted)",
    minWidth: 12,
    textAlign: "right",
    flexShrink: 0,
  } satisfies CSSProperties,
  /**
   * `pre-wrap` so the string on screen is the string that was copied, spaces
   * included; `break-word` so a long one wraps inside the card instead of
   * pushing the copy control off it.
   */
  command: {
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    color: "var(--text-primary)",
    whiteSpace: "pre-wrap",
    overflowWrap: "break-word",
  } satisfies CSSProperties,
  /**
   * Everything under the command line. Deliberately NOT mono and deliberately
   * not inside the `<code>`: the copy control beside it hands over the command
   * and nothing else, so anything that reads as part of the command would be
   * read as part of it and pasted into a shell where it is not.
   */
  meta: {
    display: "flex",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 5,
    paddingLeft: 22,
    fontSize: 12,
    lineHeight: 1.5,
  } satisfies CSSProperties,
  why: { color: "var(--text-secondary)" } satisfies CSSProperties,
  source: { color: "var(--text-muted)" } satisfies CSSProperties,
} as const;
