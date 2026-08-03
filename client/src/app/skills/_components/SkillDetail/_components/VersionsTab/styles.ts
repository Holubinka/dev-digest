import type { CSSProperties } from "react";

/** Co-located styles for the skill Versions tab. */
export const s = {
  wrap: {
    padding: "20px 28px 40px",
    display: "flex",
    flexDirection: "column",
    gap: 12,
    maxWidth: 900,
  } satisfies CSSProperties,
  h2: { fontSize: 14, fontWeight: 700 } satisfies CSSProperties,
  hint: { fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.5 } satisfies CSSProperties,
  entry: {
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
    overflow: "hidden",
  } satisfies CSSProperties,
  entryHead: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 14px",
  } satisfies CSSProperties,
  version: { fontSize: 13, fontWeight: 600 } satisfies CSSProperties,
  when: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  stat: (added: number, removed: number): CSSProperties => ({
    fontSize: 12,
    color: added > 0 && removed === 0 ? "var(--ok)" : removed > 0 && added === 0 ? "var(--crit)" : "var(--text-muted)",
  }),
  actions: { marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 } satisfies CSSProperties,
  diffPane: { borderTop: "1px solid var(--border)", background: "var(--code-bg)" } satisfies CSSProperties,
  diffLabel: {
    padding: "6px 14px",
    fontSize: 12,
    color: "var(--text-muted)",
    borderBottom: "1px solid var(--border)",
  } satisfies CSSProperties,
  diffBody: { margin: 0, padding: "8px 0", overflowX: "auto" } satisfies CSSProperties,
  line: (op: "same" | "add" | "remove"): CSSProperties => ({
    display: "block",
    padding: "0 14px",
    fontSize: 12,
    lineHeight: "18px",
    whiteSpace: "pre",
    color:
      op === "add"
        ? "var(--code-add-text)"
        : op === "remove"
          ? "var(--code-del-text)"
          : "var(--text-secondary)",
    background: op === "add" ? "var(--code-add)" : op === "remove" ? "var(--code-del)" : "transparent",
  }),
  empty: { fontSize: 13, color: "var(--text-muted)" } satisfies CSSProperties,
} as const;
