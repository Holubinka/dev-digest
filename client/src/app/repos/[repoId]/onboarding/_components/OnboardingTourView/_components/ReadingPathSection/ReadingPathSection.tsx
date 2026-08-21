/* ReadingPathSection — the order to read the repository in, and why each file
   sits where it does.

   An `<ol>`: the order is the content here, and a screen reader should be told
   the count and the position without reading the drawn circles. The circles
   are the mockup's, and they are decoration over the list's own numbering.

   With nothing ranked, the card stays and says so (AC-29, AC-66). No file is
   invented to fill the list.

   THIS SECTION DRAWS NO PROSE, and that is a decision rather than an omission.
   Every section carries a `body`, but measured against a live tour
   (`Holubinka/dev-digest`, 2026-08-18) the four non-architecture bodies restate
   the structured fields beside them — the same files, the same order, the same
   complexity words — so drawing both would print every list twice. Plan 14
   wires `TourProse` into `ArchitectureSection` and nowhere else, and this is
   why. Reported rather than resolved here: whether those bodies should be
   drawn at all is a question about the contract, not about this file. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { OnboardingReadingStep } from "@/lib/types";
import { SectionCard } from "../SectionCard";
import { FileRef } from "../FileRef";
import { s } from "./styles";

export function ReadingPathSection({
  steps,
  repoFullName,
  indexSha,
}: {
  steps: readonly OnboardingReadingStep[];
  repoFullName: string | null | undefined;
  indexSha: string | null | undefined;
}) {
  const t = useTranslations("onboarding");

  return (
    <SectionCard kind="reading_path">
      {steps.length === 0 ? (
        <p style={s.empty}>{t("empty.reading_path")}</p>
      ) : (
        <ol style={s.list}>
          {steps.map((step, i) => (
            <li key={`${step.path}-${i}`} style={s.item}>
              <span className="tnum" style={s.number} aria-hidden="true">
                {i + 1}
              </span>
              <span style={s.body}>
                <FileRef path={step.path} repoFullName={repoFullName} indexSha={indexSha} />
                {step.reason !== "" && <p style={s.reason}>{step.reason}</p>}
              </span>
            </li>
          ))}
        </ol>
      )}
    </SectionCard>
  );
}
