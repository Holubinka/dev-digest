"use client";

import React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Badge, Button, MonoLink, SectionLabel, Skeleton } from "@devdigest/ui";
import { ApiError } from "@/lib/api";
import { githubBlobUrl } from "@/lib/github-urls";
import type { PrFile, RiskBriefRecord, ReviewFocusItem } from "@/lib/types";
import type { Risk } from "@devdigest/shared";
import { riskTone, statusKey } from "./constants";
import { isLinkablePath, shortSha } from "./helpers";
import { s } from "./styles";

interface PrBriefCardProps {
  /** `null` = the server holds no brief for this head; `undefined` = not asked yet. */
  brief: RiskBriefRecord | null | undefined;
  isLoading: boolean;
  isError: boolean;
  /** The query's failure or the compute mutation's, whichever the tab saw last. */
  error: unknown;
  computing: boolean;
  onCompute: () => void;
  /** The PR's changed files — what decides whether a focus item can be a control. */
  prFiles: PrFile[];
  /** `owner/repo`, or null until the repo loads. No repo, no github.com link. */
  repoFullName: string | null;
  onOpenFile: (path: string) => void;
}

/**
 * PR WHY + RISK BRIEF on PR Detail → Overview: what this PR does, why, how risky
 * it is, and where to look first.
 *
 * Presentational, like `IntentCard` and unlike `BlastRadiusCard`: `OverviewTab`
 * owns `usePrBrief` / `useComputeBrief` because it is also the one that fires
 * the automatic first computation, and a card that computed on mount would fire
 * again on every state this component is re-rendered in.
 *
 * EVERY model-written string below is rendered as `{value}`. No `<Markdown>`,
 * no `dangerouslySetInnerHTML` — the PR body two elements away in the same tab
 * uses the former, and this is exactly where that would become stored XSS.
 */
