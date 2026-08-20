/* BriefRef — ONE reference out of a risk brief, in the two forms the two
   consumers need. Its own folder because it is its own component with its own
   props contract and two callers in two other folders — `RiskAreas/` and
   `ReviewFocusSection/` — neither of which owns it. It used to sit un-nested
   inside `RiskAreas/` and reach the second caller through that folder's barrel,
   which then exported two different components. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { MonoLink } from "@devdigest/ui";
import { githubBlobUrl, isLinkablePath } from "@/lib/github-urls";
import type { RiskBriefRefLine } from "@/lib/types";
import { lineFor } from "./helpers";
import { s } from "./styles";

interface Common {
  /** The reference verbatim, as it stands in `Risk.file_refs` / `ReviewFocusItem.ref`. */
  refValue: string;
  refLines: RiskBriefRefLine[];
  linkSha: string | null;
  headSha: string | null;
  indexMatchesHead: boolean;
}

type BriefRefProps = Common &
  (
    | {
        /** A risk reference: a github.com blob link, or plain text. */
        as: "link";
        /** `owner/repo`, or null until the repo loads. No repo, no link. */
        repoFullName: string | null;
      }
    | {
        /** A review-focus reference: opens in Files changed, or plain text. */
        as: "open";
        /** The paths THIS PR changed — what decides whether a jump has a target. */
        changedPaths: ReadonlySet<string>;
        onOpenFile: (path: string, line?: number) => void;
      }
  );

/**
 * ONE reference, in the single visual form AC-62 demands: a mono path, plus
 * `:<line>` where the number is known and valid, and without one where it is
 * not. There is no placeholder — no `:?`, no dash, no greyed-out slot.
 *
 * Every gate is written out here in full. The file that used to hold them
 * (`PrBriefCard.tsx`'s `FileRef` and `FocusRow`) is deleted, so there is nothing
 * left to read them off, and each is a different question from the ones beside
 * it:
 *
 *  - **The `:<line>` suffix** appears only when `indexMatchesHead`, `linkSha` and
 *    a matching `ref_lines` entry all hold — see `lineFor`. When it does not,
 *    `line` is not passed to `githubBlobUrl` and not handed to `onOpenFile`
 *    either: the text and the target say the same thing or the reference is
 *    wrong in one of them.
 *  - **A risk reference becomes a link** at `head_sha` — the commit this brief
 *    describes — with `repoFullName != null` and `isLinkablePath`. This is a
 *    DIVERGENCE from AC-27, which gated the link on `link_sha`, and it was made
 *    on 2026-08-20 against a measurement: `link_sha` is the commit the INDEX sits
 *    at, the index tracks the default branch, so `index_matches_head` is false
 *    for every brief of every PR, and a path the PR ADDS cannot exist there. Every
 *    such link was a 404 — the rule meant to keep a link truthful was pointing at
 *    a tree without the file in it.
 *
 *    The old rule's reason survives where it belongs: the `:<line>` suffix is
 *    still gated on `indexMatchesHead`, so a head link never carries a line the
 *    index cannot vouch for. `BlastRadiusCard` still links at `link_sha` and must:
 *    its facts come from the indexed tree, where its paths do exist.
 *  - **A focus reference becomes a control** only when the path is one of this
 *    PR's changed files AND `isLinkablePath` (AC-6, AC-15). An endpoint label
 *    (`POST /pulls/:id/brief`) fails the changed-file test on its own. Grounding
 *    membership is not this question: it says the model was shown the string, not
 *    that the string is safe in a URL.
 *
 * Plain text is a `<span className="mono">`, never a `MonoLink` without an
 * `href` — that renders a `<button>` with nothing behind it.
 */
export function BriefRef(props: BriefRefProps) {
  const t = useTranslations("brief");
  const { refValue, refLines, linkSha, headSha, indexMatchesHead } = props;

  const line = lineFor(refValue, refLines, linkSha, indexMatchesHead);
  const label = line != null ? `${refValue}:${line}` : refValue;

  if (props.as === "link") {
    const { repoFullName } = props;
    const href =
      headSha != null && repoFullName != null && isLinkablePath(refValue)
        ? githubBlobUrl(repoFullName, headSha, refValue, line ?? undefined)
        : undefined;

    return href ? (
      <span style={s.refLink}>
        <MonoLink href={href}>{label}</MonoLink>
      </span>
    ) : (
      <span className="mono" style={s.refPlain}>
        {label}
      </span>
    );
  }

  const { changedPaths, onOpenFile } = props;
  if (!changedPaths.has(refValue) || !isLinkablePath(refValue)) {
    return (
      <span className="mono" style={s.refPlain}>
        {label}
      </span>
    );
  }

  return (
    <button
      type="button"
      className="mono"
      style={s.refButton}
      title={line != null ? t("riskBrief.openLine", { line }) : t("riskBrief.openFile")}
      onClick={() => (line != null ? onOpenFile(refValue, line) : onOpenFile(refValue))}
    >
      {label}
    </button>
  );
}
