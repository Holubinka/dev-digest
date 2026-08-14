/* DocActionBar — the four controls above the list, and the only place on this
   page a document is written or a scan is started.

   Rescan lives HERE and not in the page header any more: two rescans on one
   screen is two answers to "did anything happen", and the design puts the whole
   set of actions over the list it changes.

   With no clone on disk all four are unavailable and the reason is printed
   rather than hidden in a `title`: a disabled button does not reliably fire the
   hover a tooltip needs, and "preparing the clone" is an explanation, not an
   error the user caused. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button } from "@devdigest/ui";
import { useRescanContextDocs } from "@/lib/hooks";
import {
  useCreateContextDoc,
  useCreateContextFolder,
  useUploadContextDoc,
} from "@/lib/hooks/context";
import { writeErrorKey } from "../../helpers";
import { s } from "../../styles";
import { PathPromptModal } from "../PathPromptModal";

/** The folder every created document goes under; the server enforces the same. */
const DEVDIGEST_PREFIX = ".devdigest/";

export function DocActionBar({ repoId, disabled }: { repoId: string; disabled: boolean }) {
  const t = useTranslations("context");
  const [dialog, setDialog] = React.useState<"doc" | "folder" | null>(null);
  const [errorKey, setErrorKey] = React.useState<string | null>(null);
  const [noticeKey, setNoticeKey] = React.useState<string | null>(null);
  const fileInput = React.useRef<HTMLInputElement>(null);

  const createDoc = useCreateContextDoc();
  const createFolder = useCreateContextFolder();
  const upload = useUploadContextDoc();
  const rescan = useRescanContextDocs();

  const open = (which: "doc" | "folder") => {
    setErrorKey(null);
    setNoticeKey(null);
    setDialog(which);
  };

  // Abandoning a dialog drops its refusal with it: the message answers the path
  // that was typed in it, and under the bar it would be a complaint about
  // nothing.
  const close = () => {
    setErrorKey(null);
    setDialog(null);
  };

  const submitDoc = async (path: string) => {
    setErrorKey(null);
    try {
      // Empty content on purpose: the dialog asks where the document goes, and
      // the editor in the reading panel is where it gets its text.
      await createDoc.mutateAsync({ repoId, path, content: "" });
    } catch (err) {
      setErrorKey(writeErrorKey(err, "create"));
      return;
    }
    setDialog(null);
  };

  const submitFolder = async (path: string) => {
    setErrorKey(null);
    try {
      await createFolder.mutateAsync({ repoId, path });
    } catch (err) {
      setErrorKey(writeErrorKey(err, "create"));
      return;
    }
    setDialog(null);
    // A folder holds no .md, so the list below is about to look untouched. Say
    // what happened instead of letting an unchanged list answer for it.
    setNoticeKey("folder.createdEmpty");
  };

  const pickFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Cleared before the await: picking the SAME file twice fires no `change`
    // otherwise, so a failed upload could not be retried without a rename.
    event.target.value = "";
    if (!file) return;
    setErrorKey(null);
    setNoticeKey(null);
    try {
      await upload.mutateAsync({ repoId, file });
    } catch (err) {
      setErrorKey(writeErrorKey(err, "upload"));
    }
  };

  return (
    <>
      <div style={s.actionBar}>
        <Button
          kind="secondary"
          size="sm"
          icon="Plus"
          aria-label={t("actions.newDoc")}
          disabled={disabled}
          onClick={() => open("doc")}
        />
        <Button
          kind="secondary"
          size="sm"
          icon="Folder"
          aria-label={t("actions.newFolder")}
          disabled={disabled}
          onClick={() => open("folder")}
        />
        <Button
          kind="secondary"
          size="sm"
          icon="Upload"
          aria-label={t("actions.upload")}
          loading={upload.isPending}
          disabled={disabled}
          onClick={() => fileInput.current?.click()}
        />
        {/* Disabled ONLY by "no clone" and by its own flight — never by
            `state === "scanning"`. A scan claim outlives the process that wrote
            it (the job queue is in-memory and recovers nothing on boot), and the
            server documents Rescan as the user's retry for exactly that row:
            disabling it while scanning took the button away in the one state
            that needs it. */}
        <Button
          kind="secondary"
          size="sm"
          icon="RefreshCw"
          aria-label={t("actions.rescan")}
          loading={rescan.isPending}
          disabled={disabled}
          onClick={() => rescan.mutate(repoId)}
        />
        <input
          ref={fileInput}
          type="file"
          accept=".md,text/markdown"
          onChange={pickFile}
          aria-hidden="true"
          tabIndex={-1}
          style={{ display: "none" }}
        />
      </div>

      {disabled && <p style={s.actionNote}>{t("write.cloneNotReady")}</p>}
      {noticeKey && (
        <p role="status" style={s.actionNote}>
          {t(noticeKey)}
        </p>
      )}
      {errorKey && dialog === null && (
        <p role="alert" style={s.actionError}>
          {t(errorKey)}
        </p>
      )}

      {dialog === "doc" && (
        <PathPromptModal
          title={t("create.title")}
          label={t("create.pathLabel")}
          hint={t("create.pathHint")}
          submitLabel={t("create.submit")}
          initial={DEVDIGEST_PREFIX}
          error={errorKey && t(errorKey)}
          pending={createDoc.isPending}
          onSubmit={submitDoc}
          onClose={close}
        />
      )}
      {dialog === "folder" && (
        <PathPromptModal
          title={t("folder.title")}
          label={t("folder.pathLabel")}
          hint={t("folder.pathHint")}
          submitLabel={t("folder.submit")}
          initial={DEVDIGEST_PREFIX}
          error={errorKey && t(errorKey)}
          pending={createFolder.isPending}
          onSubmit={submitFolder}
          onClose={close}
        />
      )}
    </>
  );
}
