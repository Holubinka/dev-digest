/* FileCard — one collapsible file in the diff: header (path, +/- stat, comment
   count) and, when open, its parsed lines plus any outdated comments. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { PrFile } from "@/lib/types";
import { AUTO_EXPAND_MAX_LINES } from "../constants";
import { parsePatch, type Line } from "../helpers";
import {
  buildThreads,
  keysForLine,
  partitionThreads,
  type CommentThread,
  type DiffCommentApi,
} from "../comments";
import { s, chevronFor } from "../styles";
import { CodeLine } from "../CodeLine";
import { OutdatedComments } from "../OutdatedComments";

/** Threads anchored to a given parsed line (RIGHT=new, LEFT=old). */
function threadsForLine(ln: Line, matched: Map<string, CommentThread[]>): CommentThread[] {
  if (matched.size === 0) return [];
  const out: CommentThread[] = [];
  for (const key of keysForLine(ln)) {
    const list = matched.get(key);
    if (list) out.push(...list);
  }
  return out;
}

export interface FileCardProps {
  file: PrFile;
  commenting?: DiffCommentApi;
  /**
   * Overrides the AUTO_EXPAND_MAX_LINES size rule for the INITIAL state. Smart
   * Diff passes `false` for boilerplate, which starts collapsed however small
   * the diff is.
   */
  defaultOpen?: boolean;
  /**
   * Controlled mode, and Smart Diff's finding badge is why it exists: the badge
   * scrolls to a cited line, and a collapsed card has no such line in the DOM,
   * so the PARENT has to expand it first — which a card owning its own state
   * cannot be told to do. Smart Diff leaves `open` undefined until a path is
   * actually toggled, so a card is uncontrolled (seeded by `defaultOpen`) right
   * up to the moment something outside needs to drive it. `DiffViewer` passes
   * neither and is uncontrolled throughout.
   */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** New-side line number → the colour marking it. */
  highlights?: ReadonlyMap<number, string>;
  /** New-side line number → trailing content for that row (Smart Diff chips). */
  lineRight?: ReadonlyMap<number, React.ReactNode>;
  /** Extra header content, right of the +/- stat. */
  right?: React.ReactNode;
  /** Extra header content, immediately after the path (Smart Diff's dot). */
  afterPath?: React.ReactNode;
}

export function FileCard({
  file,
  commenting,
  defaultOpen,
  open: openProp,
  onOpenChange,
  highlights,
  lineRight,
  right,
  afterPath,
}: FileCardProps) {
  const t = useTranslations("shell");
  const [openState, setOpenState] = React.useState(
    defaultOpen ?? (file.additions ?? 0) + (file.deletions ?? 0) <= AUTO_EXPAND_MAX_LINES
  );
  const open = openProp ?? openState;
  const toggle = () => {
    if (openProp === undefined) setOpenState((o) => !o);
    onOpenChange?.(!open);
  };
  const lines = React.useMemo(() => parsePatch(file.patch), [file.patch]);

  // Group this file's comments into threads, then split into ones we can anchor
  // to a rendered line vs. "outdated" (GitHub dropped the line / it's not here).
  const comments = commenting?.comments;
  const { matched, outdated } = React.useMemo(() => {
    if (!comments) return { matched: new Map<string, CommentThread[]>(), outdated: [] };
    const fileThreads = buildThreads(comments.filter((c) => c.path === file.path));
    const renderedKeys = new Set<string>();
    for (const ln of lines) for (const k of keysForLine(ln)) renderedKeys.add(k);
    return partitionThreads(fileThreads, renderedKeys);
  }, [comments, file.path, lines]);

  const commentCount = commenting
    ? commenting.comments.filter((c) => c.path === file.path).length
    : 0;

  return (
    <div style={s.fileCard}>
      <div onClick={toggle} style={s.fileHeader}>
        <Icon.ChevronRight size={13} style={chevronFor(open)} />
        <Icon.FileText size={14} style={s.fileIcon} />
        <span className="mono" style={s.filePath}>
          {file.path}
        </span>
        {afterPath}
        <span className="mono tnum" style={s.fileStat}>
          <span style={s.addText}>+{file.additions}</span>{" "}
          <span style={s.delText}>−{file.deletions}</span>
        </span>
        {commentCount > 0 && (
          <span
            style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--text-muted)" }}
          >
            <Icon.MessageSquare size={12} />
            {commentCount}
          </span>
        )}
        {right}
      </div>
      {open && (
        <div style={s.fileBody}>
          {lines.length === 0 ? (
            <div style={s.noDiff}>{t("diffViewer.noDiffText")}</div>
          ) : (
            lines.map((ln, i) => {
              const highlight = ln.newNo != null ? highlights?.get(ln.newNo) : undefined;
              return (
                <CodeLine
                  key={i}
                  ln={ln}
                  path={file.path}
                  threads={threadsForLine(ln, matched)}
                  commenting={commenting}
                  {...(highlight ? { highlightColor: highlight } : {})}
                  {...(ln.newNo != null && lineRight?.has(ln.newNo)
                    ? { right: lineRight.get(ln.newNo) }
                    : {})}
                />
              );
            })
          )}
          {commenting && commenting.showComments && <OutdatedComments threads={outdated} />}
        </div>
      )}
    </div>
  );
}
