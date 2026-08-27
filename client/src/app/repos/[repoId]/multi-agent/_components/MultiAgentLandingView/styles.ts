import type { CSSProperties } from "react";

/* Padding is `.dd-page`'s alone (`client/AGENTS.md`): it changes at 680px, and
   an inline `padding` here would beat the media query and stop the page
   responding. */
export const s = {
  loading: {
    display: "flex",
    flexDirection: "column",
    gap: 16,
    maxWidth: 1080,
    margin: "0 auto",
  } satisfies CSSProperties,
};
