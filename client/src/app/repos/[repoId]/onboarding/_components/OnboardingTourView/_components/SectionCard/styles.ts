import type { CSSProperties } from "react";

/**
 * The shared frame of a tour section. Nothing here declares a property a
 * breakpoint changes — the card is full width in every layout and only the
 * two-column split around it responds, which is `app/globals.css`'s business
 * (`client/AGENTS.md`).
 */
export const s = {
  card: {
    background: "var(--bg-elevated)",
    border: "1px solid var(--border)",
    borderRadius: 8,
  } satisfies CSSProperties,
  /** `listStyle: none` is belt to `.dd-brief-disclosure`'s braces: WebKit needs
      the pseudo-element rule, which only a stylesheet can carry. */
  header: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "14px 16px",
    cursor: "pointer",
    listStyle: "none",
  } satisfies CSSProperties,
  iconBox: {
    display: "inline-grid",
    placeItems: "center",
    width: 28,
    height: 28,
    borderRadius: 7,
    background: "var(--sugg-bg)",
    color: "var(--accent-text)",
    flexShrink: 0,
  } satisfies CSSProperties,
  heading: {
    margin: 0,
    fontSize: 15,
    fontWeight: 600,
    color: "var(--text-primary)",
    letterSpacing: "-0.01em",
  } satisfies CSSProperties,
  /** The mockup draws `^` on an expanded card: one glyph, rotated. */
  chevron: (open: boolean) =>
    ({
      marginLeft: "auto",
      color: "var(--text-muted)",
      flexShrink: 0,
      transform: open ? "rotate(180deg)" : "none",
      transition: "transform .12s",
    }) satisfies CSSProperties,
  body: { padding: "0 16px 16px" } satisfies CSSProperties,
} as const;
