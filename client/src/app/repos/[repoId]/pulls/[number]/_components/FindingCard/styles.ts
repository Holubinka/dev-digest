import type { CSSProperties } from "react";

/** Co-located styles for FindingCard (extracted from inline styles). */
export const s = {
  card: (focused: boolean, sevColor: string): CSSProperties => ({
    borderRadius: 8,
    // Every border colour and width is PER SIDE. `borderColor` and `borderWidth`
    // look like longhands next to `border`, but they are themselves shorthands
    // for the four sides — pairing either with `borderLeft*` is the mix React
    // warns about ("Updating a style property during rerender (borderColor) when
    // a conflicting property is set (borderLeftColor)"). It fired on every j/k
    // press in FindingsPanel, because `focused` flips the colour.
    // `borderStyle` stays: no per-side style longhand is set, so nothing conflicts.
    borderStyle: "solid",
    borderTopWidth: 1,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderLeftWidth: 3,
    borderTopColor: focused ? sevColor : "var(--border)",
    borderRightColor: focused ? sevColor : "var(--border)",
    borderBottomColor: focused ? sevColor : "var(--border)",
    borderLeftColor: sevColor,
    background: "var(--bg-elevated)",
    overflow: "hidden",
    transition: "border-color .12s, box-shadow .12s",
    boxShadow: focused ? "0 0 0 1px " + sevColor : "none",
  }),
  /**
   * `opacity` used to live on `card` and dim the WHOLE card once decided —
   * Accept/Dismiss included. Nothing there is actually `disabled`: a decided
   * finding can still switch decisions (accept → dismiss and back) and the
   * server accepts it every time, but a faded button reads as an inert one.
   * Applied to `header` and `contentFade` only, never to `actions`, so a
   * decided finding still visually de-emphasizes its title and body while its
   * buttons stay full-opacity and obviously clickable.
   */
  header: (muted: boolean): CSSProperties => ({
    display: "flex",
    alignItems: "flex-start",
    gap: 12,
    padding: "14px 16px",
    cursor: "pointer",
    opacity: muted ? 0.6 : 1,
    transition: "opacity .2s",
  }),
  contentFade: (muted: boolean): CSSProperties => ({
    opacity: muted ? 0.6 : 1,
    transition: "opacity .2s",
  }),
  badgeWrap: { paddingTop: 1 } satisfies CSSProperties,
  headerMain: { flex: 1, minWidth: 0 } satisfies CSSProperties,
  titleRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  title: (muted: boolean, dismissed: boolean): CSSProperties => ({
    fontSize: 14,
    fontWeight: 600,
    color: muted ? "var(--text-muted)" : "var(--text-primary)",
    textDecoration: dismissed ? "line-through" : "none",
  }),
  acceptedTag: { fontSize: 12, fontWeight: 600, color: "var(--ok)" } satisfies CSSProperties,
  dismissedTag: {
    fontSize: 12,
    fontWeight: 600,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  metaRow: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    marginTop: 5,
  } satisfies CSSProperties,
  chevron: (expanded: boolean): CSSProperties => ({
    color: "var(--text-muted)",
    transform: expanded ? "rotate(180deg)" : "none",
    transition: "transform .15s",
    marginTop: 2,
    flexShrink: 0,
  }),
  body: { padding: "14px 16px 16px", borderTop: "1px solid var(--border)" } satisfies CSSProperties,
  trifectaWrap: { marginBottom: 14 } satisfies CSSProperties,
  prose: {
    fontSize: 14,
    lineHeight: 1.6,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  suggestionWrap: { marginTop: 14 } satisfies CSSProperties,
  suggestionLabel: {
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: "0.05em",
    color: "var(--text-muted)",
    marginBottom: 8,
    textTransform: "uppercase",
  } satisfies CSSProperties,
  actions: {
    display: "flex",
    gap: 8,
    marginTop: 14,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  composer: {
    marginTop: 12,
    display: "flex",
    flexDirection: "column",
    gap: 10,
  } satisfies CSSProperties,
  composerActions: { display: "flex", gap: 8 } satisfies CSSProperties,
} as const;
