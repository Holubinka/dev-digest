/* DocPanel — the selected document: its header, and either the text or the
   reason there is none.

   Everything here is about ONE document, which is why "Used by N agents" moved
   in from the list rows: repeated on every row it was noise, and the question it
   answers ("does anything depend on this?") is one you ask about the document
   you are looking at.

   The draft in `Edit` is local state on purpose. It is not shareable — a link to
   half-typed text means nothing to whoever opens it — and it must not survive a
   reload, so it is neither URL state nor written into the query cache. Losing it
   on navigation is the intended behaviour, not a gap. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, ErrorState, Skeleton, Textarea } from "@devdigest/ui";
import {
  DocReadFailure,
  DocumentReader,
  readFailureReason,
} from "@/components/context-doc-view";
import { useSaveContextDoc } from "@/lib/hooks/context";
import type { SpecFile } from "@/lib/types";
import { overSaveCap, writeErrorKey } from "../../helpers";
import { s } from "../../styles";
import { TrackedSaveModal } from "../TrackedSaveModal";

/** The folder whose documents git does not track, so an edit there survives a resync. */
const DEVDIGEST_PREFIX = ".devdigest/";

/** Ties the disabled Edit to the sentence that says why it is disabled. */
const TOO_LONG_NOTE_ID = "doc-too-long-to-edit";

export function DocPanel({
  repoId,
  path,
  entry,
  doc,
  defaultBranch,
}: {
  repoId: string;
  path: string;
  /** The scan row for this path, which survives a failed read of its content. */
  entry: SpecFile | undefined;
  doc: {
    data: SpecFile | undefined;
    isError: boolean;
    error?: unknown;
    refetch: () => void;
  };
  defaultBranch: string | null;
}) {
  const t = useTranslations("context");
  const save = useSaveContextDoc();
  const [mode, setMode] = React.useState<"preview" | "edit">("preview");
  const [draft, setDraft] = React.useState("");
  const [confirming, setConfirming] = React.useState(false);
  const [errorKey, setErrorKey] = React.useState<string | null>(null);

  // The scan row carries the metadata; the content query carries the text. A
  // document whose file cannot be read still has a row, and its "used by" count
  // and its local / stale state are still true.
  const meta = entry ?? doc.data;
  const failure = doc.isError ? readFailureReason(doc.error) : null;
  const tracked = !path.startsWith(DEVDIGEST_PREFIX);
  // The reader serves a document whole up to 400 KB, and a save is refused above
  // 40 000 code points. Between the two, Edit used to open on a draft whose every
  // Save came back 400 — so the refusal is said here, before the attempt.
  const tooLongToEdit = overSaveCap(doc.data?.content);

  const startEdit = () => {
    setErrorKey(null);
    setDraft(doc.data?.content ?? "");
    setMode("edit");
  };

  const write = async () => {
    setConfirming(false);
    setErrorKey(null);
    try {
      await save.mutateAsync({ repoId, path, content: draft });
    } catch (err) {
      // Edit mode stays open: the draft is the only copy of the text, and
      // dropping the user back into Preview would discard it.
      setErrorKey(writeErrorKey(err, "save") ?? "reader.saveError");
      return;
    }
    setMode("preview");
  };

  return (
    <>
      <div style={s.panelHead}>
        <span className="mono" style={s.panelName} title={path}>
          {fileName(path)}
        </span>
        <div style={s.toggle}>
          <Button
            kind="tertiary"
            size="sm"
            active={mode === "preview"}
            aria-pressed={mode === "preview"}
            onClick={() => setMode("preview")}
          >
            {t("reader.preview")}
          </Button>
          <Button
            kind="tertiary"
            size="sm"
            active={mode === "edit"}
            aria-pressed={mode === "edit"}
            /* Nothing to seed a draft from until the text has loaded, and a
               save from an empty draft would overwrite the file with nothing.
               Over the write cap it is refused for the opposite reason: the
               draft would be complete and the save would still be refused. */
            disabled={!doc.data || tooLongToEdit}
            aria-describedby={tooLongToEdit ? TOO_LONG_NOTE_ID : undefined}
            onClick={startEdit}
          >
            {t("reader.edit")}
          </Button>
        </div>
        {meta && (
          <div style={s.panelRight}>
            <Badge icon="Users">{t("usedBy", { count: meta.used_by_agents })}</Badge>
          </div>
        )}
      </div>

      {tooLongToEdit && (
        <p id={TOO_LONG_NOTE_ID} style={s.editNote}>
          {t("reader.tooLongToEdit")}
        </p>
      )}

      {meta?.local && (
        <div style={s.notice("var(--warn)")}>
          <Badge color="var(--warn)">{t("local.badge")}</Badge>
          <span style={s.noticeBody}>{t("local.body")}</span>
        </div>
      )}
      {meta?.stale && (
        <div style={s.notice("var(--crit)")}>
          <Badge color="var(--crit)">{t("stale.badge")}</Badge>
          <span style={s.noticeBody}>{t("stale.body")}</span>
        </div>
      )}

      <Body
        doc={doc}
        failure={failure}
        mode={mode}
        draft={draft}
        onDraft={setDraft}
        saving={save.isPending}
        errorKey={errorKey}
        onSave={() => (tracked ? setConfirming(true) : void write())}
        onCancel={() => {
          setErrorKey(null);
          setMode("preview");
        }}
      />

      {confirming && (
        <TrackedSaveModal
          branch={defaultBranch ?? "HEAD"}
          pending={save.isPending}
          onConfirm={() => void write()}
          onCancel={() => setConfirming(false)}
        />
      )}
    </>
  );
}

function Body({
  doc,
  failure,
  mode,
  draft,
  onDraft,
  saving,
  errorKey,
  onSave,
  onCancel,
}: {
  doc: { data: SpecFile | undefined; isError: boolean; refetch: () => void };
  failure: ReturnType<typeof readFailureReason>;
  mode: "preview" | "edit";
  draft: string;
  onDraft: (value: string) => void;
  saving: boolean;
  errorKey: string | null;
  onSave: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations("context");

  // The document's own failure first: `missing` / `refused` / `binary` are
  // properties of the file, in the run's own three words, not errors the reader
  // can retry away.
  if (failure) return <DocReadFailure reason={failure} />;
  if (doc.isError) return <ErrorState body={t("reader.loadError")} onRetry={() => doc.refetch()} />;
  if (!doc.data) return <Skeleton height={160} />;

  if (mode === "edit") {
    return (
      <>
        <Textarea value={draft} onChange={onDraft} rows={18} mono />
        {errorKey && (
          <p role="alert" style={s.editError}>
            {t(errorKey)}
          </p>
        )}
        <div style={s.editFooter}>
          <Button kind="primary" size="sm" onClick={onSave} disabled={saving}>
            {saving ? t("reader.saving") : t("reader.save")}
          </Button>
          <Button kind="ghost" size="sm" onClick={onCancel} disabled={saving}>
            {t("reader.cancel")}
          </Button>
        </div>
      </>
    );
  }

  return <DocumentReader markdown={doc.data.content ?? ""} resolvePath={null} />;
}

/** The name at the end of the path; the whole path is in the row's tooltip. */
function fileName(path: string): string {
  return path.split("/").pop() || path;
}
