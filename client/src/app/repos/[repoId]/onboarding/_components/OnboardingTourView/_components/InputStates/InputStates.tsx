/* InputStates — what the model was actually shown, and what did not fit.

   A tour written from four of five inputs is a different document from one
   written from all five, and the difference is invisible in the prose. This is
   where a sample cut by a ceiling and a document block dropped by the budget
   walk say so (AC-65, AC-86) — every ceiling this feature has is SEEN rather
   than silently absent.

   The mockup does not draw this block; the spec requires it. Reported as an
   addition rather than resolved either way, and it is drawn at the bottom, at
   the lowest emphasis on the page, so it informs without competing with the
   tour.

   A `switch` and not a lookup keyed by the server's string: `id` and `status`
   come off the wire and `src/lib/api.ts` validates nothing. An id outside the
   five falls back to the id itself, which is the server's own word for it —
   more honest than an untranslated message path, and it never throws. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { OnboardingInput } from "@/lib/types";
import { s } from "./styles";

function labelKey(id: string): string | null {
  switch (id) {
    case "repo_map":
      return "inputs.id.repo_map";
    case "package_configs":
      return "inputs.id.package_configs";
    case "critical_paths":
      return "inputs.id.critical_paths";
    case "file_samples":
      return "inputs.id.file_samples";
    case "project_docs":
      return "inputs.id.project_docs";
    default:
      return null;
  }
}

function statusKey(status: string): string | null {
  switch (status) {
    case "included":
      return "inputs.status.included";
    case "truncated":
      return "inputs.status.truncated";
    case "dropped":
      return "inputs.status.dropped";
    case "missing":
      return "inputs.status.missing";
    default:
      return null;
  }
}

export function InputStates({ inputs }: { inputs: readonly OnboardingInput[] }) {
  const t = useTranslations("onboarding");
  if (inputs.length === 0) return null;

  return (
    <section style={s.block}>
      <h2 style={s.title}>{t("inputs.title")}</h2>
      <ul style={s.list}>
        {inputs.map((input) => {
          const label = labelKey(input.id);
          const status = statusKey(input.status);
          return (
            <li key={input.id} style={s.row}>
              <span style={s.label}>{label === null ? input.id : t(label)}</span>
              <span style={s.status}>{status === null ? input.status : t(status)}</span>
              {input.detail != null && input.detail !== "" && (
                <span style={s.detail}>{input.detail}</span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
