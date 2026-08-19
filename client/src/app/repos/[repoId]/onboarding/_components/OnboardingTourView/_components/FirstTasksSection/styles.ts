import type { CSSProperties } from "react";

export const s = {
  /**
   * `auto-fill` + `minmax` rather than a fixed three columns: the track count
   * follows the width with no media query, so nothing here is a property a
   * breakpoint changes and nothing has to move to `app/globals.css`.
   */
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
    gap: 12,
  } satisfies CSSProperties,
  card: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    minWidth: 0,
    padding: 14,
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-primary)",
  } satisfies CSSProperties,
  title: {
    margin: 0,
    fontSize: 13.5,
    fontWeight: 600,
    lineHeight: 1.4,
    color: "var(--text-primary)",
    overflowWrap: "break-word",
  } satisfies CSSProperties,
  /**
   * The control that opens the detail window is the TITLE, so it has to be a
   * button that still reads as the heading the mockup draws: the type comes from
   * `title` above through `font: inherit`, and only the browser's button
   * chrome — background, border, padding, centring — is taken back off. The
   * focus ring is deliberately NOT removed; it is the only thing that tells a
   * keyboard reader where they are.
   */
  titleButton: {
    font: "inherit",
    color: "inherit",
    textAlign: "left",
    background: "none",
    border: 0,
    padding: 0,
    cursor: "pointer",
  } satisfies CSSProperties,
  badgeRow: { marginTop: "auto" } satisfies CSSProperties,
  empty: {
    margin: 0,
    fontSize: 13,
    lineHeight: 1.6,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
} as const;
