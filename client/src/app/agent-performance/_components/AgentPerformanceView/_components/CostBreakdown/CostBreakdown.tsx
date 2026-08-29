/* CostBreakdown — the same total, split by agent and by model.

   The two donuts are partitions of one set of runs, so both add up to the tile
   above them (AC-32, AC-33). The buckets with no name — a deleted agent, a run
   that recorded no model — are drawn rather than dropped, because dropping them
   is what would silently break that equality (AC-34, AC-35). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Donut, SectionLabel, type DonutSegment } from "@devdigest/ui";
import { AGENT_COLORS, agentColor } from "@/lib/agent-color";
import type { AgentPerf } from "@/lib/types";
import { s } from "./styles";

export function CostBreakdown({ perf }: { perf: AgentPerf }) {
  const t = useTranslations("agentPerformance");

  // The agent's colour comes from its id, exactly as the table row's swatch does
  // (`lib/agent-color.ts`), so one agent is one colour on both halves of the
  // screen. A deleted agent has no id to hash, so it takes the muted slot.
  const byAgent: DonutSegment[] = perf.cost_by_agent.map((seg) => ({
    label: seg.agent_id === null ? t("cost.deletedAgents") : seg.label,
    value: seg.value,
    color: seg.agent_id === null ? "var(--text-muted)" : agentColor(seg.agent_id),
  }));

  const byModel: DonutSegment[] = perf.cost_by_model.map((seg, i) => ({
    label: seg.label === "" ? t("cost.unknownModel") : seg.label,
    value: seg.value,
    color: AGENT_COLORS[i % AGENT_COLORS.length]!,
  }));

  return (
    <>
      <SectionLabel icon="DollarSign">{t("cost.heading")}</SectionLabel>
      <div className="dd-perf-cost" style={s.row}>
        <div style={s.card}>
          <div style={s.title}>{t("cost.byAgent")}</div>
          {byAgent.length === 0 ? (
            <div style={s.empty}>{t("cost.noCost")}</div>
          ) : (
            <Donut segments={byAgent} />
          )}
        </div>
        <div style={s.card}>
          <div style={s.title}>{t("cost.byModel")}</div>
          {byModel.length === 0 ? (
            <div style={s.empty}>{t("cost.noCost")}</div>
          ) : (
            <Donut segments={byModel} />
          )}
        </div>
      </div>
      {/* AC-36/AC-37: every figure above is DevDigest's own estimate. Saying it
          once, under the numbers it qualifies, beats a tooltip nobody opens. */}
      <p style={s.note}>{t("cost.estimated")}</p>
    </>
  );
}
