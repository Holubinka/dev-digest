/* PeriodPicker — the pill in a page header: 1 day, 30 days, or a custom range.

   The picked period goes into the URL, not into component state alone (AC-6), so
   the caller owns it and this component only reports a choice.

   It sits in `components/` rather than beside the dashboard because the agent
   editor's Stats tab offers the same three windows (AC-47), and a second copy is
   the one that starts accepting a fourth. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Dropdown, Modal, TextInput } from "@devdigest/ui";
import { toDateInput } from "@/components/agent-stats";
import type { PerfPeriodQuery } from "@/lib/hooks/performance";
import { s } from "./styles";

const DAY_MS = 86_400_000;

export function PeriodPicker({
  period,
  onChange,
}: {
  period: PerfPeriodQuery;
  onChange: (next: PerfPeriodQuery) => void;
}) {
  const t = useTranslations("agentPerformance");
  const [customOpen, setCustomOpen] = React.useState(false);

  const label =
    period.range === "custom" ? t("period.customShort") : t(`period.${period.range}`);

  return (
    <>
      <Dropdown
        align="right"
        width={190}
        trigger={
          <Button kind="secondary" icon="Calendar" aria-label={t("period.pick")}>
            {label}
          </Button>
        }
        items={[
          { label: t("period.1d"), onClick: () => onChange({ range: "1d" }) },
          { label: t("period.30d"), onClick: () => onChange({ range: "30d" }) },
          { label: t("period.custom"), onClick: () => setCustomOpen(true) },
        ]}
      />
      {customOpen && (
        <CustomRangeModal
          period={period}
          onClose={() => setCustomOpen(false)}
          onApply={(next) => {
            setCustomOpen(false);
            onChange(next);
          }}
        />
      )}
    </>
  );
}

function CustomRangeModal({
  period,
  onClose,
  onApply,
}: {
  period: PerfPeriodQuery;
  onClose: () => void;
  onApply: (next: PerfPeriodQuery) => void;
}) {
  const t = useTranslations("agentPerformance");
  const now = new Date();
  const [from, setFrom] = React.useState(
    period.from ? toDateInput(new Date(period.from)) : toDateInput(new Date(now.getTime() - 7 * DAY_MS)),
  );
  const [to, setTo] = React.useState(
    period.to ? toDateInput(new Date(new Date(period.to).getTime() - DAY_MS)) : toDateInput(now),
  );

  const start = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  // The end DAY is inclusive to a reader picking it, and the window is half-open
  // on the server — so the bound sent is the start of the day after.
  const endExclusive = new Date(end.getTime() + DAY_MS);
  const valid =
    !Number.isNaN(start.getTime()) &&
    !Number.isNaN(end.getTime()) &&
    start.getTime() < endExclusive.getTime();

  return (
    <Modal
      width={430}
      title={t("period.custom")}
      onClose={onClose}
      footer={
        <div style={s.actions}>
          <Button kind="ghost" onClick={onClose}>
            {t("period.cancel")}
          </Button>
          <Button
            kind="primary"
            disabled={!valid}
            onClick={() =>
              onApply({
                range: "custom",
                from: start.toISOString(),
                to: endExclusive.toISOString(),
              })
            }
          >
            {t("period.apply")}
          </Button>
        </div>
      }
    >
      <div style={s.form}>
        <div style={s.row}>
          <label style={s.field}>
            <span style={s.label}>{t("period.from")}</span>
            <TextInput type="date" value={from} onChange={setFrom} />
          </label>
          <label style={s.field}>
            <span style={s.label}>{t("period.to")}</span>
            <TextInput type="date" value={to} onChange={setTo} />
          </label>
        </div>
        {!valid && <span style={s.error}>{t("period.invalid")}</span>}
      </div>
    </Modal>
  );
}
