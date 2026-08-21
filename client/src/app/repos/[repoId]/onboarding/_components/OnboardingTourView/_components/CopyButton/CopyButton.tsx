/* CopyButton — an icon-only copy control: `Copy`, then `Check` while the
   confirmation lasts.

   `label` is required and becomes the `aria-label`: an icon-only control
   without one is invisible to a screen reader, and this one appears once per
   command, so "Copy" alone would give a reader eight identical controls.

   Colocated rather than promoted. The four `navigator.clipboard` call sites
   elsewhere in this app stay as they are — promotion needs a second consumer
   in a different route (frontend-architecture principle 2), and this feature's
   two consumers are both in this one. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import { useCopyToClipboard } from "../hooks/useCopyToClipboard";
import { s } from "./styles";

export function CopyButton({ text, label }: { text: string; label: string }) {
  const t = useTranslations("onboarding");
  const { copied, copy } = useCopyToClipboard();
  const Glyph = copied ? Icon.Check : Icon.Copy;

  return (
    <button
      type="button"
      onClick={() => copy(text)}
      aria-label={label}
      title={copied ? t("copied") : label}
      style={s.button(copied)}
    >
      <Glyph size={14} aria-hidden="true" />
    </button>
  );
}
