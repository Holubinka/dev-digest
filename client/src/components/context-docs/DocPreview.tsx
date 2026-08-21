/* DocPreview — one document's text, over the tab that was deciding whether to
   attach it.

   It reads and nothing else: no `onCommit`, no mutation, no write to the
   attachment cache. `useContextDoc` has its own query key, so opening and
   closing this modal leaves the attached set and its order exactly as they
   were.

   The markdown goes through `DocumentReader`, the one untrusted renderer this
   app has (AC-56). A document comes out of an imported repository, so a second
   rendering path here — `rehype-raw`, `dangerouslySetInnerHTML`, a bare
   `Markdown` primitive — would be stored XSS on the surface the other two
   surfaces were hardened to avoid. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { ErrorState, Modal, Skeleton } from "@devdigest/ui";
import { DocReadFailure, DocumentReader, readFailureReason } from "@/components/context-doc-view";
import { useContextDoc } from "@/lib/hooks/context";
import { s } from "./styles";

export function DocPreview({
  repoId,
  path,
  onClose,
}: {
  repoId: string;
  path: string;
  onClose: () => void;
}) {
  const t = useTranslations("context");
  const doc = useContextDoc(repoId, path);
  // `missing` / `refused` / `binary` are properties of the document, in the
  // run's own three words; anything else is a failed request.
  const reason = readFailureReason(doc.error);

  return (
    <Modal
      title={
        <span className="mono" style={s.path} title={path}>
          {path}
        </span>
      }
      subtitle={t("attach.previewTitle")}
      onClose={onClose}
    >
      <div style={s.previewBody}>
        {reason ? (
          <DocReadFailure reason={reason} />
        ) : doc.isError ? (
          <ErrorState body={t("reader.loadError")} onRetry={() => void doc.refetch()} />
        ) : doc.isSuccess ? (
          <DocumentReader markdown={doc.data.content ?? ""} resolvePath={null} />
        ) : (
          /* Keyed on `isSuccess`, not on `isLoading`: a disabled TanStack query
             reports `isLoading === false` (client/INSIGHTS.md), so the honest
             question is "has the text arrived", and until it has, a skeleton is
             the right answer whether a request is in flight or was never made. */
          <div style={s.previewLoading}>
            <Skeleton width="55%" height={18} />
            <Skeleton />
            <Skeleton width="85%" />
            <Skeleton width="70%" />
          </div>
        )}
      </div>
    </Modal>
  );
}
