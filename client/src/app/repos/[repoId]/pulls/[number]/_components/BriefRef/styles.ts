import type { CSSProperties } from "react";

/**
 * Co-located styles for one brief reference. Tokens only — no literal colours.
 *
 * Nothing here declares a property a breakpoint changes: a reference is inline
 * content inside sections that already own their own responsive rules in
 * `app/globals.css`, and an inline style beats any stylesheet rule
 * (`client/AGENTS.md`).
 */
/**
 * What keeps a reference inside its card. Both halves are needed, and each is
 * useless without the other:
 *
 *  - `overflowWrap` — a repository path is ONE word to a line breaker. Chrome
 *    breaks at the `-` in `scan-executor.ts` and NOWHERE else, not even after a
 *    `/`, so a path without a hyphen never wraps on its own.
 *  - `minWidth` — `break-word` is deliberately not counted in min-content, so a
 *    flex item that keeps the default `min-width: auto` still refuses to shrink
 *    under its longest word, and a wrap that is never given a narrower line
 *    cannot happen. Both rows here are `display: flex`
 *    (`RiskAreas/styles.ts` `refRow`, `ReviewFocusSection/styles.ts` `focus`).
 *
 * `break-word` rather than `anywhere`, as `BlastRadiusCard/styles.ts:143` found:
 * `anywhere` splits the path at whatever column the line happens to end on and
 * leaves `helpers.ts:` on one line with `82` on the next.
 */
const breakable = { minWidth: 0, overflowWrap: "break-word" } satisfies CSSProperties;

export const s = {
  /** A reference that could not become a link. Text, never a dead control. */
  refPlain: { ...breakable, fontSize: 12.5, color: "var(--text-muted)" } satisfies CSSProperties,
  /**
   * The span around `MonoLink`. It exists ONLY to carry `breakable`: the anchor
   * is rendered by `vendor/ui`, which is a read-only copy and takes no `style`
   * — and `overflow-wrap` inherits into it from here, while `min-width` is the
   * flex item's own business and this span is the flex item.
   */
  refLink: { ...breakable } satisfies CSSProperties,
  /** A bare button: the affordance is the underline, not a second box. */
  refButton: {
    ...breakable,
    background: "none",
    border: "none",
    padding: 0,
    fontSize: 12.5,
    cursor: "pointer",
    color: "var(--accent-text)",
    textDecoration: "underline",
    textUnderlineOffset: 2,
    // A `<button>` centres its text; a path that wrapped would sit centred
    // under the rows of left-aligned references beside it.
    textAlign: "left",
  } satisfies CSSProperties,
} as const;
