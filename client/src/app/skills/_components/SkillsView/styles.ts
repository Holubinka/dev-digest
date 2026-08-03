import type { CSSProperties } from "react";

/** Co-located styles for the two-column Skills shell. */
export const s = {
  shell: { display: "flex", height: "calc(100vh - 52px)" } satisfies CSSProperties,
  placeholder: {
    flex: 1,
    display: "grid",
    placeItems: "center",
    padding: 28,
  } satisfies CSSProperties,
} as const;
