/* ComplexityBadge — how hard a first task is, as a WORD.

   The level is legible without colour (AC-33), and the wording comes from
   `messages/en` keyed on the contract enum, so it is the interface's language
   and not the model's (AC-85).

   A value outside the three renders NOTHING and throws nothing. The server
   already rejected it and counted it in `dropped.unknown_complexity` (AC-32),
   so one arriving here means the contract moved — and a task without a badge
   is a smaller loss than a section that disappears, which is what an
   out-of-enum `severity` did to the findings page once
   (`client/INSIGHTS.md:1409`). It is not normalised to `medium` either: a
   level the model never assigned, stamped on a task someone then picks up, is
   worse than no level at all.

   A `switch`, not a lookup in an object literal: `complexity` is a string off
   the wire and `({} as Record<string, string>)["constructor"]` is truthy
   (`context-doc-view/helpers.ts`, `readFailureReason`). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@devdigest/ui";
import type { OnboardingTaskComplexity } from "@/lib/types";

function tone(
  complexity: OnboardingTaskComplexity,
): { color: string; bg: string; key: string } | null {
  switch (complexity) {
    case "low":
      return { color: "var(--ok)", bg: "var(--ok-bg)", key: "complexity.low" };
    case "medium":
      return { color: "var(--warn)", bg: "var(--warn-bg)", key: "complexity.medium" };
    case "high":
      return { color: "var(--crit)", bg: "var(--crit-bg)", key: "complexity.high" };
    default:
      return null;
  }
}

export function ComplexityBadge({ complexity }: { complexity: OnboardingTaskComplexity }) {
  const t = useTranslations("onboarding");
  const look = tone(complexity);
  if (look === null) return null;

  return (
    <Badge color={look.color} bg={look.bg}>
      {t(look.key)}
    </Badge>
  );
}
