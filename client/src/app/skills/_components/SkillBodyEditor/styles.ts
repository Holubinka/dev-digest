import type { CSSProperties } from "react";

/** Line height and font must match between the gutter and the textarea, or the
 *  numbers drift away from the lines they label. Both read these. */
export const LINE_HEIGHT = 20;
const CODE_FONT = "var(--font-mono)";
const CODE_SIZE = 12.5;

/** Co-located styles for the body editor. */
export const s = {
  wrap: {
    borderRadius: 8,
    border: "1px solid var(--border-strong)",
    background: "var(--code-bg)",
    overflow: "hidden",
  } satisfies CSSProperties,
  bar: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 12px",
    borderBottom: "1px solid var(--border)",
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
  barIcon: { color: "var(--text-muted)", flexShrink: 0 } satisfies CSSProperties,
  filename: { fontSize: 12, color: "var(--text-secondary)" } satisfies CSSProperties,
  tokens: { marginLeft: "auto", fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  editor: { display: "flex", alignItems: "stretch", maxHeight: 420 } satisfies CSSProperties,
  gutter: {
    flexShrink: 0,
    overflow: "hidden",
    padding: "10px 8px 10px 12px",
    textAlign: "right",
    userSelect: "none",
    borderRight: "1px solid var(--border)",
    fontFamily: CODE_FONT,
    fontSize: CODE_SIZE,
    lineHeight: `${LINE_HEIGHT}px`,
    color: "var(--text-muted)",
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
  textarea: {
    flex: 1,
    minWidth: 0,
    resize: "vertical",
    overflow: "auto",
    padding: "10px 12px",
    border: "none",
    outline: "none",
    background: "transparent",
    color: "var(--text-primary)",
    fontFamily: CODE_FONT,
    fontSize: CODE_SIZE,
    lineHeight: `${LINE_HEIGHT}px`,
    tabSize: 2,
    whiteSpace: "pre",
  } satisfies CSSProperties,
} as const;
