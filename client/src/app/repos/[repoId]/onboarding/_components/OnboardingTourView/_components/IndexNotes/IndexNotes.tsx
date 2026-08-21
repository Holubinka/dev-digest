/* IndexNotes — the two things a reader has to know about the index BEFORE they
   read a word of the tour: that it has moved on, and that it was never whole.

   NEITHER NOTE IS A BUTTON, and neither starts anything (§ D22). Regenerating
   is always an explicit human action, and a page that quietly rebuilt itself
   when the index moved would spend a model call nobody asked for.

   `stale` IS READ, NEVER COMPUTED. The server's rule carries an empty-sha guard
   the client cannot see — with no index row at all, `index.last_indexed_sha` is
   `''`, and a client-side `!==` would report a perfectly good tour as stale the
   moment the index row went missing (AC-56).

   `useRepoIntelStatus` is not used here and must not be added: the read
   envelope already carries the current index state, and a second source is a
   second answer. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { OnboardingIndexState } from "@/lib/types";
import { shortSha } from "../../helpers";
import { s } from "./styles";

export function IndexNotes({
  stale,
  tourIndexState,
  currentIndexSha,
}: {
  /** From the envelope. Never derived here. */
  stale: boolean;
  /** The state the tour was BUILT from. */
  tourIndexState: OnboardingIndexState;
  /** The CURRENT index's sha; `''` when there is no index row at all. */
  currentIndexSha: string;
}) {
  const t = useTranslations("onboarding");
  const partial = tourIndexState.status === "partial";

  return (
    <>
      {/* Both states are named, because "this is out of date" without saying
          out of date against what is not checkable by the person reading it. */}
      {stale && currentIndexSha !== "" && (
        <p style={s.note}>
          {t("stale", {
            tourSha: shortSha(tourIndexState.last_indexed_sha),
            indexSha: shortSha(currentIndexSha),
          })}
        </p>
      )}
      {partial && (
        <p style={s.note}>{t("partial", { count: tourIndexState.files_skipped })}</p>
      )}
    </>
  );
}
