/* DocReadFailure — what stands in place of a document that could not be read.

   The three reasons are the run's own trace statuses, not a UI vocabulary: a
   document the prompt assembler skipped as `missing` reads `missing` here too,
   so the page and the trace can be compared word for word (AC-55). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { EmptyState, type IconName } from "@devdigest/ui";
import type { DocReadFailureReason } from "./helpers";

const ICON: Record<DocReadFailureReason, IconName> = {
  missing: "Slash",
  refused: "Lock",
  binary: "Code",
};

export function DocReadFailure({ reason }: { reason: DocReadFailureReason }) {
  const t = useTranslations("context");
  return <EmptyState icon={ICON[reason]} title={t(`read.${reason}`)} />;
}
