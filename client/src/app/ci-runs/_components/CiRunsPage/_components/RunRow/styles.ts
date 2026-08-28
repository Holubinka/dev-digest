import type { CSSProperties } from "react";
import { GRID, GRID_GAP } from "../../constants";

/** Co-located styles for one CI run row. */
export const s = {
  row: {
    display: "grid",
    gridTemplateColumns: GRID,
    alignItems: "center",
    gap: GRID_GAP,
    padding: "12px 18px",
    borderBottom: "1px solid var(--border)",
  } satisfies CSSProperties,
  repo: {
    fontSize: 13,
    fontWeight: 550,
    minWidth: 0,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  } satisfies CSSProperties,
  cell: {
    fontSize: 13,
    color: "var(--text-secondary)",
    minWidth: 0,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  } satisfies CSSProperties,
  num: {
    fontSize: 13,
    color: "var(--text-secondary)",
    textAlign: "right",
  } satisfies CSSProperties,
  jobCell: {
    fontSize: 13,
    textAlign: "right",
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  link: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    color: "var(--accent-text)",
    fontWeight: 550,
  } satisfies CSSProperties,
} as const;
