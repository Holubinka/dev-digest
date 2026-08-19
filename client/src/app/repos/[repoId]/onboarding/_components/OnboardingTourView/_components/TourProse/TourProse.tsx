/* TourProse — a section's model-written body, rendered as markdown.

   Through `DocumentReader` and no other renderer: it is the one place raw HTML
   stays escaped and a non-`http(s)` protocol does not become an anchor, and
   AC-68 names a second copy as the failure. */
"use client";

import React from "react";
import { DocumentReader } from "@/components/context-doc-view";
import { fileHref } from "../FileRef";
import { linkifyVerifiedPaths } from "./helpers";

export function TourProse({
  body,
  verifiedPaths,
  repoFullName,
  indexSha,
}: {
  body: string;
  /** `OnboardingSection.verified_paths` — paths inside `body` proven to exist. */
  verifiedPaths: readonly string[];
  repoFullName: string | null | undefined;
  indexSha: string | null | undefined;
}) {
  if (body.trim() === "") return null;

  // Only a verified path that ALSO survives the URL rules is offered as a
  // link — membership says the server proved the file exists, `fileHref` says
  // the string is safe in a URL, and both have to hold.
  const linkable = verifiedPaths.filter((p) => fileHref(p, repoFullName, indexSha) !== undefined);

  return (
    <DocumentReader
      markdown={linkifyVerifiedPaths(body, linkable)}
      resolvePath={(path) =>
        linkable.includes(path) ? fileHref(path, repoFullName, indexSha) : undefined
      }
    />
  );
}
