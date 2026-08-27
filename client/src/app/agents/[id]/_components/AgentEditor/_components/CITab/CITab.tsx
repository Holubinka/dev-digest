/* CITab — where this agent runs in CI, what makes it fail a build, and the way
   in for another repository (SPEC-05 § Agent CI tab, AC-2, AC-85…AC-91).

   The `Fail CI on` control renders `agents.ci_fail_on` and never a local copy of
   the click, which is what makes AC-94 structural: a save that fails leaves the
   stored value on screen because that is the only value the control ever read. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, EmptyState, ErrorState, Icon, Skeleton } from "@devdigest/ui";
import type { Agent } from "@devdigest/shared";
import { errorMessage } from "@/lib/api";
import { useUpdateAgent } from "@/lib/hooks/agents";
import { useCiInstallations } from "@/lib/hooks/ci";
import { relativeTime } from "@/lib/relative-time";
import type { CiInstallationListItem } from "@/lib/types";
import { ExportWizard } from "./_components/ExportWizard";
import {
  FAIL_ON_OPTIONS,
  RUN_STATUS_COLOR,
  SKELETON_ROWS,
  UNCONFIRMED_BADGE,
} from "./constants";
import { s } from "./styles";

/** What the wizard is open for: a new repository, or one already installed. */
type WizardTarget = { repo: string | null };

/** The file path inside a sentence, set apart the way every path here is. */
function file(chunks: React.ReactNode) {
  return <span className="mono">{chunks}</span>;
}

/**
 * Why the tab cannot say this installation's workflow is running (AC-147…AC-149).
 *
 * The reason is the SERVER's — `unconfirmed_reason` is one field decided from
 * `last_polled_at`, `workflow_present` and `observed_agent` together — so this
 * renders it and never recomputes it from parts.
 */
function UnconfirmedNote({ install }: { install: CiInstallationListItem }) {
  const t = useTranslations("ci");
  const path = install.workflow_path;

  // AC-149: the agent that file really runs, named. The server sets it whenever
  // it sets this reason; the fallback exists so a null could never produce a
  // sentence that accuses nobody.
  if (install.unconfirmed_reason === "other_agent") {
    return (
      <p style={s.unconfirmedNote}>
        {t.rich("ciTab.unconfirmedOtherAgent", {
          path,
          agent: install.observed_agent ?? t("ciTab.someOtherAgent"),
          file,
        })}
      </p>
    );
  }
  // AC-147 names the path Actions does not have; AC-148 says only that nothing
  // has been checked yet. Both name the file, because in both cases it is the
  // thing the reader would go and look for.
  if (install.unconfirmed_reason === "workflow_missing") {
    return <p style={s.unconfirmedNote}>{t.rich("ciTab.unconfirmedMissing", { path, file })}</p>;
  }
  if (install.unconfirmed_reason === "never_polled") {
    return <p style={s.unconfirmedNote}>{t.rich("ciTab.unconfirmedNeverPolled", { path, file })}</p>;
  }
  return null;
}

