/* VersionsTab — every recorded body change, newest first. Each row can show
   what that version changed, and put its body back.

   Only a body change records a version, which is why a rename never appears
   here. Restoring appends rather than rewrites, so the list stays a record of
   what happened. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, ErrorState, Skeleton } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { useRestoreSkillVersion, useSkillVersions } from "../../../../../../lib/hooks/skills";
import { useToast } from "../../../../../../lib/toast";
import { diffLines, diffStat } from "./diff";
import { s } from "./styles";

export function VersionsTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  const toast = useToast();
  const { data: versions, isLoading, isError, refetch } = useSkillVersions(skill.id);
  const restore = useRestoreSkillVersion();
  const [open, setOpen] = React.useState<number | null>(null);

  // Newest first from the server; the predecessor of a row is the next one down.
  const list = versions ?? [];
  const bodyBefore = (index: number) => list[index + 1]?.body ?? "";

  const onRestore = (version: number) => {
    if (!window.confirm(t("versions.restoreConfirm", { version }))) return;
    restore.mutate(
      { id: skill.id, version },
      {
        onSuccess: (data) =>
          toast.success(t("versions.restoredToast", { from: version, version: data.version })),
      },
    );
  };

  return (
    <div style={s.wrap}>
      <h2 style={s.h2}>{t("versions.heading")}</h2>
      <p style={s.hint}>{t("versions.hint")}</p>

      {isLoading && <Skeleton height={120} />}
      {isError && <ErrorState body={t("versions.loadError")} onRetry={() => refetch()} />}
      {!isLoading && !isError && list.length === 0 && (
        <p style={s.empty}>{t("versions.empty")}</p>
      )}

      {list.map((entry, index) => {
        const previous = bodyBefore(index);
        const rows = diffLines(previous, entry.body);
        const { added, removed } = diffStat(rows);
        const isCurrent = entry.version === skill.version;
        const isFirst = index === list.length - 1;
        const expanded = open === entry.version;

        return (
          <div key={entry.version} style={s.entry}>
            <div style={s.entryHead}>
              <span className="mono" style={s.version}>
                {t("detail.version", { version: entry.version })}
              </span>
              {isCurrent && <Badge color="var(--ok)">{t("versions.current")}</Badge>}
              {isFirst && <Badge color="var(--text-muted)">{t("versions.initial")}</Badge>}
              <span style={s.stat(added, removed)}>{t("versions.stat", { added, removed })}</span>
              <span style={s.when}>{new Date(entry.created_at).toLocaleString()}</span>

              <div style={s.actions}>
                <Button
                  kind="ghost"
                  size="sm"
                  icon={expanded ? "ChevronDown" : "GitBranch"}
                  onClick={() => setOpen(expanded ? null : entry.version)}
                >
                  {expanded ? t("versions.hideDiff") : t("versions.diff")}
                </Button>
                {!isCurrent && (
                  <Button
                    kind="secondary"
                    size="sm"
                    icon="History"
                    disabled={restore.isPending}
                    onClick={() => onRestore(entry.version)}
                  >
                    {restore.isPending ? t("versions.restoring") : t("versions.restore")}
                  </Button>
                )}
              </div>
            </div>

            {expanded && (
              <div style={s.diffPane}>
                <div style={s.diffLabel}>
                  {isFirst
                    ? t("versions.againstNothing")
                    : t("versions.against", { version: list[index + 1]!.version })}
                </div>
                {added === 0 && removed === 0 ? (
                  <div style={s.diffLabel}>{t("versions.unchanged")}</div>
                ) : (
                  <pre className="mono" style={s.diffBody}>
                    {rows.map((row, i) => (
                      <span key={i} style={s.line(row.op)}>
                        {row.op === "add" ? "+" : row.op === "remove" ? "−" : " "} {row.text}
                      </span>
                    ))}
                  </pre>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
