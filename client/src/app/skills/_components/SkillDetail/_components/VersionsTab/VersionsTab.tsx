/* VersionsTab — every recorded body, newest first. Only a body change records
   one, which is why a rename does not show up here. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, ErrorState, Skeleton } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { useSkillVersions } from "../../../../../../lib/hooks/skills";
import { s } from "./styles";

export function VersionsTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  const { data: versions, isLoading, isError, refetch } = useSkillVersions(skill.id);

  return (
    <div style={s.wrap}>
      <h2 style={s.h2}>{t("versions.heading")}</h2>
      <p style={s.hint}>{t("versions.hint")}</p>

      {isLoading && <Skeleton height={120} />}
      {isError && <ErrorState body={t("versions.loadError")} onRetry={() => refetch()} />}
      {!isLoading && !isError && (versions ?? []).length === 0 && (
        <p style={s.empty}>{t("versions.empty")}</p>
      )}

      {(versions ?? []).map((v) => (
        <div key={v.version} style={s.entry}>
          <div style={s.entryHead}>
            <span className="mono" style={s.version}>
              {t("detail.version", { version: v.version })}
            </span>
            {v.version === skill.version && (
              <Badge color="var(--ok)">{t("versions.current")}</Badge>
            )}
            <span style={s.when}>{new Date(v.created_at).toLocaleString()}</span>
          </div>
          <pre className="mono" style={s.body}>
            {v.body}
          </pre>
        </div>
      ))}
    </div>
  );
}
