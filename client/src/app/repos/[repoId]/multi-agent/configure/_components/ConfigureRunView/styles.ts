import type { CSSProperties } from "react";

/* Colocated styles for Configure run.

   `padding` is NOT here: the page sets `.dd-page`, whose padding changes at
   680px, and an inline `padding` would beat the media query and stop the page
   responding (`client/AGENTS.md`). Everything below is static at every width. */
export const s = {
  page: {
    maxWidth: 720,
    margin: "0 auto",
  } satisfies CSSProperties,
  h1: {
    fontSize: 22,
    fontWeight: 700,
    letterSpacing: "-0.02em",
  } satisfies CSSProperties,
  subtitle: {
    fontSize: 13,
    color: "var(--text-secondary)",
    marginTop: 4,
    marginBottom: 22,
    lineHeight: 1.55,
  } satisfies CSSProperties,
  stepRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginBottom: 10,
  } satisfies CSSProperties,
  /** Dimmed until the step it numbers is reachable, exactly as the mockup draws it. */
  stepMark: (on: boolean): CSSProperties => ({
    width: 22,
    height: 22,
    borderRadius: 99,
    background: on ? "var(--accent-bg)" : "var(--bg-hover)",
    color: on ? "var(--accent-text)" : "var(--text-muted)",
    fontSize: 12,
    fontWeight: 700,
    display: "grid",
    placeItems: "center",
    flexShrink: 0,
  }),
  stepLabel: (on: boolean): CSSProperties => ({
    fontSize: 13.5,
    fontWeight: 600,
    color: on ? "var(--text-primary)" : "var(--text-muted)",
  }),
  stepBody: {
    marginLeft: 32,
    marginBottom: 24,
  } satisfies CSSProperties,
  /** The PR trigger's label. `flex: 1` claims what the icon and the chevron do
      not want, `minWidth: 0` is what lets a flex child shrink below its text at
      all, and the three text properties turn the overflow into an ellipsis
      rather than a second line — which would change the button's height. */
  prTriggerLabel: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    textAlign: "left",
  } satisfies CSSProperties,
  selectAll: {
    marginLeft: "auto",
    border: "none",
    background: "transparent",
    color: "var(--accent-text)",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "inherit",
    padding: 0,
  } satisfies CSSProperties,
  warnRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginTop: 10,
    fontSize: 12.5,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  warnIcon: {
    color: "var(--warn)",
    flexShrink: 0,
  } satisfies CSSProperties,
  mutedIcon: {
    color: "var(--text-muted)",
    flexShrink: 0,
  } satisfies CSSProperties,
  noPr: {
    padding: "34px 20px",
    borderRadius: 10,
    border: "1px dashed var(--border-strong)",
    background: "var(--bg-elevated)",
    textAlign: "center",
  } satisfies CSSProperties,
  noPrIcon: {
    width: 42,
    height: 42,
    borderRadius: 11,
    background: "var(--bg-hover)",
    display: "grid",
    placeItems: "center",
    margin: "0 auto 12px",
  } satisfies CSSProperties,
  noPrTitle: {
    fontSize: 14,
    fontWeight: 600,
  } satisfies CSSProperties,
  noPrBody: {
    fontSize: 12.5,
    color: "var(--text-muted)",
    marginTop: 5,
    maxWidth: 320,
    marginInline: "auto",
    lineHeight: 1.5,
  } satisfies CSSProperties,
  cards: {
    marginLeft: 32,
    display: "flex",
    flexDirection: "column",
    gap: 8,
  } satisfies CSSProperties,
  /** Selected: the agent's own colour on the border and at 7% behind the card. */
  card: (on: boolean, color: string, enabled: boolean): CSSProperties => ({
    padding: "12px 14px",
    borderRadius: 9,
    border: "1px solid " + (on ? color : "var(--border)"),
    background: on ? color + "12" : "var(--bg-elevated)",
    opacity: enabled ? 1 : 0.62,
    transition: "border-color .12s, background .12s",
  }),
  cardLabel: {
    display: "flex",
    alignItems: "flex-start",
    gap: 12,
    width: "100%",
    minWidth: 0,
  } satisfies CSSProperties,
  cardMain: {
    display: "flex",
    flexDirection: "column",
    gap: 3,
    minWidth: 0,
    flex: 1,
  } satisfies CSSProperties,
  cardNameRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    minWidth: 0,
  } satisfies CSSProperties,
  cardName: {
    fontSize: 13.5,
    fontWeight: 600,
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  cardDesc: {
    fontSize: 11.5,
    color: "var(--text-muted)",
    lineHeight: 1.45,
  } satisfies CSSProperties,
  cardMeta: {
    fontSize: 10.5,
    color: "var(--text-muted)",
    whiteSpace: "nowrap",
    flexShrink: 0,
    marginTop: 2,
  } satisfies CSSProperties,
  disabledTag: {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
    border: "1px solid var(--border)",
    borderRadius: 5,
    padding: "1px 5px",
    flexShrink: 0,
  } satisfies CSSProperties,
  ceilingHint: {
    marginLeft: 32,
    marginTop: 10,
    fontSize: 11.5,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  runRow: {
    display: "flex",
    alignItems: "center",
    gap: 14,
    flexWrap: "wrap",
    marginTop: 26,
    marginLeft: 32,
  } satisfies CSSProperties,
  estimate: {
    fontSize: 11.5,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  estimateNote: {
    fontSize: 11.5,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  runError: {
    marginLeft: 32,
    marginTop: 12,
    fontSize: 12.5,
    color: "var(--crit)",
  } satisfies CSSProperties,
};
