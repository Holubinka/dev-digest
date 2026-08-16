import type { CSSProperties } from "react";

/**
 * Co-located styles for one brief reference. Tokens only — no literal colours.
 *
 * Nothing here declares a property a breakpoint changes: a reference is inline
 * content inside sections that already own their own responsive rules in
 * `app/globals.css`, and an inline style beats any stylesheet rule
 * (`client/AGENTS.md`).
 */
export const s = {
  /** A reference that could not become a link. Text, never a dead control. */
  refPlain: { fontSize: 12.5, color: "var(--text-muted)" } satisfies CSSProperties,
  /** A bare button: the affordance is the underline, not a second box. */
  refButton: {
    background: "none",
    border: "none",
    padding: 0,
    fontSize: 12.5,
    cursor: "pointer",
    color: "var(--accent-text)",
    textDecoration: "underline",
    textUnderlineOffset: 2,
  } satisfies CSSProperties,
} as const;
