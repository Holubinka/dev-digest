/* RunCostBadge — what one review run cost, in the two shapes the UI needs.
   The numbers are already in the completion response (OpenRouter reports real
   generation cost; everything else is estimated from the price book), so this
   never triggers a model call. */
"use client";

import React from "react";
import { formatCost, formatTokens, NO_DATA } from "./format";
import { s } from "./styles";

export type RunCostVariant =
  /** Cost alone — the PR-list COST column. */
  | "compact"
  /** Cost + the run's token flow — the verdict plaque and the run timeline. */
  | "detailed";

export function RunCostBadge({
  costUsd,
  tokensIn,
  tokensOut,
  variant = "compact",
  title,
}: {
  costUsd: number | null | undefined;
  tokensIn?: number | null;
  tokensOut?: number | null;
  variant?: RunCostVariant;
  title?: string;
}) {
  const cost = formatCost(costUsd);
  // Tokens ride along only when BOTH ends are known — "12k→" is worse than
  // nothing. A cost-less run still shows "—" rather than disappearing.
  const showTokens =
    variant === "detailed" && tokensIn != null && tokensOut != null && cost !== NO_DATA;

  return (
    <span className="mono" style={s.wrap} title={title}>
      <span style={s.cost}>{cost}</span>
      {showTokens && (
        <>
          <span style={s.sep}>·</span>
          <span>{formatTokens(tokensIn, tokensOut)}</span>
        </>
      )}
    </span>
  );
}
