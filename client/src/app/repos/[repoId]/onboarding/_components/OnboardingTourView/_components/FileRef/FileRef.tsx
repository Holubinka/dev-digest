/* FileRef — one path out of a tour, as a link to the file or as plain text.

   The three conditions live in `helpers.ts` beside the reasons for them. What
   this file adds is the other half of the rule: when they do not hold the path
   renders as a `<span className="mono">` and NOT as a `MonoLink` without an
   `href`, which is a `<button>` with nothing behind it. */
"use client";

import React from "react";
import { MonoLink } from "@devdigest/ui";
import { fileHref } from "./helpers";
import { s } from "./styles";

export function FileRef({
  path,
  repoFullName,
  indexSha,
}: {
  path: string;
  /** `owner/repo`, or null until the active repository resolves. */
  repoFullName: string | null | undefined;
  /** The tour's own `index_state.last_indexed_sha`, never the branch head. */
  indexSha: string | null | undefined;
}) {
  const href = fileHref(path, repoFullName, indexSha);

  return href ? (
    <span style={s.link}>
      <MonoLink href={href}>{path}</MonoLink>
    </span>
  ) : (
    <span className="mono" style={s.plain}>
      {path}
    </span>
  );
}
