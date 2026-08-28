import type { CSSProperties } from "react";

/* Colocated styles for the results page and everything under it.

   Two properties are NOT here and cannot be: the columns grid's track sizing and
   the takes grid's column count both change at a breakpoint, so they live in
   `app/globals.css` under `.dd-multiagent-columns` and `.dd-take-grid` — an
   inline style beats a stylesheet rule whatever the selector, and leaving them
   here as well would silently stop the page responding (`client/AGENTS.md`).
   `.dd-take-note`'s line clamp is there for the same reason of being one place. */
export const s = {
  loading: {
    display: "flex",
    flexDirection: "column",
    gap: 16,
    maxWidth: 1080,
    margin: "0 auto",
  } satisfies CSSProperties,

  // ---- header ----
  header: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
    padding: "18px 28px 12px",
  } satisfies CSSProperties,
  h1: {
    fontSize: 20,
    fontWeight: 700,
    letterSpacing: "-0.02em",
  } satisfies CSSProperties,
  headerCount: {
    fontSize: 12.5,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  headerRight: {
    marginLeft: "auto",
    display: "flex",
    alignItems: "center",
    gap: 10,
  } satisfies CSSProperties,
  switch: {
    display: "flex",
    gap: 2,
    background: "var(--bg-surface)",
    border: "1px solid var(--border)",
    borderRadius: 7,
    padding: 2,
  } satisfies CSSProperties,
  switchBtn: (on: boolean): CSSProperties => ({
    padding: "4px 12px",
    fontSize: 11.5,
    fontWeight: 600,
    borderRadius: 5,
    border: "none",
    cursor: "pointer",
    textTransform: "capitalize",
    fontFamily: "inherit",
    background: on ? "var(--bg-elevated)" : "transparent",
    color: on ? "var(--text-primary)" : "var(--text-muted)",
  }),

  // ---- meta row ----
  metaRow: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
    padding: "14px 28px",
    borderTop: "1px solid var(--border)",
    borderBottom: "1px solid var(--border)",
    fontSize: 12.5,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  metaNumber: {
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  metaTitle: {
    fontWeight: 600,
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  metaRight: {
    marginLeft: "auto",
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
  } satisfies CSSProperties,
  metaIcon: {
    color: "var(--accent)",
    flexShrink: 0,
  } satisfies CSSProperties,

  // ---- columns ----
  columnsPage: {
    paddingTop: 20,
  } satisfies CSSProperties,
  column: (color: string): CSSProperties => ({
    border: "1px solid var(--border)",
    borderTop: "2px solid " + color,
    borderRadius: 9,
    background: "var(--bg-elevated)",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    minWidth: 0,
  }),
  columnHead: {
    display: "flex",
    alignItems: "flex-start",
    gap: 9,
    padding: 12,
    borderBottom: "1px solid var(--border)",
  } satisfies CSSProperties,
  columnHeadMain: {
    minWidth: 0,
    flex: 1,
  } satisfies CSSProperties,
  columnNameRow: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    minWidth: 0,
  } satisfies CSSProperties,
  columnName: {
    fontSize: 12.5,
    fontWeight: 600,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  } satisfies CSSProperties,
  deletedTag: {
    fontSize: 9.5,
    fontWeight: 700,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
    border: "1px solid var(--border)",
    borderRadius: 4,
    padding: "0 4px",
    flexShrink: 0,
  } satisfies CSSProperties,
  columnMeta: {
    fontSize: 10.5,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  /** The state badge and the `time · cost` figures, on one line. `flexWrap` for
      the narrowest column: the badge is the element that must stay whole, so the
      numbers are what drops to a second row rather than the word being clipped. */
  columnStateRow: {
    display: "flex",
    alignItems: "center",
    gap: 7,
    flexWrap: "wrap",
    marginTop: 3,
  } satisfies CSSProperties,
  /**
   * `overflowWrap` because a provider's failure reason is not prose: OpenRouter
   * answers a spent key with `403 Key limit exceeded … https://openrouter.ai/
   * workspaces/default/keys/<64 hex>`, and that URL is ONE word to a line
   * breaker, so without this it runs straight out of the column. The flex parent
   * (`columnHeadMain`) already carries `minWidth: 0`, which is the other half —
   * see `pulls/[number]/_components/BriefRef/styles.ts` for why one without the
   * other does nothing.
   */
  columnError: {
    fontSize: 11,
    color: "var(--crit)",
    marginTop: 3,
    lineHeight: 1.35,
    overflowWrap: "anywhere",
  } satisfies CSSProperties,
  columnLive: {
    fontSize: 10.5,
    color: "var(--text-secondary)",
    marginTop: 3,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  } satisfies CSSProperties,
  noScore: {
    fontSize: 13,
    color: "var(--text-muted)",
    flexShrink: 0,
  } satisfies CSSProperties,
  columnBody: {
    padding: 12,
    display: "flex",
    flexDirection: "column",
    gap: 7,
    flex: 1,
  } satisfies CSSProperties,
  columnEmpty: {
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  mini: (color: string): CSSProperties => ({
    padding: "8px 10px",
    borderRadius: 6,
    background: "var(--bg-surface)",
    borderLeft: "2px solid " + color,
  }),
  miniTitleRow: {
    display: "flex",
    alignItems: "center",
    gap: 6,
  } satisfies CSSProperties,
  miniTitle: {
    fontSize: 12,
    fontWeight: 600,
    lineHeight: 1.3,
  } satisfies CSSProperties,
  /** Carries the top margin, because `FileRef` renders an inline `<a>` or
      `<span>` and a vertical margin does not apply to a non-replaced inline. */
  miniFileRow: {
    marginTop: 4,
  } satisfies CSSProperties,
  miniFile: {
    fontSize: 10.5,
    color: "var(--text-muted)",
    wordBreak: "break-all",
  } satisfies CSSProperties,
  columnFoot: {
    padding: "9px 12px",
    borderTop: "1px solid var(--border)",
    background: "var(--bg-surface)",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  } satisfies CSSProperties,
  columnCount: {
    fontSize: 11,
    color: "var(--text-muted)",
  } satisfies CSSProperties,

  // ---- tabs ----
  tabsWrap: {
    display: "flex",
    flexDirection: "column",
  } satisfies CSSProperties,
  tabBar: {
    display: "flex",
    gap: 2,
    padding: "0 28px",
    borderBottom: "1px solid var(--border)",
    overflowX: "auto",
  } satisfies CSSProperties,
  tab: (on: boolean, color: string): CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "12px 16px",
    border: "none",
    background: "transparent",
    borderBottom: "2px solid " + (on ? color : "transparent"),
    marginBottom: -1,
    cursor: "pointer",
    whiteSpace: "nowrap",
    fontFamily: "inherit",
  }),
  tabName: (on: boolean): CSSProperties => ({
    fontSize: 13,
    fontWeight: on ? 600 : 500,
    color: on ? "var(--text-primary)" : "var(--text-secondary)",
  }),
  tabScore: {
    fontSize: 11,
    fontWeight: 700,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  /**
   * The findings column, and it is the PR page's measurements exactly:
   * `pulls/[number]/page.tsx:221` wraps its tabs in `maxWidth: 1080` with
   * `margin: 0 auto`, so a finding card is the same width and sits in the same
   * place on both screens — which is what "the card should look exactly like the
   * one in a pull request" asks for, the card component already being shared.
   *
   * It was 760 and flush left, which on a wide window left the right half empty
   * and squeezed long rationales into a narrow ribbon. NOT simply unbounded:
   * across a 2400px window a rationale would run one line the full width, which
   * is worse to read than the ribbon and is not what the PR page does either.
   * `.dd-page` supplies only padding — the cap has never lived there.
   */
  tabBody: {
    maxWidth: 1080,
    margin: "0 auto",
  } satisfies CSSProperties,
  agentHead: (color: string): CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 14,
    padding: "14px 16px",
    borderRadius: 9,
    border: "1px solid var(--border)",
    borderLeft: "3px solid " + color,
    background: "var(--bg-elevated)",
    marginBottom: 18,
  }),
  agentHeadMain: {
    minWidth: 0,
    flex: 1,
  } satisfies CSSProperties,
  agentHeadName: (color: string): CSSProperties => ({
    fontSize: 14,
    fontWeight: 600,
    color,
  }),
  agentSummary: {
    fontSize: 13,
    color: "var(--text-secondary)",
    marginTop: 4,
    lineHeight: 1.5,
  } satisfies CSSProperties,
  agentError: {
    fontSize: 12.5,
    color: "var(--crit)",
    marginTop: 4,
    lineHeight: 1.45,
    overflowWrap: "anywhere",
  } satisfies CSSProperties,
  agentHeadRight: {
    marginLeft: "auto",
    textAlign: "right",
    display: "flex",
    flexDirection: "column",
    gap: 4,
    flexShrink: 0,
  } satisfies CSSProperties,
  agentHeadMeta: {
    fontSize: 11,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  findingList: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
  } satisfies CSSProperties,

  // ---- the two actions that have nothing to call yet ----
  /** One flex item of `FindingCard`'s actions row, so wrapping a button changes
      no spacing. It exists to catch the pointer: a `disabled` button dispatches
      no mouse events, and that is half of why the old one could not explain
      itself. */
  inertWrap: {
    display: "inline-flex",
  } satisfies CSSProperties,
  /** Reads as unavailable without BEING `disabled` — see `FindingActions`. The
      background and colour pin the ghost button's resting look so that hovering
      it does not light it up like something that would respond. */
  inertBtn: {
    opacity: 0.6,
    cursor: "not-allowed",
    background: "transparent",
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  /** Its own line under the actions, so it never reflows the buttons. */
  inertHint: {
    flexBasis: "100%",
    marginTop: 2,
    fontSize: 11.5,
    lineHeight: 1.45,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  /** Reachable by a screen reader, invisible to everyone else. The clip-rect
      idiom rather than `display: none`, which would take it out of the
      accessibility tree and with it the `aria-describedby` this is the target
      of. There is no `.sr-only` utility in this app to reuse. */
  srOnly: {
    position: "absolute",
    width: 1,
    height: 1,
    padding: 0,
    margin: -1,
    overflow: "hidden",
    clip: "rect(0 0 0 0)",
    whiteSpace: "nowrap",
    border: 0,
  } satisfies CSSProperties,

  // ---- reply to author ----
  reply: {
    flexBasis: "100%",
    display: "flex",
    flexDirection: "column",
    gap: 8,
    marginTop: 10,
    padding: 12,
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
  replyWarn: {
    display: "flex",
    alignItems: "flex-start",
    gap: 8,
    fontSize: 12,
    lineHeight: 1.45,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  warnIcon: {
    color: "var(--warn)",
    flexShrink: 0,
    marginTop: 2,
  } satisfies CSSProperties,
  replyTarget: {
    fontSize: 11,
    color: "var(--text-muted)",
    wordBreak: "break-all",
  } satisfies CSSProperties,
  replyActions: {
    display: "flex",
    gap: 8,
  } satisfies CSSProperties,
  replyError: {
    fontSize: 12,
    color: "var(--crit)",
    lineHeight: 1.45,
  } satisfies CSSProperties,
  replyOk: {
    fontSize: 12,
    color: "var(--ok)",
  } satisfies CSSProperties,
  replyLink: {
    color: "var(--accent-text)",
    textDecoration: "underline",
    textUnderlineOffset: 2,
  } satisfies CSSProperties,

  // ---- where agents disagree ----
  section: {
    padding: "22px 28px 40px",
  } satisfies CSSProperties,
  sectionWrap: {
    borderTop: "1px solid var(--border)",
    marginTop: 8,
  } satisfies CSSProperties,
  toggleRow: {
    display: "flex",
    alignItems: "center",
    gap: 7,
    fontSize: 12,
    color: "var(--text-secondary)",
    cursor: "pointer",
  } satisfies CSSProperties,
  notFinal: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    marginBottom: 12,
    padding: "3px 9px",
    borderRadius: 99,
    border: "1px solid var(--border-strong)",
    background: "var(--bg-surface)",
    fontSize: 11.5,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  mutedIcon: {
    color: "var(--text-muted)",
    flexShrink: 0,
  } satisfies CSSProperties,
  positions: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
  } satisfies CSSProperties,
  position: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    overflow: "hidden",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  positionHead: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
    padding: "10px 14px",
    borderBottom: "1px solid var(--border)",
  } satisfies CSSProperties,
  positionFile: {
    fontSize: 12,
    wordBreak: "break-all",
  } satisfies CSSProperties,
  positionTitle: {
    fontSize: 13,
    fontWeight: 600,
    marginLeft: 6,
  } satisfies CSSProperties,
  take: {
    padding: "10px 14px",
    background: "var(--bg-elevated)",
    minWidth: 0,
  } satisfies CSSProperties,
  takePersona: {
    fontSize: 11.5,
    fontWeight: 600,
    color: "var(--text-secondary)",
    marginBottom: 4,
  } satisfies CSSProperties,
  takeMarkerRow: {
    display: "flex",
    alignItems: "center",
    gap: 5,
    marginBottom: 4,
  } satisfies CSSProperties,
  /** Flagged and `did not flag`: a filled round dot, as the mockup draws it. */
  markerDot: (color: string): CSSProperties => ({
    width: 7,
    height: 7,
    borderRadius: 99,
    background: color,
    flexShrink: 0,
  }),
  /** `not_reviewed`: a hollow RING — AC-121 asks for a different SHAPE, not a
      different shade, so it stays legible to a reader who cannot separate greys. */
  markerRing: {
    width: 9,
    height: 9,
    borderRadius: 99,
    border: "1.5px dashed var(--text-muted)",
    background: "transparent",
    flexShrink: 0,
  } satisfies CSSProperties,
  takeVerdict: {
    fontSize: 11,
    fontWeight: 600,
    color: "var(--text-primary)",
    textTransform: "uppercase",
    letterSpacing: "0.03em",
  } satisfies CSSProperties,
  takeSilent: {
    fontSize: 11,
    fontWeight: 600,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  takeStateWord: {
    fontSize: 11,
    fontWeight: 600,
    color: "var(--text-muted)",
    fontStyle: "italic",
  } satisfies CSSProperties,
  takeNote: {
    fontSize: 11.5,
    color: "var(--text-muted)",
    lineHeight: 1.4,
  } satisfies CSSProperties,
};
