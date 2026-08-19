/* CriticalPathsSection — the chains through the code, one row per file.

   ONE FLOW RENDERS FLAT, SEVERAL RENDER LABELLED. The mockup draws a single
   flat list of four rows; slice A returns `flows[]`, each with its own title
   and steps. Ruled on by the coordinator on 2026-08-17 (plan 14,
   § Recommendations 5): with one flow the rows are drawn exactly as the mockup
   has them, and with more than one each flow's `title` goes above its rows as
   a plain sub-label. Rendering several flows flat would glue two distinct
   chains into one list that reads as a single path — an invention about the
   data, not about the look. The title is model content, so AC-85 is untouched.
   Written down here because it is a deliberate step past the mockup, and the
   next reader would otherwise take it for drift.

   An empty chain set keeps the card and says so (AC-18, AC-66). It never falls
   back to top-ranked files: "here are the files that changed most" is a
   different claim from "here is the path a request takes".

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
import { Icon } from "@devdigest/ui";
import type { OnboardingFlow } from "@/lib/types";
import { SectionCard } from "../SectionCard";
import { fileHref } from "../FileRef";
import { s } from "./styles";

export function CriticalPathsSection({
  flows,
  repoFullName,
  indexSha,
}: {
  flows: readonly OnboardingFlow[];
  repoFullName: string | null | undefined;
  indexSha: string | null | undefined;
}) {
  const t = useTranslations("onboarding");
  const walked = flows.filter((flow) => flow.steps.length > 0);
  const labelled = walked.length > 1;

  return (
    <SectionCard kind="critical_paths">
      {walked.length === 0 ? (
        <p style={s.empty}>{t("empty.critical_paths")}</p>
      ) : (
        walked.map((flow, flowIndex) => (
          <div key={`${flow.title}-${flowIndex}`}>
            {labelled && <p style={s.flowTitle}>{flow.title}</p>}
            <ul style={s.list}>
              {flow.steps.map((step, stepIndex) => (
                <StepRow
                  key={`${step.path}-${stepIndex}`}
                  path={step.path}
                  note={step.note}
                  repoFullName={repoFullName}
                  indexSha={indexSha}
                />
              ))}
            </ul>
          </div>
        ))
      )}
    </SectionCard>
  );
}

/**
 * One step: the path, the model's short note, and `Open` on the right.
 *
 * The path itself is plain mono text here — the row already carries a control,
 * and two ways to open the same file is one more than the mockup draws. When
 * the URL rules refuse the path there is no control at all: a dead `Open`
 * button is worse than none (AC-16, AC-27).
 */
function StepRow({
  path,
  note,
  repoFullName,
  indexSha,
}: {
  path: string;
  note: string;
  repoFullName: string | null | undefined;
  indexSha: string | null | undefined;
}) {
  const t = useTranslations("onboarding");
  const href = fileHref(path, repoFullName, indexSha);

  return (
    <li style={s.row}>
      <Icon.FileText size={14} style={s.icon} aria-hidden="true" />
      <span style={s.text}>
        <span className="mono" style={s.path}>
          {path}
        </span>
        {note !== "" && <span style={s.note}> — {note}</span>}
      </span>
      {href !== undefined && (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={t("openAria", { path })}
          style={s.open}
        >
          {t("open")}
        </a>
      )}
    </li>
  );
}
