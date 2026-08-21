import type { CSSProperties } from "react";

/**
 * The window borrows the vendored `Modal`'s geometry — the same scrim, radius,
 * shadow and elevated surface — so a reader meets one kind of dialog in this
 * product, even though the component itself had to be written here for the four
 * keyboard promises `Modal` does not keep.
 *
 * NOTHING HERE IS A PROPERTY A BREAKPOINT CHANGES, so nothing moves to
 * `app/globals.css` (`client/AGENTS.md`). The width is `min(680px, 100%)`: one
 * declaration that already holds on a phone, which is what keeps it out of a
 * media query rather than an inline style silently beating one.
 */
export const s = {
  overlay: {
    position: "fixed",
    inset: 0,
    zIndex: 50,
    display: "grid",
    placeItems: "center",
    padding: 28,
    background: "rgba(0,0,0,0.5)",
  } satisfies CSSProperties,
  dialog: {
    position: "relative",
    width: "min(680px, 100%)",
    maxHeight: "92%",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    background: "var(--bg-elevated)",
    border: "1px solid var(--border-strong)",
    borderRadius: 14,
    boxShadow: "var(--shadow-modal)",
  } satisfies CSSProperties,
  header: {
    display: "flex",
    alignItems: "flex-start",
    gap: 14,
    padding: "18px 20px",
    borderBottom: "1px solid var(--border)",
  } satisfies CSSProperties,
  /** `minWidth: 0` so a long mono path wraps inside the header instead of
      pushing the close control off it (`FileRef/styles.ts`). */
  headerText: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    alignItems: "flex-start",
    flex: 1,
    minWidth: 0,
  } satisfies CSSProperties,
  title: {
    margin: 0,
    fontSize: 16,
    fontWeight: 600,
    lineHeight: 1.4,
    color: "var(--text-primary)",
    overflowWrap: "break-word",
  } satisfies CSSProperties,
  body: {
    flex: 1,
    overflow: "auto",
    padding: "16px 20px 20px",
  } satisfies CSSProperties,
  block: { marginTop: 18 } satisfies CSSProperties,
  prose: {
    margin: 0,
    fontSize: 13,
    lineHeight: 1.6,
    color: "var(--text-secondary)",
    overflowWrap: "break-word",
  } satisfies CSSProperties,
  steps: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
    margin: 0,
    padding: 0,
    listStyle: "none",
  } satisfies CSSProperties,
  step: {
    display: "flex",
    flexDirection: "column",
    gap: 7,
    minWidth: 0,
  } satisfies CSSProperties,
  stepTop: {
    display: "flex",
    alignItems: "baseline",
    gap: 10,
    minWidth: 0,
  } satisfies CSSProperties,
  /** The ordinal is drawn rather than left to the marker: the list is a flex
      column so the browser's own numbers would sit outside the padding box. */
  stepIndex: {
    fontSize: 12,
    color: "var(--text-muted)",
    minWidth: 14,
    flexShrink: 0,
  } satisfies CSSProperties,
  stepText: {
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    lineHeight: 1.6,
    color: "var(--text-primary)",
    overflowWrap: "break-word",
  } satisfies CSSProperties,
  /** Indented to the step's text, so a path and a command read as belonging to
      the action above them rather than to the list. */
  stepDetail: { paddingLeft: 24, minWidth: 0 } satisfies CSSProperties,
} as const;
