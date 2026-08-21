import type { CSSProperties } from "react";

export const s = {
  button: (copied: boolean) =>
    ({
      display: "inline-grid",
      placeItems: "center",
      width: 28,
      height: 28,
      flexShrink: 0,
      borderRadius: 6,
      // The mockup draws a bare glyph at the end of each command row, with no
      // box around it. The 28px square stays: it is the tap target, not chrome.
      border: "none",
      background: "transparent",
      color: copied ? "var(--ok)" : "var(--text-muted)",
      cursor: "pointer",
      transition: "color .12s, border-color .12s",
    }) satisfies CSSProperties,
} as const;
