/* PreviewButton — read a document without leaving the tab.

   It sits on EVERY row, unattached and inherited included: the question this
   tab asks is whether to attach a document, and a control that only opens what
   is already attached answers it one step too late.

   Every pointer event is stopped here. The row around it is `draggable` and
   carries the attachment checkbox, so a click that reached either of them would
   turn "let me read this" into "attach this" or into a reorder — a preview
   changes nothing about the set. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import { s } from "./styles";

export function PreviewButton({ path, onOpen }: { path: string; onOpen: () => void }) {
  const t = useTranslations("context");
  return (
    <button
      type="button"
      draggable={false}
      onDragStart={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onOpen();
      }}
      aria-label={t("attach.previewLabel", { path })}
      style={s.previewBtn}
    >
      <Icon.Eye size={13} />
      {t("attach.preview")}
    </button>
  );
}
