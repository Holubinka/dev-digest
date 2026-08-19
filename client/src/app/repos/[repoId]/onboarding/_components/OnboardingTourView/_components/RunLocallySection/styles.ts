import type { CSSProperties } from "react";

export const s = {
  rows: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
  } satisfies CSSProperties,
  block: { marginTop: 16 } satisfies CSSProperties,
  blockHead: {
    display: "flex",
    alignItems: "baseline",
    gap: 8,
    margin: "0 0 4px",
  } satisfies CSSProperties,
  blockName: {
    margin: 0,
    fontSize: 13,
    fontWeight: 600,
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  blockPath: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  blockNote: {
    margin: "0 0 8px",
    fontSize: 12,
    lineHeight: 1.5,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  envList: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: 4,
  } satisfies CSSProperties,
  envRow: {
    display: "flex",
    alignItems: "baseline",
    gap: 8,
    flexWrap: "wrap",
    fontSize: 12.5,
  } satisfies CSSProperties,
  envName: { color: "var(--text-primary)" } satisfies CSSProperties,
  envSource: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  /** The lines under the blocks: attribution, what was cut, what was not found. */
  note: {
    margin: "12px 0 0",
    fontSize: 12,
    lineHeight: 1.55,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  empty: {
    margin: 0,
    fontSize: 13,
    lineHeight: 1.6,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
} as const;
