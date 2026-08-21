import type { CSSProperties } from "react";

/** Nothing here declares a property a breakpoint changes: the notes are full
 *  width in every layout, and the one thing that responds on this page is the
 *  rail/content split in `app/globals.css`. */
export const s = {
  note: {
    margin: 0,
    padding: "10px 14px",
    background: "var(--bg-elevated)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    fontSize: 12.5,
    lineHeight: 1.6,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
};
