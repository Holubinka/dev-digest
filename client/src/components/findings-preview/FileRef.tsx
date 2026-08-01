/* FileRef — a finding's `path:line` citation, linked to the file on GitHub when
   the caller knows the repo and the head sha, plain text when it does not. A
   citation that goes nowhere beats one that looks clickable and 404s.

   Not `MonoLink`: that primitive fixes its own font size and takes no style, and
   the card elides long paths with a two-span flex layout it cannot carry. */
"use client";

import React from "react";
import { lineRef, shortPath } from "./helpers";
import { s } from "./styles";

export function FileRef({
  file,
  startLine,
  endLine,
  href,
}: {
  file: string;
  startLine: number;
  endLine: number;
  /** Absent when the repo name or head sha is unknown — renders inert. */
  href?: string;
}) {
  const [hover, setHover] = React.useState(false);
  const label = `${file}:${lineRef(startLine, endLine)}`;
  const body = (
    <>
      <span style={s.itemPath}>{shortPath(file)}</span>
      <span style={s.itemLine}>:{lineRef(startLine, endLine)}</span>
    </>
  );

  if (!href) {
    return (
      <span className="mono" style={s.itemFile} title={label}>
        {body}
      </span>
    );
  }

  return (
    <a
      className="mono"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={label}
      style={s.itemFileLink(hover)}
      // The PR list row navigates on click. Opening a finding's file must not
      // drag the whole row along with it.
      onClick={(e) => e.stopPropagation()}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {body}
    </a>
  );
}

export default FileRef;
