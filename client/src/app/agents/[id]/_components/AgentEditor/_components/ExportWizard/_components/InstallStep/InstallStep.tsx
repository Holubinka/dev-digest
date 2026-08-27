/* Step 4 — Install. The two ways the bundle reaches the repository, and the one
   step neither of them can do for you (AC-36…AC-38, AC-43, AC-45, AC-119). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Icon } from "@devdigest/ui";
import { CI_SECRET_KEY } from "../../constants";
import type { InstallAction } from "../../reducer";
import { s } from "./styles";

export function InstallStep({
  repo,
  fileCount,
  removals,
  action,
  prUrl,
  zipped,
  error,
  onAction,
}: {
  repo: string;
  fileCount: number;
  /** Paths publishing deletes, as the server reported them (AC-145, AC-146). */
  removals: string[];
  action: InstallAction;
  prUrl: string | null;
  zipped: boolean;
  error: string | null;
  onAction: (action: InstallAction) => void;
}) {
  const t = useTranslations("ci");

  if (prUrl) {
    return (
      <div style={s.wrap}>
        <div style={s.success}>
          <div style={s.successHead}>
            <Icon.CheckCircle size={18} style={s.successIcon} />
            <span style={s.successTitle}>{t("exportWizard.successTitle")}</span>
          </div>
          {/* The PR link is a URL the API returned; `noopener noreferrer`
              because it leaves the app for github.com. */}
          <a href={prUrl} target="_blank" rel="noopener noreferrer" style={s.link}>
            <Icon.ExternalLink size={13} />
            {t("exportWizard.successPr")}
          </a>
          <p style={s.secretNote}>
            {t("exportWizard.secretNote", { key: CI_SECRET_KEY, repo })}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={s.wrap}>
      <button
        type="button"
        aria-pressed={action === "open_pr"}
        onClick={() => onAction("open_pr")}
        style={s.prCard(action === "open_pr")}
      >
        <div style={s.prHead}>
          <Icon.GitPullRequest size={18} style={s.prIcon} />
          <span style={s.prTitle}>{t("exportWizard.installCardTitle")}</span>
          <Badge color="var(--accent-text)" bg="var(--bg-elevated)" style={s.badge}>
            {t("exportWizard.recommended")}
          </Badge>
        </div>
        {/* AC-38: `fileCount` is `files.length` of the bundle the previous step
            showed, never a constant. */}
        <p style={s.prBody}>
          {t("exportWizard.installCardBody", { repo, count: fileCount })}
        </p>
        {/* AC-145: the deletion is named BEFORE it happens, and by the same
            commit that writes the files above (AC-146). The paths are the
            server's — it decides what the publication removes, and the step that
            has to say so should not be the one guessing. */}
        {removals.length > 0 && (
          <p style={s.removalNote}>
            {t("exportWizard.installRemovesIntro")}{" "}
            {removals.map((path) => (
              <span key={path} className="mono" style={s.removalPath}>
                {path}
              </span>
            ))}
          </p>
        )}
      </button>

      <button
        type="button"
        aria-pressed={action === "files"}
        onClick={() => onAction("files")}
        style={s.zipCard(action === "files")}
      >
        <div style={s.zipHead}>
          <Icon.Copy size={16} style={s.zipIcon} />
          <span style={s.zipTitle}>{t("exportWizard.zipCardTitle")}</span>
          <span style={s.zipHint}>{t("exportWizard.zipCardHint")}</span>
        </div>
      </button>

      {/* AC-119 is shown on the step, not only after the download: it is what
          the reader needs BEFORE choosing the zip. */}
      <p style={s.zipWarning}>{t("exportWizard.zipWarning")}</p>

      {zipped && <p style={s.done}>{t("exportWizard.zipDone")}</p>}

      {/* AC-43: the named cause, on the Install step, with both cards still
          there to try again. */}
      {error && (
        <div role="alert" style={s.error}>
          {action === "files"
            ? t("exportWizard.zipFailed", { reason: error })
            : t("exportWizard.installFailed", { reason: error })}
        </div>
      )}
    </div>
  );
}
