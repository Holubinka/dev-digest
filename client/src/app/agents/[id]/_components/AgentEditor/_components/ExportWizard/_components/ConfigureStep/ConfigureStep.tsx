/* Step 3 — Configure. Trigger chips, "Post results as", and what it actually
   takes to block a merge (AC-27…AC-32). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, Chip, FormField, Icon } from "@devdigest/ui";
import { POST_AS_OPTIONS, TRIGGERS } from "../../constants";
import type { ConfigChange, PostAs } from "../../reducer";
import { s } from "./styles";

export function ConfigureStep({
  triggers,
  postAs,
  pendingChange,
  pendingPath,
  error,
  onChange,
  onConfirmChange,
  onCancelChange,
}: {
  triggers: string[];
  postAs: PostAs;
  pendingChange: ConfigChange | null;
  pendingPath: string;
  /** Why the last regeneration failed (AC-31, AC-32), or null. */
  error: string | null;
  onChange: (change: ConfigChange) => void;
  onConfirmChange: () => void;
  onCancelChange: () => void;
}) {
  const t = useTranslations("ci");

  return (
    <div style={s.wrap}>
      <FormField label={t("exportWizard.triggerLabel")}>
        <div style={s.chips}>
          {TRIGGERS.map((event) => {
            const on = triggers.includes(event);
            return (
              <Chip
                key={event}
                active={on}
                icon={on ? "Check" : undefined}
                onClick={() => onChange({ kind: "trigger", event })}
              >
                {t("exportWizard.triggerChip", { event })}
              </Chip>
            );
          })}
        </div>
        {/* AC-28: the reason has to be on screen, not only in a disabled
            button's tooltip — a disabled control that says nothing reads as a
            broken step. */}
        {triggers.length === 0 && (
          <div role="alert" style={s.reason}>
            {t("exportWizard.noTriggerReason")}
          </div>
        )}
      </FormField>

      <FormField label={t("exportWizard.postResultsLabel")}>
        <div style={s.radios}>
          {POST_AS_OPTIONS.map((opt) => (
            <label key={opt.key} style={s.radioRow}>
              <input
                type="radio"
                name="dd-ci-post-as"
                value={opt.key}
                checked={postAs === opt.key}
                onChange={() => onChange({ kind: "postAs", value: opt.key })}
                style={s.radio}
              />
              {t(opt.labelKey)}
              {opt.recommended && (
                <Badge color="var(--accent-text)" bg="var(--accent-bg)">
                  {t("exportWizard.recommended")}
                </Badge>
              )}
            </label>
          ))}
        </div>
      </FormField>

      {/* A regeneration that failed is a fact about what is on screen: the
          settings above are the new ones, the bundle behind them is the old one,
          and the hand edit the dialog promised to discard IS discarded. Saying
          none of that is what let a stale edit reach someone else's repository. */}
      {error && (
        <div role="alert" style={s.error}>
          {t("exportWizard.regenFailed", { reason: error })}
        </div>
      )}

      <div style={s.info}>
        <Icon.Info size={15} style={s.infoIcon} />
        <div style={s.infoBody}>
          {t.rich("exportWizard.blockMergeDesc", {
            b: (chunks) => <span style={s.infoStrong}>{chunks}</span>,
          })}
        </div>
      </div>

      {/* AC-32. Inline rather than a nested modal: a second overlay above the
          wizard's own would trap focus twice, and the reader has to see which
          control they just touched to judge the trade. */}
      {pendingChange && (
        <div role="alertdialog" aria-label={t("exportWizard.regenTitle")} style={s.dialog}>
          <div style={s.dialogTitle}>{t("exportWizard.regenTitle")}</div>
          <div style={s.dialogBody}>{t("exportWizard.regenBody", { path: pendingPath })}</div>
          <div style={s.dialogActions}>
            <Button kind="primary" size="sm" icon="RefreshCw" onClick={onConfirmChange}>
              {t("exportWizard.regenConfirm")}
            </Button>
            <Button kind="ghost" size="sm" onClick={onCancelChange}>
              {t("exportWizard.regenCancel")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
