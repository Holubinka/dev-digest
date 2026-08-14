/* DocList — the scanned documents, grouped by the root the scan found them
   under.

   The root is printed ONCE, in the group header, and a row carries the path
   below it. The row used to print the root, the whole path and the kind badge,
   which for a document in `docs/` read "docs · docs/architecture.md · docs" —
   three ways of saying the same word and no room for the name of the file. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Icon } from "@devdigest/ui";
import { KIND_COLOR } from "@/components/context-doc-view";
import type { SpecFile } from "@/lib/types";
import type { DocGroup } from "../../helpers";
import { s } from "../../styles";

export function DocList({
  groups,
  selectedPath,
  onSelect,
}: {
  groups: DocGroup[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
}) {
  const t = useTranslations("context");
  return (
    <>
      {groups.map((group, index) => (
        <div key={group.root}>
          {/* A band, not a gap: four roots separated by spacing alone read as one
              list with holes in it. */}
          <div style={s.groupHeader(index === 0)}>
            <span className="mono" style={s.groupRoot} title={t("rootTitle", { root: group.root })}>
              {group.root}
            </span>
            {group.kind && (
              <Badge color={KIND_COLOR[group.kind]}>{t(`kinds.${group.kind}`)}</Badge>
            )}
          </div>
          <div style={s.groupRows}>
            {group.rows.map(({ doc, label }) => (
              <DocRow
                key={doc.path}
                doc={doc}
                label={label}
                /* Only where the header cannot speak for the row. `.devdigest` is
                   a container rather than a label — the segment below it names the
                   kind — so that one group can hold documents of several kinds,
                   and there the badge is the only place the kind exists. */
                showKind={group.kind === null}
                selected={doc.path === selectedPath}
                onSelect={onSelect}
              />
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

function DocRow({
  doc,
  label,
  showKind,
  selected,
  onSelect,
}: {
  doc: SpecFile;
  label: string;
  showKind: boolean;
  selected: boolean;
  onSelect: (path: string) => void;
}) {
  const t = useTranslations("context");
  return (
    <button
      type="button"
      onClick={() => onSelect(doc.path)}
      style={s.row(selected)}
      title={doc.path}
      aria-current={selected}
    >
      {/* The same icon at the same size the diff viewer puts before a path
          (`components/diff-viewer/FileCard`). */}
      <Icon.FileText size={14} style={s.rowIcon(selected)} />
      <span className="mono" style={s.rowLabel}>
        {label}
      </span>
      <span style={s.rowBadges}>
        {showKind && <Badge color={KIND_COLOR[doc.kind]}>{t(`kinds.${doc.kind}`)}</Badge>}
        {doc.local && <Badge color="var(--warn)">{t("local.badge")}</Badge>}
        {doc.stale && <Badge color="var(--crit)">{t("stale.badge")}</Badge>}
      </span>
    </button>
  );
}
