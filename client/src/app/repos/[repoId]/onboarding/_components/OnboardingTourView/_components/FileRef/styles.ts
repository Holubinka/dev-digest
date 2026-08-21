import type { CSSProperties } from "react";

/**
 * A repository path is one word to a line breaker — Chrome breaks at a `-` and
 * nowhere else, not even after a `/` — so both halves are needed and neither
 * works alone: `overflowWrap` permits the break, `minWidth: 0` is what lets a
 * flex item be given a line narrow enough to need one (`BriefRef/styles.ts`).
 */
const breakable = { minWidth: 0, overflowWrap: "break-word" } satisfies CSSProperties;

export const s = {
  /** A path that could not become a link: text, never a dead control. */
  plain: { ...breakable, fontSize: 13, color: "var(--text-secondary)" } satisfies CSSProperties,
  /** Carries `breakable` around the vendored anchor, which takes no `style`. */
  link: { ...breakable } satisfies CSSProperties,
} as const;
