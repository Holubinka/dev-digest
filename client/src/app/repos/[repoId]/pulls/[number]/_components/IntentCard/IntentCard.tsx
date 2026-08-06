"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, Icon, SectionLabel, Skeleton, type IconName } from "@devdigest/ui";
import type { IntentRecord } from "@/lib/types";
import { confidenceColor, riskChip } from "./constants";
import { s } from "./styles";

interface IntentCardProps {
  intent: IntentRecord | null | undefined;
  isLoading: boolean;
  isError: boolean;
  onRecompute: () => void;
  recomputing: boolean;
}

/**
 * The derived INTENT card on PR Detail → Overview.
 *
 * Purely presentational: `OverviewTab` owns `usePrIntent` / `useRecomputeIntent`
 * and passes the results in, which is why this file's test needs only
 * `NextIntlClientProvider` — no query client and no `fetch` mock.
 */
export function IntentCard({
  intent,
  isLoading,
  isError,
  onRecompute,
  recomputing,
}: IntentCardProps) {
  const t = useTranslations("brief");

  const recompute = (
    <Button kind="ghost" size="sm" icon="RefreshCw" onClick={onRecompute} disabled={recomputing}>
      {recomputing ? t("intent.computing") : t("intent.recompute")}
    </Button>
  );

  // Four states, in this order. `isLoading` may lead safely BECAUSE the query is
  // disabled without a `prId` and a disabled TanStack v5 query reports
  // `isLoading === false` (`client/INSIGHTS.md:438-453`) — so "we have not asked
  // yet" falls through to the empty state below, never to a skeleton that never
  // resolves.
  if (isLoading) {
    return (
      <section style={s.card}>
        <SectionLabel icon="Target">{t("block.intent")}</SectionLabel>
        <Skeleton height={16} style={s.skeletonRow} />
        <Skeleton width="70%" height={12} />
      </section>
    );
  }

  if (isError) {
    return (
      <section style={s.card}>
        <SectionLabel icon="Target">{t("block.intent")}</SectionLabel>
        <p style={s.note}>{t("intent.failed")}</p>
        {recompute}
      </section>
    );
  }

  // `null` from the API means "nothing derived yet" — an empty state with a
  // working button, visibly different from the failure above.
  //
  // The copy is `intent.*`, not the sibling `brief.*` scaffolding: this card is
  // INTENT, not the Brief, and opening a PR does not derive an intent — only a
  // review run or the button below does.
  if (intent == null) {
    return (
      <section style={s.card}>
        <SectionLabel icon="Target">{t("block.intent")}</SectionLabel>
        <p style={s.note}>{t("intent.unavailable")}</p>
        <p style={s.hint}>{t("intent.unavailableHint")}</p>
        {recompute}
      </section>
    );
  }

  const band = confidenceColor(intent.confidence);
  return (
    <section style={s.card}>
      <SectionLabel
        icon="Target"
        right={
          <Badge color={band.color} bg={band.bg}>
            {t("intent.confidence", { band: intent.confidence })}
          </Badge>
        }
      >
        {t("block.intent")}
      </SectionLabel>

      <p style={s.goal}>&ldquo;{intent.intent}&rdquo;</p>

      <div style={s.grid}>
        <ScopeColumn
          label={t("intent.inScope")}
          icon="Check"
          color="var(--ok)"
          items={intent.in_scope}
          empty={t("intent.none")}
        />
        <ScopeColumn
          label={t("intent.outOfScope")}
          icon="X"
          color="var(--text-muted)"
          items={intent.out_of_scope}
          empty={t("intent.none")}
        />
      </div>

      {intent.risk_areas.length > 0 && (
        <div style={s.risks}>
          <div style={s.colLabel}>{t("intent.riskAreas")}</div>
          <div style={s.riskRow}>
            {intent.risk_areas.map((area, i) => {
              const chip = riskChip(area);
              // `Badge` is a <span>. `Chip` renders a <button>, and a button
              // with no action is an accessibility defect.
              return (
                <Badge key={`${area}-${i}`} icon={chip.icon} color={chip.color} bg={chip.bg}>
                  {area}
                </Badge>
              );
            })}
          </div>
        </div>
      )}

      <div style={s.footer}>
        <span>{t("intent.model", { model: intent.model })}</span>
        {recompute}
      </div>
    </section>
  );
}

/** One scope column. An empty array renders the label and an em dash — never a fabricated bullet. */
function ScopeColumn({
  label,
  icon,
  color,
  items,
  empty,
}: {
  label: string;
  icon: IconName;
  color: string;
  items: string[];
  empty: string;
}) {
  const I = Icon[icon];
  return (
    <div>
      <div style={s.colLabel}>
        <I size={12} style={{ color }} />
        {label}
      </div>
      {items.length > 0 ? (
        <ul style={s.list}>
          {items.map((item, i) => (
            <li key={`${item}-${i}`} style={s.listItem}>
              {item}
            </li>
          ))}
        </ul>
      ) : (
        <div style={s.dash}>{empty}</div>
      )}
    </div>
  );
}
