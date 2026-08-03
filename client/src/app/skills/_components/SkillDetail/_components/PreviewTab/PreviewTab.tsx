/* PreviewTab — the body as a reader sees it, and beside it the exact block the
   agent receives. The second half is the point: it is what makes "a skill is an
   instruction, not quoted data" something you can look at rather than be told. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Markdown } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { promptBlock } from "../../helpers";
import { s } from "./styles";

export function PreviewTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");

  if (skill.body.trim() === "") {
    return <div style={s.empty}>{t("previewTab.empty")}</div>;
  }

  return (
    <div style={s.wrap}>
      <section style={s.section}>
        <h2 style={s.h2}>{t("previewTab.renderedHeading")}</h2>
        <div style={s.rendered}>
          <Markdown>{skill.body}</Markdown>
        </div>
      </section>

      <section style={s.section}>
        <h2 style={s.h2}>{t("previewTab.promptHeading")}</h2>
        <p style={s.hint}>{t("previewTab.promptHint")}</p>
        <pre className="mono" style={s.block}>
          {promptBlock(skill.name, skill.body)}
        </pre>
      </section>
    </div>
  );
}