function InstallationRow({
  install,
  agentVersion,
  onUpdate,
}: {
  install: CiInstallationListItem;
  agentVersion: number;
  onUpdate: () => void;
}) {
  const t = useTranslations("ci");
  // The status is a stored enum value, rendered as the text it is (AC-77) —
  // an unrecognised one still reaches the reader, muted rather than dropped.
  const status = install.last_run_status;
  // `Object.hasOwn`, never a bare index: the value is a free string off the
  // wire, and `RUN_STATUS_COLOR["toString"]` returns an inherited function —
  // truthy, so the `??` below would never fire and `tone.color` would arrive
  // at `<Badge>` undefined. client/INSIGHTS.md records this fixed in four
  // places on 2026-08-02.
  const known = status !== null && status !== undefined && Object.hasOwn(RUN_STATUS_COLOR, status);
  const tone = (known ? RUN_STATUS_COLOR[status] : undefined) ?? {
    color: "var(--text-muted)",
    bg: "var(--bg-hover)",
  };

  // AC-147, AC-148, AC-149: a row DevDigest cannot vouch for says so on its own
  // face, next to the last run it did see.
  const reason = install.unconfirmed_reason;
  const unconfirmed = reason && Object.hasOwn(UNCONFIRMED_BADGE, reason) ? UNCONFIRMED_BADGE[reason] : undefined;

  return (
    <div style={s.row}>
      <div style={s.rowLine}>
        <Icon.GitBranch size={16} style={s.rowIcon} />
        <span className="mono" style={s.rowRepo}>
          {install.repo}
        </span>
        <Badge color="var(--text-secondary)" icon="Workflow">
          {t(`exportWizard.targets.${install.target_type}`)}
        </Badge>
        {unconfirmed && (
          <Badge color={unconfirmed.color} bg={unconfirmed.bg} icon={unconfirmed.icon}>
            {t("ciTab.unconfirmed")}
          </Badge>
        )}
        {status ? (
          <Badge color={tone.color} bg={tone.bg} dot>
            {known ? t(`runs.status.${status}`) : status}
          </Badge>
        ) : (
          <span style={s.rowTime}>{t("ciTab.noRuns")}</span>
        )}
        {install.last_run_at && (
          <span style={s.rowTime}>
            {t("ciTab.ago", { time: relativeTime(install.last_run_at) })}
          </span>
        )}
        {/* AC-90: the marker names both numbers, so "behind" is a comparison the
            reader can check rather than an impression. */}
        {install.stale && (
          <>
            <Badge color="var(--warn)" bg="var(--warn-bg)" icon="AlertTriangle">
              {t("ciTab.stale")}
            </Badge>
            {install.agent_version != null && (
              <span style={s.staleDetail}>
                {t("ciTab.staleDetail", {
                  installed: install.agent_version,
                  current: agentVersion,
                })}
              </span>
            )}
          </>
        )}
      {/* AC-91 is per installation, so the control is too. The header keeps the
          mockup's single button; this one is what names a repository.

          It carries a visible label, not just the icon: `RefreshCw` alone reads
          as "re-run", while this opens the wizard to republish the bundle as a
          pull request. The `aria-label` still names the repository, which the
          one-word label cannot. */}
        <Button
          kind="ghost"
          size="sm"
          icon="RefreshCw"
          aria-label={t("ciTab.updateConfigFor", { repo: install.repo })}
          onClick={onUpdate}
        >
          {t("ciTab.updateShort")}
        </Button>
      </div>

      <UnconfirmedNote install={install} />
    </div>
  );
}

