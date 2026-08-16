"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SectionLabel, Button } from "@devdigest/ui";
import { DiffViewer, type DiffCommentApi } from "@/components/diff-viewer";
import { usePrComments, useCreatePrComment } from "@/lib/hooks/reviews";
import { useSmartDiff } from "@/lib/hooks/core";
import { notify } from "@/lib/toast";
import type { FindingRecord, PrFile } from "@devdigest/shared";
import { SmartDiffViewer } from "../SmartDiffViewer";
import { s } from "./styles";

interface DiffTabProps {
  prId: string | null;
  filesCount: number;
  files: PrFile[];
  /** Every finding on this PR — the source of the Smart Diff line highlights. */
  findings: FindingRecord[];
  /** Inline commenting is offered only on open PRs (GitHub rejects otherwise). */
  canComment?: boolean;
  /** Hands a finding id back to the page, which opens it in the Agent runs tab. */
  onOpenFinding?: (findingId: string) => void;
  /**
   * The file a review-focus item on the Risk Brief card sent the reader to.
   * Held in the URL by the page (`?file=`), like every other cross-tab target
   * here, so the trip survives a reload and can be handed to someone else.
   */
  targetFile?: string | null;
  /**
   * Smart order vs GitHub's order. Held in the URL by the page rather than here:
   * this component unmounts on every tab switch, so following a severity chip to
   * Agent runs and coming back would silently reset the reader's choice.
   */
  smartOrder: boolean;
  onSmartOrderChange: (next: boolean) => void;
}

export function DiffTab({
  prId,
  filesCount,
  files,
  findings,
  canComment,
  onOpenFinding,
  targetFile,
  smartOrder,
  onSmartOrderChange,
}: DiffTabProps) {
  const t = useTranslations("prReview");
  const { data: comments } = usePrComments(prId);
  const create = useCreatePrComment(prId);
  // Comments start hidden so the diff is clean by default — toggle to reveal.
  const [showComments, setShowComments] = React.useState(false);
  const { data: smartDiff } = useSmartDiff(prId);

  // Fall back to the plain viewer until the grouping arrives, so the tab never
  // renders empty while a request is in flight.
  const showSmart = smartOrder && smartDiff !== undefined;

  // Which (viewer, file) pairs have already been scrolled to. `?file=` is never
  // cleared, so without this an order toggle minutes later would drag the reader
  // back to the Risk Brief's file.
  const scrolled = React.useRef(new Set<string>());

  /**
   * Scroll the targeted file into view. Every `FileCard` carries its own path as
   * `data-file-path`, in both viewers, so this works whichever one is on screen.
   *
   * Keyed on `showSmart` as well as the target — the same reason the finding
   * jump keys on `shown` (`FindingsPanel.tsx:68-76`): the tree this scrolls
   * inside may not be the final one yet. On the cold path the grouping has not
   * arrived, so the first run lands in the PLAIN viewer and the whole list is
   * replaced by the risk-ordered one a moment later; re-running after the swap
   * is what makes the jump land instead of leaving the card open off-screen.
   *
   * `CSS.escape`, not interpolation: a path is GitHub-supplied text and a `"`
   * or a `]` in one would otherwise end the attribute selector and throw a
   * `SyntaxError` out of `querySelector` — the same rule the finding jump
   * follows (`FindingsPanel.tsx:74`).
   */
  React.useEffect(() => {
    if (!targetFile) return;
    const key = `${showSmart ? "smart" : "plain"}:${targetFile}`;
    if (scrolled.current.has(key)) return;
    const card = document.querySelector(`[data-file-path="${CSS.escape(targetFile)}"]`);
    if (!card) return;
    scrolled.current.add(key);
    card.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [targetFile, showSmart]);

  const commentCount = comments?.length ?? 0;

  const commenting: DiffCommentApi = {
    comments: comments ?? [],
    canComment: !!canComment && !!prId,
    showComments,
    posting: create.isPending,
    onSubmit: async (input) => {
      try {
        const res = await create.mutateAsync(input);
        setShowComments(true); // a just-posted comment shouldn't stay hidden
        return res;
      } catch (err) {
        notify.error(err instanceof Error ? err.message : "Couldn't post the comment to GitHub.");
        throw err;
      }
    },
  };

  // Summed from the files rather than read off PrDetail: the two disagree on a
  // PR whose file list GitHub truncated, and the total under a file list should
  // describe the list that is actually there.
  const totalAdditions = files.reduce((n, f) => n + (f.additions ?? 0), 0);
  const totalDeletions = files.reduce((n, f) => n + (f.deletions ?? 0), 0);

  return (
    <section>
      <SectionLabel
        icon="Code"
        right={
          <div style={s.actions}>
            {commentCount > 0 && (
              <Button
                kind="ghost"
                size="sm"
                icon={showComments ? "EyeOff" : "Eye"}
                onClick={() => setShowComments((v) => !v)}
              >
                {showComments ? t("diffTab.hideComments") : t("diffTab.showComments")} ({commentCount})
              </Button>
            )}
            <Button
              kind="ghost"
              size="sm"
              active={smartOrder}
              onClick={() => onSmartOrderChange(true)}
            >
              {t("smartDiff.smartOrder")}
            </Button>
            <Button
              kind="ghost"
              size="sm"
              active={!smartOrder}
              onClick={() => onSmartOrderChange(false)}
            >
              {t("smartDiff.originalOrder")}
            </Button>
          </div>
        }
      >
        {showSmart
          ? t("smartDiff.reviewerOrdered")
          : t("diffTab.filesChanged", { count: filesCount })}
      </SectionLabel>
      <div style={s.summary}>
        {t("diffTab.totals", { count: filesCount })}
        <span style={s.added}>+{totalAdditions}</span>{" "}
        <span style={s.deleted}>−{totalDeletions}</span>
      </div>
      {showSmart ? (
        <SmartDiffViewer
          smartDiff={smartDiff}
          files={files}
          findings={findings}
          commenting={commenting}
          {...(onOpenFinding ? { onOpenFinding } : {})}
          {...(targetFile ? { openFile: targetFile } : {})}
        />
      ) : (
        <DiffViewer files={files} commenting={commenting} />
      )}
    </section>
  );
}
