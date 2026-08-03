/* SkillBodyEditor — a mono textarea with a line-number gutter, under a bar
   showing the derived filename, whether the body is unsaved, and what it costs.

   Plain textarea rather than a code editor on purpose: syntax highlighting
   would mean CodeMirror or Shiki in the bundle, and the thing that actually
   matters here — which line an injection warning points at — is the gutter. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Icon } from "@devdigest/ui";
import { approxTokens } from "../../../../../../lib/tokens";
import { bodyFilename } from "../../helpers";
import { LINE_HEIGHT, s } from "./styles";

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
  const gutter = React.useRef<HTMLDivElement>(null);
  const lineCount = value.split("\n").length;

  return (
    <div style={s.wrap}>
      <div style={s.bar}>
        <Icon.FileText size={13} style={s.barIcon} />
        <span className="mono" style={s.filename}>
          {bodyFilename(name)}
        </span>
        {dirty && <Badge color="var(--warn)">{t("editor.unsaved")}</Badge>}
        <span style={s.tokens}>{t("editor.tokensPlain", { count: approxTokens(value) })}</span>
      </div>

      <div style={s.editor}>
        <div ref={gutter} style={s.gutter} aria-hidden="true">
          {Array.from({ length: lineCount }, (_, i) => (
            <div key={i} style={{ height: LINE_HEIGHT }}>
              {i + 1}
            </div>
          ))}
        </div>
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          // The gutter is a separate element, so it has to be scrolled by hand
          // or the numbers stop lining up as soon as the body is longer than
          // the box.
          onScroll={(e) => {
            if (gutter.current) gutter.current.scrollTop = e.currentTarget.scrollTop;
          }}
          rows={Math.min(Math.max(lineCount, 12), 20)}
          spellCheck={false}
          placeholder={t("body.placeholder")}
          aria-label={t("body.label")}
          style={s.textarea}
        />
      </div>
    </div>
  );
}
