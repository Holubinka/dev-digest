/* InheritedGroup — the documents an agent gets from its enabled bound skills.

   READ-ONLY, and structurally so: there is no checkbox and no drag handle on
   these rows, because the way to change them is to edit the skill. Each row
   names the skill it came from, the group carries its own counter, and a
   document the agent also attaches itself is marked — its own attachment wins,
   and it is counted once.

   The preview control is the one thing these rows DO get, and it is not a hole
   in that rule: reading a document changes nothing, so it is exactly as
   read-only as the rest of the row.

   It lives beside the agent editor rather than in components/context-docs/
   because it has exactly one consumer and structurally cannot gain a second:
   a skill inherits from nothing, so the skill tab has no inherited group. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@devdigest/ui";
import type { InheritedContextDoc } from "@/lib/types";
/* DocPreview, PreviewButton and the row styles stay in components/context-docs/:
   ContextDocList uses all three too, so they keep the second consumer this
   component lost. Reaching for them by path rather than through that folder's
   barrel is deliberate — the barrel is its public surface, and these are the
   internals two siblings happen to share. */
import { DocPreview } from "@/components/context-docs/DocPreview";
import { PreviewButton } from "@/components/context-docs/PreviewButton";
import { s } from "@/components/context-docs/styles";

export function InheritedGroup({
  repoId,
  inherited,
}: {
  repoId: string;
  inherited: InheritedContextDoc[];
}) {
  const t = useTranslations("context");
  const [preview, setPreview] = React.useState<string | null>(null);
  if (inherited.length === 0) return null;

  return (
    <>
      <div style={s.inheritedHeader}>
        <h3 style={s.inheritedTitle}>{t("attach.inheritedTitle")}</h3>
        <Badge color="var(--text-muted)">
          {t("attach.inheritedCount", { count: inherited.length })}
        </Badge>
      </div>
      <p style={s.hint}>{t("attach.inheritedHint")}</p>

      {inherited.map((doc) => (
        <div key={doc.path} style={s.inheritedRow}>
          <span className="mono" style={s.path} title={doc.path}>
            {doc.path}
          </span>
          <span style={s.tokenCell}>{t("attach.inheritedFrom", { skill: doc.skill_name })}</span>
          {doc.also_attached && (
            <Badge color="var(--accent)">{t("attach.alreadyAttached")}</Badge>
          )}
          <div style={s.spacer}>
            <span style={s.tokenCell}>
              {doc.tokens == null ? "—" : t("attach.tokens", { count: doc.tokens })}
            </span>
            <PreviewButton path={doc.path} onOpen={() => setPreview(doc.path)} />
          </div>
        </div>
      ))}

      {preview !== null && (
        <DocPreview repoId={repoId} path={preview} onClose={() => setPreview(null)} />
      )}
    </>
  );
}
