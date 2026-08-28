/* FileRef — a finding's `file:line`, as a link into the code when one can be
   built and as plain text when it cannot.

   TWO CONSUMERS, so it lives here rather than beside either: the compact card in
   `ColumnsView` and the position header in `ConflictsSection` print the same
   reference at different sizes. `FindingCard` is NOT one of them — it builds its
   own link and has done since the PR page, and giving it a second implementation
   is how one finding starts linking in Tabs and not in Columns.

   THE BASE STYLE ARRIVES FROM THE CALLER because the two differ (10.5px muted in
   a column, 12px in a section header) and only the link affordance is shared.
   Hover lives in React state for the reason every hover in this app does: these
   are inline styles, and `:hover` is not expressible in one.

   `stopPropagation` so that a reference inside anything clickable opens the code
   instead of toggling its container — `FindingCard`'s own link does the same,
   and neither header is clickable today. */
"use client";

import React from "react";
import type { CSSProperties } from "react";

export function FileRef({
  href,
  style,
  children,
}: {
  /** `undefined` when no honest link exists — see `fileRefHref`. */
  href?: string;
  style?: CSSProperties;
  children: React.ReactNode;
}) {
  const [hover, setHover] = React.useState(false);

  if (!href) {
    return (
      <span className="mono" style={style}>
        {children}
      </span>
    );
  }

  return (
    <a
      className="mono"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        ...style,
        color: hover ? "var(--accent-text)" : style?.color,
        textDecoration: hover ? "underline" : "none",
        textUnderlineOffset: 2,
        cursor: "pointer",
      }}
    >
      {children}
    </a>
  );
}
