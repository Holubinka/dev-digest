/* Step 1 — Target. The repository the workflow is added to (AC-8, AC-9,
   AC-103, AC-104) and the four CI targets (AC-10…AC-13). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, FormField, Icon, SearchableSelect } from "@devdigest/ui";
import type { Repo } from "@/lib/types";
import { CI_TARGETS } from "../../constants";
import { s } from "./styles";

export function TargetStep({
  repos,
  reposLoaded,
  repo,
  base,
  alreadyInstalled,
  onRepo,
}: {
  repos: Repo[];
  reposLoaded: boolean;
  repo: string;
  base: string;
  alreadyInstalled: boolean;
  onRepo: (fullName: string) => void;
}) {
  const t = useTranslations("ci");
  const empty = reposLoaded && repos.length === 0;

  return (
    <div>
      {empty ? (
        <div style={s.notice}>
          <Icon.Info size={15} style={s.noticeIcon} />
          <span>{t("exportWizard.noRepos")}</span>
        </div>
      ) : (
        <FormField label={t("exportWizard.repoLabel")} hint={t("exportWizard.repoHint")}>
          <SearchableSelect
            value={repo}
            onChange={onRepo}
            options={repos.map((r) => r.full_name)}
            placeholder={t("exportWizard.repoPlaceholder")}
          />
          {repo && <div style={s.base}>{t("exportWizard.repoBase", { branch: base })}</div>}
        </FormField>
      )}

      {alreadyInstalled && (
        <div style={s.notice}>
          <Icon.Info size={15} style={s.noticeIcon} />
          <span>{t("exportWizard.alreadyInstalled", { repo })}</span>
        </div>
      )}

      <div style={s.grid}>
        {CI_TARGETS.map((target) => (
          <button
            key={target.key}
            type="button"
            // `aria-disabled`, never `disabled`: the three unimplemented cards
            // stay focusable so a keyboard reader meets the "not implemented"
            // mark instead of skipping past it (AC-12). The guard below is what
            // makes mouse, Enter and Space all no-ops (AC-13) — a native button
            // fires `click` for all three.
            aria-disabled={!target.implemented}
            aria-pressed={target.implemented}
            onClick={() => {
              /* Only GitHub Actions is implemented, and it is already the
                 selection, so no activation on this step can change it. */
            }}
            style={s.card(target.implemented, !target.implemented)}
          >
            <div style={s.cardHead}>
              <div style={s.cardIcon(target.implemented)}>
                {React.createElement(Icon[target.icon], { size: 18 })}
              </div>
              <span style={s.cardName}>{t(target.labelKey)}</span>
              {target.implemented ? (
                <Badge color="var(--accent-text)" bg="var(--accent-bg)" style={s.cardBadge}>
                  {t("exportWizard.recommended")}
                </Badge>
              ) : (
                <Badge color="var(--text-muted)" style={s.cardBadge}>
                  {t("exportWizard.notImplemented")}
                </Badge>
              )}
            </div>
            <p style={s.cardDesc}>{t(target.descKey)}</p>
          </button>
        ))}
      </div>
    </div>
  );
}
