/* Step 2 — Preview. FILES TO CREATE beside the file the reader selected
   (AC-16, AC-19…AC-21, AC-24). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Icon } from "@devdigest/ui";
import type { CiFile } from "@/lib/types";
import { byteLength } from "../../helpers";
import { PREVIEW_MAX_BYTES } from "../../constants";
import { s } from "./styles";

export function PreviewStep({
  files,
  selectedPath,
  contentsOf,
  generating,
  error,
  onSelect,
  onEdit,
}: {
  files: CiFile[];
  selectedPath: string | null;
  contentsOf: (file: CiFile) => string;
  generating: boolean;
  error: string | null;
  onSelect: (path: string) => void;
  onEdit: (path: string, contents: string) => void;
}) {
  const t = useTranslations("ci");

  if (generating) return <div style={s.state}>{t("exportWizard.generating")}</div>;
  if (error) return <div style={s.state}>{t("exportWizard.generateFailed", { reason: error })}</div>;
  if (files.length === 0) return <div style={s.state}>{t("exportWizard.generating")}</div>;

  const selected = files.find((f) => f.path === selectedPath) ?? files[0]!;
  const body = contentsOf(selected);
  // AC-24 is a guard, not a formatting choice: the bundle carries a
  // single-file `runner.mjs` build, and putting it in a `<pre>` would render
  // ~1 MiB of text into the modal.
  // One encode, not two: `runner.mjs` is the file this guard exists for, and
  // it is ~1 MiB.
  const bytes = byteLength(body);
  const tooLarge = bytes > PREVIEW_MAX_BYTES;

  return (
    <div style={s.pane}>
      <div style={s.list}>
        <div style={s.listLabel}>{t("exportWizard.filesToCreate")}</div>
        {files.map((f) => {
          const active = f.path === selected.path;
          return (
            <button key={f.path} type="button" onClick={() => onSelect(f.path)} style={s.row(active)}>
              <Icon.FileText size={13} style={s.rowIcon(active)} />
              <span className="mono" style={s.rowPath}>
                {f.path}
              </span>
            </button>
          );
        })}
      </div>

      <div style={s.editor}>
        <div style={s.editorHead}>
          <span className="mono" style={s.editorPath}>
            {selected.path}
          </span>
          {/* `editable` is the bundle's own flag, so the two files AC-21 names
              are badged `generated` because the server marked them so — not
              because this component keeps a second list of paths. */}
          <Badge color="var(--text-muted)" icon={selected.editable ? "Edit" : "Lock"}>
            {selected.editable ? t("exportWizard.editable") : t("exportWizard.generated")}
          </Badge>
        </div>
        {tooLarge ? (
          <div style={s.placeholder}>
            <div className="mono tnum" style={s.placeholderSize}>
              {t("exportWizard.fileSize", { bytes })}
            </div>
            <div style={s.placeholderBody}>{t("exportWizard.previewTooLarge")}</div>
          </div>
        ) : selected.editable ? (
          <textarea
            className="mono"
            aria-label={selected.path}
            value={body}
            spellCheck={false}
            onChange={(e) => onEdit(selected.path, e.target.value)}
            style={s.textarea}
          />
        ) : (
          <pre className="mono" style={s.code}>
            {body}
          </pre>
        )}
      </div>
    </div>
  );
}
