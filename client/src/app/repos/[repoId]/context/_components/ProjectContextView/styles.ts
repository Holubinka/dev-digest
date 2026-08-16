import type { CSSProperties } from "react";

/** Co-located styles for the Project Context screen. */
export const s = {
  page: { display: "flex", flexDirection: "column", gap: 16, minHeight: 0 } satisfies CSSProperties,
  /* No page header: the design gives this screen none, and the list panel's own
     `PROJECT CONTEXT` label names it. The breadcrumb still carries the title. */
  /** Two panes: the list, then the reader. Stacks under 680px via globals.css. */
  panes: {
    display: "flex",
    gap: 16,
    alignItems: "stretch",
    flex: 1,
    minHeight: 0,
  } satisfies CSSProperties,
  /**
   * The list column is a PANEL, the shape `skills/_components/SkillsList` and
   * `agents/[id]/…/AgentEditorView` already use: a bounded column on its own
   * surface, with a scroll region of its own between a fixed head and a fixed
   * foot. It carries a full border rather than those two screens' `borderRight`
   * because it sits on a padded page beside a bordered card, not against the
   * edge of the shell.
   *
   * `width` and `flexShrink` are deliberately ABSENT: the 680px breakpoint
   * changes the width, and an inline style beats a stylesheet rule whatever the
   * selector. Both live in `globals.css` under `.dd-context-list`.
   */
  listPane: {
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
    minHeight: 0,
    border: "1px solid var(--border)",
    borderRadius: 10,
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
  /** The panel's own head: what this column lists, and the roots it lists from. */
  listHead: { padding: "14px 14px 12px", flexShrink: 0 } satisfies CSSProperties,
  listRoots: {
    display: "block",
    fontSize: 12,
    lineHeight: 1.5,
    color: "var(--text-muted)",
    overflowWrap: "anywhere",
  } satisfies CSSProperties,
  /** The action bar's home inside the panel; the rule under it spans the column. */
  listToolbar: {
    padding: "0 14px 12px",
    borderBottom: "1px solid var(--border)",
    flexShrink: 0,
  } satisfies CSSProperties,
  /** The only part of the panel that scrolls — the head, the bar and the footer stay. */
  listScroll: { flex: 1, minHeight: 0, overflow: "auto" } satisfies CSSProperties,
  readerPane: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    gap: 12,
    border: "1px solid var(--border)",
    borderRadius: 10,
    background: "var(--bg-surface)",
    padding: "18px 22px",
    fontSize: 13,
    color: "var(--text-primary)",
    overflow: "auto",
  } satisfies CSSProperties,

  /** The four write controls, above the list and nowhere else on the page. */
  actionBar: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  actionNote: {
    fontSize: 12,
    color: "var(--text-muted)",
    lineHeight: 1.45,
    padding: "8px 2px 0",
  } satisfies CSSProperties,
  actionError: {
    fontSize: 12,
    color: "var(--crit)",
    lineHeight: 1.45,
    padding: "8px 2px 0",
  } satisfies CSSProperties,

  /**
   * One group header per scan root — the root printed here and not on the rows.
   *
   * It is a band the full width of the panel, on its own surface and closed by a
   * rule top and bottom, because spacing alone did not read as a boundary: four
   * roots looked like one list with gaps in it. The first band drops its top
   * rule, which would otherwise double the toolbar's.
   */
  groupHeader: (first: boolean): CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "7px 14px",
    // `--bg-hover`, not `--bg-elevated`: elevated IS the panel's own white in the
    // light theme (#ffffff on #fafafa), so the band would have carried no
    // separation there at all. Hover steps away from the surface in both.
    background: "var(--bg-hover)",
    borderTop: first ? "none" : "1px solid var(--border)",
    borderBottom: "1px solid var(--border)",
  }),
  groupRoot: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: "var(--text-secondary)",
    minWidth: 0,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  } satisfies CSSProperties,
  /** The rows of one group, inset from the bands that bound them. */
  groupRows: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    padding: "6px 8px",
  } satisfies CSSProperties,
  row: (selected: boolean): CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 10,
    width: "100%",
    textAlign: "left",
    padding: "7px 10px",
    borderRadius: 8,
    // The selection is the list's only accent, so it cannot be read as one of
    // the grey group bands — and a tint plus its own border says "selected" at
    // the same strength in both themes, which a grey fill does not: the light
    // theme has 2% between its surfaces and the dark one has 8%.
    border: "1px solid " + (selected ? "var(--accent)" : "transparent"),
    background: selected ? "var(--accent-bg)" : "transparent",
    cursor: "pointer",
    color: selected ? "var(--text-primary)" : "var(--text-secondary)",
    font: "inherit",
  }),
  /** Accent only on the selected row — the mock's one spot of colour in the list. */
  rowIcon: (selected: boolean): CSSProperties => ({
    color: selected ? "var(--accent)" : "var(--text-muted)",
    flexShrink: 0,
  }),
  /** The path BELOW the group's root. The root is in the header, once. */
  rowLabel: {
    fontSize: 13,
    minWidth: 0,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  } satisfies CSSProperties,
  rowBadges: {
    marginLeft: "auto",
    display: "flex",
    alignItems: "center",
    gap: 6,
    flexShrink: 0,
  } satisfies CSSProperties,

  /** The reading panel's own header: name, Preview | Edit, and the selected document's badge. */
  panelHead: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
    paddingBottom: 12,
    borderBottom: "1px solid var(--border)",
  } satisfies CSSProperties,
  panelName: { fontSize: 14, fontWeight: 600, minWidth: 0 } satisfies CSSProperties,
  toggle: {
    display: "flex",
    alignItems: "center",
    gap: 2,
    padding: 2,
    borderRadius: 7,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  panelRight: {
    marginLeft: "auto",
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexShrink: 0,
  } satisfies CSSProperties,
  usedBy: { fontSize: 12, color: "var(--text-muted)", whiteSpace: "nowrap" } satisfies CSSProperties,
  /** The local / stale explanation: a badge and the sentences that make it mean something. */
  notice: (accent: string): CSSProperties => ({
    display: "flex",
    flexDirection: "column",
    gap: 6,
    padding: "10px 12px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    borderLeft: `3px solid ${accent}`,
    background: "var(--bg-elevated)",
  }),
  noticeBody: { fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.5 } satisfies CSSProperties,
  editFooter: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  editError: { fontSize: 12, color: "var(--crit)", lineHeight: 1.45 } satisfies CSSProperties,
  /** Why Edit is unavailable — an explanation under the toggle, not an error. */
  editNote: { fontSize: 12, color: "var(--text-muted)", lineHeight: 1.45 } satisfies CSSProperties,
  readerPlaceholder: { fontSize: 13, color: "var(--text-muted)" } satisfies CSSProperties,

  /**
   * The footer carries scan output ONLY: how many, and when. Nothing else.
   *
   * It sits at the foot of the LIST panel now, not under both columns, so it
   * reads as a fact about the list it is attached to.
   */
  footer: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
    padding: "10px 14px",
    borderTop: "1px solid var(--border)",
    fontSize: 12,
    color: "var(--text-muted)",
    flexShrink: 0,
  } satisfies CSSProperties,
  failedNote: { color: "var(--crit)" } satisfies CSSProperties,

  /** The dialogs. */
  modalBody: { padding: "18px 24px 2px" } satisfies CSSProperties,
  modalFooter: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 8,
  } satisfies CSSProperties,
  modalError: {
    fontSize: 12.5,
    color: "var(--crit)",
    lineHeight: 1.5,
    marginBottom: 16,
  } satisfies CSSProperties,
  modalText: {
    fontSize: 13,
    color: "var(--text-secondary)",
    lineHeight: 1.6,
  } satisfies CSSProperties,
} as const;