export function CITab({ agent }: { agent: Agent }) {
  const t = useTranslations("ci");
  const installs = useCiInstallations(agent.id);
  const save = useUpdateAgent();
  const [wizard, setWizard] = React.useState<WizardTarget | null>(null);

  const rows = installs.data ?? [];
  const confirmed = rows.filter((r) => r.unconfirmed_reason === null).length;
  // While the save is in flight the chosen value leads, so the control does not
  // sit on the old one for a round trip. Once it settles, `agent` is the only
  // source again — including after a failure (AC-94).
  const shown = (save.isPending && save.variables?.patch.ci_fail_on) || agent.ci_fail_on;
  const known = FAIL_ON_OPTIONS.some((o) => o === shown);

  const wizardModal = wizard && (
    <ExportWizard
      agentId={agent.id}
      agentName={agent.name}
      initialRepo={wizard.repo}
      installedRepos={rows.map((r) => r.repo)}
      onClose={() => setWizard(null)}
    />
  );

  if (installs.isLoading) {
    return (
      <div style={s.wrap}>
        <div style={s.loading}>
          {Array.from({ length: SKELETON_ROWS }).map((_, i) => (
            <Skeleton key={i} height={44} />
          ))}
        </div>
      </div>
    );
  }

  if (installs.isError) {
    return (
      <div style={s.wrap}>
        <ErrorState
          title={t("ciTab.loadError")}
          body={errorMessage(installs.error)}
          onRetry={() => void installs.refetch()}
        />
      </div>
    );
  }

  // AC-2: one action, and no `Fail CI on` block — a threshold for a bundle that
  // was never published is a setting with nothing to apply to.
  if (rows.length === 0) {
    return (
      <div style={s.wrap}>
        {wizardModal}
        <div style={s.empty}>
          <EmptyState
            icon="Workflow"
            title={t("ciTab.empty")}
            body={t("ciTab.emptyBody")}
            cta={t("ciTab.addToCi")}
            onCta={() => setWizard({ repo: null })}
          />
        </div>
      </div>
    );
  }

  return (
    <div style={s.wrap}>
      {wizardModal}

      <div style={s.header}>
        <h2 style={s.heading}>{t("ciTab.heading")}</h2>
        {/* AC-85: N counts the installations whose workflow the last poll
            CONFIRMED, not the rows. A row is a record that DevDigest published a
            bundle; it is not evidence the file survived in the repository, and
            counting rows is what let two agents look active in a repo where one
            had overwritten the other. `unconfirmed_reason === null` is the
            server's own verdict on that (AC-147, AC-148, AC-149). */}
        <Badge
          color={confirmed > 0 ? "var(--ok)" : "var(--text-muted)"}
          bg={confirmed > 0 ? "var(--ok-bg)" : "var(--bg-hover)"}
          dot
        >
          {t("ciTab.activeIn", { count: confirmed })}
        </Badge>
        <div style={s.headerActions}>
          <Button
            kind="secondary"
            size="sm"
            icon="RefreshCw"
            onClick={() => setWizard({ repo: rows[0]!.repo })}
          >
            {t("ciTab.updateConfig")}
          </Button>
          <Button kind="primary" size="sm" icon="Plus" onClick={() => setWizard({ repo: null })}>
            {t("ciTab.addToCi")}
          </Button>
        </div>
      </div>

      <div style={s.failOn}>
        <div style={s.failOnText}>
          <div style={s.failOnLabel}>{t("ciTab.failOnLabel")}</div>
          <div style={s.failOnDesc}>{t("ciTab.failOnDesc")}</div>
          {/* AC-89: the threshold that decides a build lives in the committed
              manifest, so this control alone changes nothing in CI. */}
          <div style={s.failOnNote}>{t("ciTab.failOnRepublishNote")}</div>
          {/* AC-102: `any` is a stored value with no button. Naming it is the
              difference between "no threshold" and "a threshold not shown here". */}
          {!known && <div style={s.failOnCurrent}>{t("ciTab.failOnCurrent", { value: shown })}</div>}
          {save.isSuccess && !save.isPending && (
            <div role="status" style={s.failOnSaved}>
              {t("ciTab.failOnSaved")}
            </div>
          )}
          {save.isError && (
            <div role="alert" style={s.failOnError}>
              {t("ciTab.failOnFailed", { reason: errorMessage(save.error) })}
            </div>
          )}
        </div>
        <div style={s.segmented}>
          {FAIL_ON_OPTIONS.map((opt) => (
            <button
              key={opt}
              type="button"
              aria-pressed={known && shown === opt}
              disabled={save.isPending}
              onClick={() => save.mutate({ id: agent.id, patch: { ci_fail_on: opt } })}
              style={s.segment(known && shown === opt)}
            >
              {t(`ciTab.failOn.${opt}`)}
            </button>
          ))}
        </div>
      </div>

      {rows.map((install) => (
        <InstallationRow
          key={install.id}
          install={install}
          agentVersion={agent.version}
          onUpdate={() => setWizard({ repo: install.repo })}
        />
      ))}

      {/* AC-3: the second way into the wizard, and the one the populated tab
          leads with. */}
      <button type="button" onClick={() => setWizard({ repo: null })} style={s.addRow}>
        <Icon.Plus size={15} />
        {t("ciTab.addRepository")}
      </button>
    </div>
  );
}
