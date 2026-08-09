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
  smartOrder,
  onSmartOrderChange,
}: DiffTabProps) {
  const t = useTranslations("prReview");
  const { data: comments } = usePrComments(prId);
  const create = useCreatePrComment(prId);
  // Comments start hidden so the diff is clean by default — toggle to reveal.
  const [showComments, setShowComments] = React.useState(false);
  const { data: smartDiff } = useSmartDiff(prId);

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

  // Fall back to the plain viewer until the grouping arrives, so the tab never
  // renders empty while a request is in flight.
  const showSmart = smartOrder && smartDiff !== undefined;

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
        />
      ) : (
        <DiffViewer files={files} commenting={commenting} />
      )}
    </section>
  );
}
