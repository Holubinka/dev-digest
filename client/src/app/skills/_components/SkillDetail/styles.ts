import type { CSSProperties } from "react";

/** Co-located styles for the skill detail pane. */
export const s = {
  pane: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
    minHeight: 0,
  } satisfies CSSProperties,
  header: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "16px 28px 0",
    flexShrink: 0,
  } satisfies CSSProperties,
  icon: { color: "var(--accent)", flexShrink: 0 } satisfies CSSProperties,
  name: {
    fontSize: 18,
    fontWeight: 700,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  } satisfies CSSProperties,
  enabledLabel: {
    marginLeft: "auto",
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 13,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  tabsBar: { flexShrink: 0, marginTop: 12 } satisfies CSSProperties,
  body: { flex: 1, minHeight: 0, overflow: "auto" } satisfies CSSProperties,
  loading: { flex: 1, padding: 28, display: "flex", flexDirection: "column", gap: 16 } satisfies CSSProperties,
} as const;
