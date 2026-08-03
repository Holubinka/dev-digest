/* SkillBodyEditor — a mono textarea under a bar showing the derived filename,
   whether the body is unsaved, and roughly what it costs in tokens. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Icon, Textarea } from "@devdigest/ui";
import { approxTokens } from "../../../../../../lib/tokens";
import { bodyFilename } from "../../helpers";
import { s } from "./styles";

export function SkillBodyEditor({
  name,
  value,
  dirty,
  onChange,
}: {
  name: string;
  value: string;
  dirty: boolean;
  onChange: (v: string) => void;
}) {
  const t = useTranslations("skills");

  return (
    <div style={s.wrap}>
      <div style={s.bar}>
        <Icon.FileText size={13} style={s.barIcon} />
        <span className="mono" style={s.filename}>
          {bodyFilename(name)}
        </span>
        {dirty && <Badge color="var(--warn)">{t("editor.unsaved")}</Badge>}
        <span style={s.tokens}>{t("editor.tokens", { count: approxTokens(value) })}</span>
      </div>
      <Textarea
        value={value}
        onChange={onChange}
        rows={18}
        mono
        placeholder={t("body.placeholder")}
      />
    </div>
  );
}
