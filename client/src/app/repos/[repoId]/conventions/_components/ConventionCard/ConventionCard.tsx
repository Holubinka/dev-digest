/* ConventionCard — one candidate rule: the code that backs it, how sure the
   scan is, and the three things a person can do about it (accept, reject,
   reword). The snippet is the repository's own text — the server stores what it
   read out of the clone — so the file:line link is safe to trust. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Icon, IconBtn, MonoLink, ProgressBar, Textarea } from "@devdigest/ui";
import type { ConventionCandidate } from "@devdigest/shared";
import { githubBlobUrl } from "@/lib/github-urls";
import { confidenceColor, lineLabel } from "./helpers";
import { COPIED_FEEDBACK_MS } from "./constants";
import { s } from "./styles";

export function ConventionCard({
  candidate,
  repoFullName,
  onStatus,
  onRule,
  pending,
}: {
  candidate: ConventionCandidate;
  repoFullName?: string | null;
  onStatus: (status: ConventionCandidate["status"]) => void;
  onRule: (rule: string) => void;
  pending?: boolean;
}) {
  const t = useTranslations("conventions");
  const [draft, setDraft] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);

  // `navigator.clipboard` is undefined outside a secure context, and jsdom has
  // no clipboard at all — a failed copy leaves the icon alone rather than
  // claiming success.
  const copy = (text: string) => {
    navigator.clipboard?.writeText(text).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
      },
      () => {},
    );
  };

  const linkTo = (path: string, line: number, endLine: number) =>
    repoFullName && candidate.head_sha
      ? githubBlobUrl(repoFullName, candidate.head_sha, path, line, endLine)
      : undefined;

  const accepted = candidate.status === "accepted";
  const confidence = Math.round((candidate.confidence ?? 0) * 100);

  return (
    <div className="dd-card" data-convention-id={candidate.id} style={s.card(candidate.status)}>
      <div style={s.main}>
        {draft === null ? (
          <div style={s.ruleRow}>
            <span style={s.rule(candidate.status === "rejected")}>{candidate.rule}</span>
            <button
              onClick={() => setDraft(candidate.rule)}
              title={t("card.edit")}
              aria-label={t("card.edit")}
              style={s.editButton}
            >
              <Icon.Edit size={14} />
            </button>
          </div>
        ) : (
          <div>
            <Textarea
              value={draft}
              onChange={setDraft}
              rows={3}
              placeholder={t("card.editRule")}
            />
            <div style={s.editRow}>
              <Button
                kind="primary"
                size="sm"
                icon="Check"
                disabled={draft.trim() === "" || pending}
                onClick={() => {
                  onRule(draft.trim());
                  setDraft(null);
                }}
              >
                {t("card.save")}
              </Button>
              <Button kind="ghost" size="sm" onClick={() => setDraft(null)}>
                {t("card.cancel")}
              </Button>
            </div>
          </div>
        )}

        {candidate.evidence_path && candidate.evidence_snippet && (
          <div style={s.evidence}>
            <div style={s.evidenceHeader}>
              <span style={s.evidencePath}>
                <MonoLink
                  href={linkTo(
                    candidate.evidence_path,
                    candidate.evidence_line ?? 1,
                    candidate.evidence_end_line ?? candidate.evidence_line ?? 1,
                  )}
                >
                  {candidate.evidence_path}
                  {lineLabel(candidate.evidence_line, candidate.evidence_end_line)}
                </MonoLink>
              </span>
              <IconBtn
                icon={copied ? "Check" : "Copy"}
                label={copied ? t("card.copied") : t("card.copy")}
                size={26}
                onClick={() => copy(candidate.evidence_snippet ?? "")}
              />
            </div>
            <pre className="mono" style={s.snippet}>
              {candidate.evidence_snippet}
            </pre>
            {candidate.extra_evidence.length > 0 && (
              <div style={s.moreEvidence}>
                <span style={s.label}>{t("card.alsoAt")}</span>
                {candidate.extra_evidence.map((e) => (
                  <MonoLink key={`${e.path}:${e.line}`} href={linkTo(e.path, e.line, e.end_line)}>
                    {e.path}
                    {lineLabel(e.line, e.end_line)}
                  </MonoLink>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="dd-card-meta" style={s.metaRow}>
          <span style={s.category}>{t(`category.${candidate.category}`)}</span>
          <span style={s.label}>{t("card.confidence")}</span>
          <div style={s.confidenceBar}>
            <ProgressBar value={confidence} color={confidenceColor(confidence)} />
          </div>
          <span style={s.confidenceValue}>{confidence}%</span>
        </div>
      </div>

      <div className="dd-card-actions" style={s.actions}>
        <Button
          kind={accepted ? "primary" : "secondary"}
          icon="Check"
          full
          disabled={pending}
          onClick={() => onStatus(accepted ? "pending" : "accepted")}
        >
          {accepted ? t("card.accepted") : t("card.accept")}
        </Button>
        <Button
          kind="secondary"
          icon="X"
          full
          disabled={pending}
          onClick={() =>
            onStatus(candidate.status === "rejected" ? "pending" : "rejected")
          }
        >
          {candidate.status === "rejected" ? t("card.rejected") : t("card.reject")}
        </Button>
      </div>
    </div>
  );
}
