/* ContextDocList — the editable, ordered list of project-context documents.

   Deliberately the same interaction as the agent's Skills tab: the checkbox IS
   the binding, the order IS prompt order, the arrows are the keyboard path for
   reordering, and one request replaces the whole ordered array. A second
   interaction for the same job would lose the keyboard affordance first, since
   that is the part nobody demos. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Checkbox, ErrorState, Icon } from "@devdigest/ui";
import { KIND_COLOR } from "@/components/context-doc-view";
import type { AttachedContextDoc, SpecFile } from "@/lib/types";
import { DocPreview } from "./DocPreview";
import { PreviewButton } from "./PreviewButton";
import { moveAt, orderDocuments, togglePath } from "./helpers";
import { s } from "./styles";

export function ContextDocList({
  repoId,
  scanned,
  attached,
  disabled,
  onCommit,
  onRetry,
  failed,
}: {
  /* Required, not optional: it exists only to read a document, and a prop with
     a default is how this repo has twice shipped a feature that silently never
     ran (client/INSIGHTS.md). Missing it is a compile error at the call site. */
  repoId: string;
  scanned: SpecFile[];
  attached: AttachedContextDoc[];
  disabled?: boolean;
  onCommit: (paths: string[]) => void;
  onRetry?: () => void;
  failed?: boolean;
}) {
  const t = useTranslations("context");
  const [filter, setFilter] = React.useState("");
  const [dragging, setDragging] = React.useState<string | null>(null);
  // The whole of the preview's state: which path is open. Nothing about the
  // attachment set is touched by opening or closing it.
  const [preview, setPreview] = React.useState<string | null>(null);

  // Derived during render, never copied into state: the saved order IS the
  // server's answer, and a local copy of it is a second source of truth that
  // goes stale the moment another tab saves.
  const attachedPaths = [...attached].sort((a, b) => a.position - b.position).map((a) => a.path);
  const rows = orderDocuments(scanned, attached).filter(
    (row) => filter.trim() === "" || row.path.toLowerCase().includes(filter.trim().toLowerCase()),
  );

  const reorder = (from: number, to: number) => {
    if (from < 0 || to < 0 || to >= attachedPaths.length) return;
    onCommit(moveAt(attachedPaths, from, to));
  };

  return (
    <>
      <div style={s.filter}>
        <Icon.Search size={13} style={{ color: "var(--text-muted)" }} />
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={t("attach.filterPlaceholder")}
          aria-label={t("attach.filterPlaceholder")}
          style={s.filterInput}
        />
      </div>

      <p style={s.hint}>{t("attach.orderHint")}</p>

      {/* An empty list and a failed request look identical once the data is
          defaulted to []. Saying "no documents" when the request failed sends
          the reader to fix a repository that is fine. */}
      {failed ? (
        <ErrorState body={t("attach.loadError")} onRetry={onRetry} />
      ) : (
        rows.length === 0 && <p style={s.empty}>{t("attach.empty")}</p>
      )}

      {rows.map(({ path, doc, attachedIndex }) => {
        const isAttached = attachedIndex >= 0;
        const missing = doc === undefined;
        return (
          <div
            key={path}
            draggable={isAttached && !disabled}
            onDragStart={() => setDragging(path)}
            onDragEnd={() => setDragging(null)}
            onDragOver={(e) => isAttached && e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (dragging && isAttached) reorder(attachedPaths.indexOf(dragging), attachedIndex);
              setDragging(null);
            }}
            style={s.row(isAttached, dragging === path)}
          >
            <Icon.Menu size={14} style={s.handle(isAttached)} />
            <Checkbox
              checked={isAttached}
              onChange={() => !disabled && onCommit(togglePath(attachedPaths, path))}
            />
            <span className="mono" style={s.path} title={path}>
              {path}
            </span>
            {missing && <Badge color="var(--warn)">{t("attach.missing")}</Badge>}

            <div style={s.spacer}>
              {/* `disabled` is on both arrows for the same reason the checkbox
                  and the handle carry it: the saved order is read during render
                  and there is no optimistic update, so a second click before the
                  response lands recomputes the SAME move from the SAME array —
                  an identical PUT, and the user's second move gone with it. */}
              {isAttached && (
                <>
                  <button
                    type="button"
                    onClick={() => reorder(attachedIndex, attachedIndex - 1)}
                    disabled={disabled || attachedIndex === 0}
                    aria-label={t("attach.moveUp")}
                    style={s.arrow(disabled || attachedIndex === 0)}
                  >
                    <Icon.ArrowUp size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={() => reorder(attachedIndex, attachedIndex + 1)}
                    disabled={disabled || attachedIndex === attachedPaths.length - 1}
                    aria-label={t("attach.moveDown")}
                    style={s.arrow(disabled || attachedIndex === attachedPaths.length - 1)}
                  >
                    <Icon.ArrowDown size={13} />
                  </button>
                </>
              )}
              <span style={s.tokenCell}>
                {doc ? t("attach.tokens", { count: doc.tokens }) : "—"}
              </span>
              {/* Right-aligned and immediately before Preview, which is where
                  design screens 2 and 3 put it. Beside the filename it competed
                  with the path for the same left edge; here the badges line up
                  down the column and read as one.

                  A row with no `doc` is a saved path the scan no longer holds:
                  nobody has classified it, so it gets no kind either. */}
              {doc && <Badge color={KIND_COLOR[doc.kind]}>{t(`kinds.${doc.kind}`)}</Badge>}
              <PreviewButton path={path} onOpen={() => setPreview(path)} />
            </div>
          </div>
        );
      })}

      {preview !== null && (
        <DocPreview repoId={repoId} path={preview} onClose={() => setPreview(null)} />
      )}
    </>
  );
}
