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

/** One trailing item on a diff row, identified so it renders only once. */
export interface LineAdornment {
  key: string;
  node: React.ReactNode;
}

/**
 * Walk the rendered lines once, handing each its not-yet-rendered adornments.
 *
 * The `seen` set is why this is a function rather than a `.map()` inline: it has
 * to be created fresh per pass and consumed in render order, so that the first
 * line actually drawn for a given key is the one that gets it.
 */
function renderLines(
  lines: Line[],
  render: (ln: Line, i: number, adornments: LineAdornment[]) => React.ReactNode,
  lineRight?: ReadonlyMap<number, readonly LineAdornment[]>,
): React.ReactNode[] {
  const seen = new Set<string>();
  return lines.map((ln, i) => {
    const listed = ln.newNo != null ? lineRight?.get(ln.newNo) : undefined;
    const fresh: LineAdornment[] = [];
    for (const a of listed ?? []) {
      if (seen.has(a.key)) continue;
      seen.add(a.key);
      fresh.push(a);
    }
    return render(ln, i, fresh);
  });
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
  /**
   * New-side line number → trailing content for that row (Smart Diff's chips).
   *
   * An adornment may be listed against every line it concerns, and this card
   * renders each `key` ONCE, on the first of those lines it actually draws. So
   * a caller describing a three-line finding lists it three times and gets one
   * chip — and it lands on a rendered line even when the range starts outside
   * the hunk. Deduplication is by key alone; the card knows nothing of findings.
   */
  lineRight?: ReadonlyMap<number, readonly LineAdornment[]>;
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
            renderLines(lines, (ln, i, adornments) => (
              <CodeLine
                key={i}
                ln={ln}
                path={file.path}
                threads={threadsForLine(ln, matched)}
                commenting={commenting}
                {...(ln.newNo != null && highlights?.has(ln.newNo)
                  ? { highlightColor: highlights.get(ln.newNo)! }
                  : {})}
                {...(adornments.length > 0
                  ? {
                      right: (
                        <span style={s.lineRight}>
                          {adornments.map((a) => (
                            <React.Fragment key={a.key}>{a.node}</React.Fragment>
                          ))}
                        </span>
                      ),
                    }
                  : {})}
              />
            ), lineRight)
          )}
          {commenting && commenting.showComments && <OutdatedComments threads={outdated} />}
        </div>
      )}
    </div>
  );
}