export function PrBriefCard({
  brief,
  isLoading,
  isError,
  error,
  computing,
  onCompute,
  prFiles,
  repoFullName,
  onOpenFile,
}: PrBriefCardProps) {
  const t = useTranslations("brief");

  // Four states, in this order, none masking another. `computing` leads because
  // a regeneration replaces the record of the head already on screen, and
  // showing the old one under a spinner is the "presents a previous state as
  // current" that AC-7 forbids. Across heads the cache key does that job on its
  // own — `["brief", prId, headSha]` cannot resolve to another head's brief.
  if (computing || isLoading) {
    return (
      <CardShell title={t("riskBrief.title")}>
        <p role="status" style={s.note}>
          {t("riskBrief.computing")}
        </p>
        <Skeleton height={16} style={s.skeletonRow} />
        <Skeleton width="70%" height={12} />
      </CardShell>
    );
  }

  if (isError) {
    return (
      <CardShell title={t("riskBrief.title")}>
        <FailureBody error={error} />
        {/* Disabled by its own in-flight mutation and by nothing else — a retry
            taken away in the state it recovers from is no retry at all
            (`client/INSIGHTS.md:297-311`). */}
        <Button kind="ghost" size="sm" icon="RefreshCw" onClick={onCompute} disabled={computing}>
          {t("riskBrief.compute")}
        </Button>
      </CardShell>
    );
  }

  // Where a DISABLED query lands too: without a `prId` or a `head_sha` the query
  // is `enabled: false`, and a disabled TanStack v5 query reports
  // `isLoading === false` with `data === undefined` (`client/INSIGHTS.md:490-517`),
  // so "we have not asked yet" falls through to here and never to a skeleton
  // that never resolves.
  if (brief == null) {
    return (
      <CardShell title={t("riskBrief.title")}>
        <p style={s.note}>{t("unavailable")}</p>
        <p style={s.hint}>{t("unavailableHint")}</p>
        <Button kind="ghost" size="sm" icon="Sparkles" onClick={onCompute} disabled={computing}>
          {t("riskBrief.compute")}
        </Button>
      </CardShell>
    );
  }

  const tone = riskTone(brief.risk_level);
  // Derived during render, not stored: a `useState` mirror of query data is the
  // anti-pattern `react-best-practices` opens with.
  const changedPaths = new Set(prFiles.map((f) => f.path));

  return (
    <CardShell title={t("riskBrief.title")}>
      <div style={s.levelRow}>
        <span style={s.colLabel}>{t("riskBrief.level")}</span>
        {/* The WORD, not the colour alone (AC-4). */}
        <Badge color={tone.color} bg={tone.bg} icon={tone.icon}>
          {brief.risk_level}
        </Badge>
        {/* No risks is a sentence beside the level, not an empty Risks section. */}
        {brief.risks.length === 0 && <span style={s.note}>{t("noRisks")}</span>}
      </div>

      <div style={s.colLabel}>{t("riskBrief.what")}</div>
      <p style={s.prose}>{brief.what}</p>

      <div style={s.colLabel}>{t("riskBrief.why")}</div>
      <p style={s.prose}>{brief.why}</p>

      {/* Three-valued, and all three branch. `unknown` is what an absent commit
          date produces, and rendering it as `fresh` would report a freshness the
          system does not have. `unknown` with no intent at all says nothing here
          — the inputs block below already reports the intent as missing. */}
      {brief.intent_freshness === "stale" && (
        <p style={s.hint}>{t("riskBrief.intentStale")}</p>
      )}
      {brief.intent_freshness === "unknown" && brief.intent_computed_at != null && (
        <p style={s.hint}>{t("riskBrief.intentAgeUnknown")}</p>
      )}

      {/* The risks rest on the index at `link_sha`, not on the head. Same
          sentence shape as `blast.json`'s `staleIndex`, for the same reason. */}
      {!brief.index_matches_head && brief.link_sha != null && (
        <p style={s.hint}>{t("riskBrief.staleIndex", { sha: shortSha(brief.link_sha) })}</p>
      )}

      {brief.risks.length > 0 && (
        <section style={s.block}>
          <div style={s.colLabel}>{t("block.risks")}</div>
          <ul style={s.list}>
            {/* In the order the server sent. It sorts high → medium → low and
                keeps the model's order inside a level; re-sorting here would be
                a second, drifting implementation of AC-12. */}
            {brief.risks.map((risk, i) => (
              <RiskRow
                key={`${risk.title}-${i}`}
                risk={risk}
                linkSha={brief.link_sha}
                repoFullName={repoFullName}
              />
            ))}
          </ul>
        </section>
      )}

      {brief.review_focus.length > 0 && (
        <section style={s.block}>
          <div style={s.colLabel}>{t("riskBrief.reviewFocus")}</div>
          <ul style={s.list}>
            {brief.review_focus.map((item, i) => (
              <FocusRow
                key={`${item.ref}-${i}`}
                item={item}
                changedPaths={changedPaths}
                onOpenFile={onOpenFile}
              />
            ))}
          </ul>
        </section>
      )}

      {/* What the brief was built from and what is missing (AC-33). */}
      <section style={s.block}>
        <div style={s.colLabel}>{t("riskBrief.inputs")}</div>
        <ul style={s.inputList}>
          {brief.inputs.map((input) => {
            const key = statusKey(input.status);
            return (
              <li key={input.id} style={s.inputRow}>
                <span className="mono" style={s.inputId}>
                  {input.id}
                </span>
                <Badge>{key ? t(key) : input.status}</Badge>
                {input.detail != null && <span style={s.inputDetail}>{input.detail}</span>}
              </li>
            );
          })}
        </ul>
      </section>

      <div style={s.footer}>
        <Button kind="ghost" size="sm" icon="RefreshCw" onClick={onCompute} disabled={computing}>
          {t("riskBrief.regenerate")}
        </Button>
      </div>
    </CardShell>
  );
}

/** The frame every state shares, so the four never drift apart visually. */
function CardShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={s.card}>
      <SectionLabel icon="Gauge">{title}</SectionLabel>
      {children}
    </section>
  );
}

