/* CompareRunsModal — two batches side by side: four old→new tiles with their
   deltas (AC-60), the system prompt with only the changed lines highlighted
   when the versions differ (AC-61) or a statement that it did not change when
   they do not (AC-62), a warning when the two case sets are not the same
   (AC-63), and «Promote» (AC-64/AC-65).

   Nothing here diffs text. `changed_lines` is computed on the server precisely
   so that the highlight cannot drift from the numbers beside it. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Icon, Modal } from "@devdigest/ui";
import { formatCost } from "@/components/run-cost-badge";
import type { EvalCompare } from "@/lib/types";
import { useEvalCompare, usePromoteAgentVersion } from "@/lib/hooks/eval";
import { pct } from "../../../_components/format";
import { s } from "./styles";

export function CompareRunsModal({
  agentId,
  batchA,
  batchB,
  onClose,
}: {
  agentId: string;
  /** The OLDER batch. The caller orders the pair; this modal never reorders. */
  batchA: string;
  batchB: string;
  onClose: () => void;
}) {
  const t = useTranslations("eval");
  const { data, isLoading } = useEvalCompare(batchA, batchB);
  const promote = usePromoteAgentVersion();

  if (isLoading || !data) {
    return (
      <Modal width={880} title={t("dashboard.compare")} onClose={onClose}>
        <div style={s.loading}>
          {isLoading ? t("compareModal.loading") : t("compareModal.loadError")}
        </div>
      </Modal>
    );
  }

  const { a, b, delta, prompt, like_for_like: likeForLike, case_diff: caseDiff } = data;

  return (
    <Modal
      width={880}
      title={t("compareModal.title", { a: prompt.a_version, b: prompt.b_version })}
      subtitle={t("compareModal.subtitle", { cases: b.cases })}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          <Button kind="ghost" size="sm" onClick={onClose}>
            {t("compareModal.close")}
          </Button>
          <Button
            kind="primary"
            size="sm"
            icon="GitBranch"
            disabled={promote.isPending}
            loading={promote.isPending}
            onClick={() => promote.mutate({ agentId, version: prompt.b_version })}
          >
            {promote.isPending
              ? t("compareModal.promoting")
              : t("compareModal.promote", { version: prompt.b_version })}
          </Button>
        </div>
      }
    >
      <div style={s.body}>
        <div className="dd-eval-compare-tiles" style={s.tiles}>
          <Tile
            label={t("compareModal.metrics.recall")}
            oldText={`${pct(a.recall)}%`}
            newText={`${pct(b.recall)}%`}
            color="var(--accent)"
            delta={delta.recall}
            deltaText={pointLabel(delta.recall)}
          />
          <Tile
            label={t("compareModal.metrics.precision")}
            oldText={`${pct(a.precision)}%`}
            newText={`${pct(b.precision)}%`}
            color="var(--ok)"
            delta={delta.precision}
            deltaText={pointLabel(delta.precision)}
          />
          <Tile
            label={t("compareModal.metrics.citation")}
            oldText={`${pct(a.citation_accuracy)}%`}
            newText={`${pct(b.citation_accuracy)}%`}
            color="var(--warn)"
            delta={delta.citation_accuracy}
            deltaText={pointLabel(delta.citation_accuracy)}
          />
          <Tile
            label={t("compareModal.metrics.cost")}
            oldText={formatCost(a.cost_usd)}
            newText={formatCost(b.cost_usd)}
            color="var(--text-primary)"
            delta={delta.cost_usd}
            deltaText={delta.cost_usd == null ? "—" : Math.abs(delta.cost_usd).toFixed(2)}
          />
        </div>

        {/* AC-63: two batches over different case sets have different
            denominators, so the deltas above are not a like-for-like reading and
            the reader is told before they act on them. */}
        {!likeForLike && (
          <div role="status" style={s.warning}>
            <Icon.AlertTriangle size={15} style={{ color: "var(--warn)", flexShrink: 0 }} />
            <span>
              {t("compareModal.notLikeForLike", {
                onlyInA: caseDiff.only_in_a.length,
                onlyInB: caseDiff.only_in_b.length,
              })}
            </span>
          </div>
        )}

        <PromptSection prompt={prompt} />

        {promote.isSuccess && (
          <div role="status" style={s.promoted}>
            {t("compareModal.promoted", { version: prompt.b_version })}
          </div>
        )}
      </div>
    </Modal>
  );
}

/** A metric delta is read in percentage POINTS, the way both mockups print it. */
function pointLabel(delta: number): string {
  return `${Math.abs(Math.round(delta * 100))}pt`;
}

function Tile({
  label,
  oldText,
  newText,
  color,
  delta,
  deltaText,
}: {
  label: string;
  oldText: string;
  newText: string;
  color: string;
  delta: number | null;
  deltaText: string;
}) {
  const flat = delta == null || Math.abs(delta) < 0.0005;
  const up = (delta ?? 0) > 0;
  const dc = flat ? "var(--text-muted)" : up ? "var(--ok)" : "var(--crit)";
  const DeltaIcon = flat ? Icon.Slash : up ? Icon.ArrowUp : Icon.ArrowDown;
  return (
    <div style={s.tile}>
      <div style={s.tileLabel}>{label}</div>
      <div style={s.tileRow}>
        <span className="tnum" style={s.tileOld}>
          {oldText}
        </span>
        <span style={s.tileArrow}>→</span>
        <span className="tnum" style={s.tileNew(color)}>
          {newText}
        </span>
        <span style={s.tileDelta(dc)}>
          <DeltaIcon size={11} />
          <span className="tnum">{deltaText}</span>
        </span>
      </div>
    </div>
  );
}

function PromptSection({ prompt }: { prompt: EvalCompare["prompt"] }) {
  const t = useTranslations("eval");

  if (!prompt.changed) {
    // AC-62. The deltas above stay exactly where they are: identical prompts
    // with different numbers is the interesting case, not an error — the linked
    // skills or the cases moved instead (spec D4).
    return (
      <>
        <div style={s.legend}>
          <span style={{ ...s.tileLabel }}>{t("compareModal.promptDiff")}</span>
        </div>
        <div style={s.unchanged}>
          {t("compareModal.promptUnchanged", { version: prompt.b_version })}
        </div>
      </>
    );
  }

  // `changed_lines` are 1-based line numbers into `b_text`, the new side — the
  // side the reader is being asked to promote.
  const changed = new Set(prompt.changed_lines);
  const lines = prompt.b_text.split("\n");

  return (
    <>
      <div style={s.legend}>
        <span style={{ ...s.tileLabel }}>{t("compareModal.promptDiff")}</span>
        <span style={s.legendItem}>
          <span style={s.legendSwatch("var(--crit)")} />
          {t("compareModal.legendOld", { version: prompt.a_version })}
        </span>
        <span style={s.legendItem}>
          <span style={s.legendSwatch("var(--ok)")} />
          {t("compareModal.legendNew", { version: prompt.b_version })}
        </span>
      </div>
      <div className="mono" style={s.promptBox}>
        {lines.map((line, i) => (
          // The index IS the identity here: these are the numbered lines of one
          // immutable string, never reordered or filtered.
          <span
            key={i}
            data-prompt-line={i + 1}
            data-changed={changed.has(i + 1) ? "true" : undefined}
            style={s.promptLine(changed.has(i + 1))}
          >
            {line === "" ? " " : line}
          </span>
        ))}
      </div>
    </>
  );
}
