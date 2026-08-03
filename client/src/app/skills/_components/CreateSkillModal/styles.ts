import type { CSSProperties } from "react";

/** Co-located styles for CreateSkillModal.
 *  `Modal` pads its header and footer but NOT its body — unlike `Drawer`, which
 *  pads at 24. The body inset is therefore ours to add, matched to the header so
 *  the fields line up with the title instead of running to the edge. */
export const s = {
  body: {
    padding: "18px 24px",
    display: "flex",
    flexDirection: "column",
    gap: 14,
  } satisfies CSSProperties,
  /** Name and type share a row: the modal is capped at 92% of the viewport, and
   *  every field stacked full-width pushed the body editor below the fold. */
  row: {
    display: "grid",
    gridTemplateColumns: "1fr 220px",
    gap: 14,
    alignItems: "start",
  } satisfies CSSProperties,
  footer: { display: "flex", alignItems: "center", gap: 10 } satisfies CSSProperties,
  footerNote: { fontSize: 12, color: "var(--text-muted)", marginRight: "auto" } satisfies CSSProperties,
} as const;