/**
 * What went wrong, in the reader's terms.
 *
 * A missing provider key is not a failure the reader can retry into success, so
 * it gets its own copy and a way to fix it; everything else shows the server's
 * own sentence under a stable heading, which is what makes "shows the reason"
 * more than a generic apology.
 */
function FailureBody({ error }: { error: unknown }) {
  const t = useTranslations("brief");

  if (error instanceof ApiError && error.code === "config_error") {
    return (
      <>
        <p style={s.note}>{t("riskBrief.notConfigured")}</p>
        <p style={s.hint}>
          <Link href="/settings/models" style={s.link}>
            {t("riskBrief.notConfiguredLink")}
          </Link>
        </p>
      </>
    );
  }

  const detail =
    error instanceof ApiError
      ? error.status === 429
        ? t("riskBrief.rateLimited")
        : error.message
      : null;

  return (
    <>
      <p style={s.note}>{t("riskBrief.failed")}</p>
      {detail != null && <p style={s.hint}>{detail}</p>}
    </>
  );
}

/** One risk: its level, title, explanation and the references behind it. */
function RiskRow({
  risk,
  linkSha,
  repoFullName,
}: {
  risk: Risk;
  /**
   * The commit the references belong to — never `head_sha`. Null when the index
   * knows no commit, in which case every reference degrades to plain text:
   * there is no commit at which these paths are true, and a link to the head
   * would open the wrong file rather than no file.
   */
  linkSha: string | null;
  repoFullName: string | null;
}) {
  const tone = riskTone(risk.severity);
  return (
    <li style={s.risk}>
      <div style={s.riskHead}>
        <Badge color={tone.color} bg={tone.bg} icon={tone.icon}>
          {risk.severity}
        </Badge>
        <span style={s.riskTitle}>{risk.title}</span>
      </div>
      <p style={s.riskBody}>{risk.explanation}</p>
      {risk.file_refs.length > 0 && (
        <div style={s.refRow}>
          {risk.file_refs.map((ref, i) => (
            <FileRef
              key={`${ref}-${i}`}
              path={ref}
              linkSha={linkSha}
              repoFullName={repoFullName}
            />
          ))}
        </div>
      )}
    </li>
  );
}

/**
 * One reference, as a github.com link when every condition holds and as text
 * otherwise. Never a `MonoLink` without an `href`, which renders a `<button>`
 * with nothing behind it.
 */
function FileRef({
  path,
  linkSha,
  repoFullName,
}: {
  path: string;
  linkSha: string | null;
  repoFullName: string | null;
}) {
  const href =
    linkSha != null && repoFullName != null && isLinkablePath(path)
      ? githubBlobUrl(repoFullName, linkSha, path)
      : undefined;

  return href ? (
    <MonoLink href={href}>{path}</MonoLink>
  ) : (
    <span className="mono" style={s.refPlain}>
      {path}
    </span>
  );
}

/**
 * One review-focus item.
 *
 * It becomes a control only when its ref names a file THIS PR changed and the
 * path survives the URL rules — a `kind: "endpoint"` label fails the first test
 * on its own, and grounding membership is not the same question as URL safety.
 * Anything else is a `<span>`, never a `<button>` with no action.
 */
function FocusRow({
  item,
  changedPaths,
  onOpenFile,
}: {
  item: ReviewFocusItem;
  changedPaths: ReadonlySet<string>;
  onOpenFile: (path: string) => void;
}) {
  const t = useTranslations("brief");
  const linkable = changedPaths.has(item.ref) && isLinkablePath(item.ref);

  return (
    <li style={s.focus}>
      {linkable ? (
        <button
          type="button"
          className="mono"
          style={s.focusButton}
          title={t("riskBrief.openFile")}
          onClick={() => onOpenFile(item.ref)}
        >
          {item.ref}
        </button>
      ) : (
        <span className="mono" style={s.refPlain}>
          {item.ref}
        </span>
      )}
      <span style={s.focusReason}>{item.reason}</span>
    </li>
  );
}
