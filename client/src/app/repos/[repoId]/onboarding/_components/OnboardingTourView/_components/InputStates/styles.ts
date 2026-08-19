import type { CSSProperties } from "react";

/** Nothing here declares a property a breakpoint changes: the input list is
 *  full width in every layout, and the one thing that responds on this page is
 *  the rail/content split in `app/globals.css`. */
export const s = {
  block: {
    marginTop: 24,
    background: "var(--bg-elevated)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    padding: "14px 16px",
  } satisfies CSSProperties,
  title: {
    margin: "0 0 10px",
    fontSize: 13,
    fontWeight: 600,
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  list: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: 6,
  } satisfies CSSProperties,
  row: {
    display: "flex",
    alignItems: "baseline",
    gap: 8,
    fontSize: 12.5,
    lineHeight: 1.5,
    minWidth: 0,
  } satisfies CSSProperties,
  label: { color: "var(--text-secondary)" } satisfies CSSProperties,
  status: { color: "var(--text-primary)", fontWeight: 500 } satisfies CSSProperties,
  detail: { color: "var(--text-muted)", minWidth: 0, overflowWrap: "anywhere" } satisfies CSSProperties,
} as const;
