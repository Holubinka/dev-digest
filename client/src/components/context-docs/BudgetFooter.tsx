/* BudgetFooter — "≈ N tokens" for the effective set, and the over-budget
   warning.

   Everything here is DERIVED DURING RENDER from the two arrays the server sent.
   Nothing is copied into `useState`, because the total is a function of the
   attachments and copying it would produce a number that lags the list beside
   it by one save. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@devdigest/ui";
import type { AttachedContextDoc, InheritedContextDoc } from "@/lib/types";
import { effectiveTokens } from "./helpers";
import { s } from "./styles";

export function BudgetFooter({
  attached,
  inherited = [],
  budgetTokens,
  strategy,
}: {
  attached: AttachedContextDoc[];
  inherited?: InheritedContextDoc[];
  budgetTokens: number;
  /** The agent's review strategy; absent on the skill editor, which has none. */
  strategy?: string;
}) {
  const t = useTranslations("context");
  // Own plus inherited, deduped by path: a document attached in both places is
  // sent once, so it counts once. The numbers come from the server's counter —
  // `approxTokens` is the wrong figure to make a budget decision against.
  const total = effectiveTokens(attached, inherited);
  const overage = total - budgetTokens;

  return (
    <div style={s.footer}>
      <Badge color={overage > 0 ? "var(--warn)" : "var(--text-muted)"}>
        {t("attach.tokens", { count: total })}
      </Badge>
      <span style={s.budgetOf}>{t("attach.budget", { budget: budgetTokens })}</span>

      {/* Saving stays enabled: going over budget is a thing a maintainer may
          legitimately do, and the run drops what does not fit, in order. */}
      {overage > 0 && <span style={s.warning}>{t("attach.overBudget", { overage })}</span>}

      {/* Non-`single-pass` states the RULE and the per-prompt figure, and names
          no product. The editor is open on an agent, not on a pull request, so
          any file count it multiplied by would be a number about a PR that does
          not exist — and a concrete total reads as a measurement rather than an
          illustration. */}
      {strategy !== undefined && strategy !== "single-pass" && (
        <span style={s.perPrompt}>{t("attach.perPrompt", { strategy })}</span>
      )}
    </div>
  );
}
