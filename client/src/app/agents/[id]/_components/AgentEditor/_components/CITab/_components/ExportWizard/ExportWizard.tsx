/* ExportWizard — the four-step modal that puts an agent into a repository's CI
   (SPEC-05 § Steps 1-4).

   The whole session lives in one `useReducer` (see `reducer.ts`), which is what
   makes AC-7 structural rather than remembered: closing the modal unmounts this
   component, and the only requests it can make are the ones `Continue` and
   `Install` fire. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, ExportWizardSteps, Modal } from "@devdigest/ui";
import { errorMessage } from "@/lib/api";
import { useActiveRepo } from "@/lib/repo-context";
import { useDownloadCiZip, useExportCi } from "@/lib/hooks/ci";
import type { CiExportInputBody } from "@/lib/types";
import { ConfigureStep } from "./_components/ConfigureStep";
import { InstallStep } from "./_components/InstallStep";
import { PreviewStep } from "./_components/PreviewStep";
import { TargetStep } from "./_components/TargetStep";
import { STEP_LABEL_KEYS } from "./constants";
import { baseBranchOf } from "./helpers";
import {
  contentsOf,
  editedWorkflow,
  firstEditedPath,
  hasEdits,
  initialState,
  reducer,
  resolveChange,
  type ConfigChange,
  type PostAs,
} from "./reducer";
import { s } from "./styles";

export function ExportWizard({
  agentId,
  agentName,
  initialRepo,
  installedRepos,
  onClose,
}: {
  agentId: string;
  agentName: string;
  /** The repo to open on — an installation's when `Update CI config` opened it. */
  initialRepo?: string | null;
  /** `owner/name` of every repo this agent is already installed in (AC-104). */
  installedRepos: string[];
  onClose: () => void;
}) {
  const t = useTranslations("ci");
  const { repos, reposLoaded, activeRepo } = useActiveRepo();

  // AC-8: the sidebar repo is the default, and `Update CI config` overrides it
  // with the installation's own. Resolved once, at open: the wizard is a
  // session, and a sidebar change under an open modal must not move the target.
  const [state, dispatch] = React.useReducer(
    reducer,
    { repos, preferred: initialRepo ?? activeRepo?.full_name ?? "" },
    (init) => {
      const repo = init.repos.some((r) => r.full_name === init.preferred) ? init.preferred : "";
      return initialState(repo, repo ? baseBranchOf(init.repos, repo) : "");
    },
  );

  // Two instances of the same mutation on purpose: `generate` runs on every
  // Continue and every Configure change, `install` runs once at the end, and a
  // shared `error`/`isPending` would let a failed generation read as a failed
  // install on a step that never ran (`client/INSIGHTS.md` — a mutation's error
  // is sticky).
  const generate = useExportCi(agentId);
  const install = useExportCi(agentId);
  const zip = useDownloadCiZip(agentId);

  const alreadyInstalled = !!state.repo && installedRepos.includes(state.repo);
  const canContinue =
    state.step === 0
      ? !!state.repo
      : state.step === 1
        ? state.files.length > 0
        : state.triggers.length > 0;

  const body = (over: Partial<CiExportInputBody> = {}): CiExportInputBody => ({
    repo: state.repo,
    // AC-14: the request always carries `gha`. The other three cards select
    // nothing, so there is no target in the wizard's state to disagree with it.
    target: "gha",
    action: "files",
    post_as: state.postAs,
    triggers: state.triggers,
    base: state.base,
    ...over,
  });

  const regenerate = async (triggers: string[], postAs: PostAs) => {
    // Nothing valid can be generated from an empty trigger set, and AC-28
    // already blocks `Continue` for it; the previous bundle stays on screen
    // until a trigger comes back.
    if (triggers.length === 0) return;
    const res = await generate.mutateAsync(body({ triggers, post_as: postAs }));
    dispatch({ type: "files", files: res.files, removals: res.removals });
  };

  const onContinue = () => {
    if (state.step === 0) {
      dispatch({ type: "step", step: 1 });
      void regenerate(state.triggers, state.postAs).catch(() => {
        /* the reason is rendered from `generate.error` on the Preview step */
      });
      return;
    }
    dispatch({ type: "step", step: state.step + 1 });
  };

  const applyChange = (change: ConfigChange) => {
    const next = resolveChange(state, change);
    // Synchronous, and BEFORE the request: the new setting and the loss of the
    // hand edit are one decision the reader just confirmed, so they land
    // together whatever the network then does (`reducer.ts`, case "config").
    dispatch({ type: "config", ...next });
    void regenerate(next.triggers, next.postAs).catch(() => {
      /* the reason is rendered from `generate.error` on the Configure step */
    });
  };

  const onConfigChange = (change: ConfigChange) => {
    // AC-31 regenerates on every change; AC-32 makes that reversible when it
    // would throw away something the reader typed.
    if (hasEdits(state)) {
      dispatch({ type: "requestConfig", change });
      return;
    }
    applyChange(change);
  };

  const onInstall = async () => {
    // AC-31: the workflow the reader edited by hand is what gets published —
    // both routes accept it and the server validates it as YAML before writing
    // anything (AC-55). Only this last request carries it: `regenerate` above
    // exists to THROW the edit away, so sending it there would defeat AC-32.
    const workflow = editedWorkflow(state);

    if (state.installAction === "files") {
      // AC-44: the zip route makes no GitHub call and writes no installation
      // row, which is what AC-119's warning on this step is about.
      await zip.mutateAsync(body({ action: "files", workflow })).then(
        () => dispatch({ type: "zipped" }),
        () => {},
      );
      return;
    }
    await install.mutateAsync(body({ action: "open_pr", workflow })).then(
      (res) => dispatch({ type: "installed", prUrl: res.pr_url }),
      () => {
        /* AC-43: no row was written, the cause is rendered, the step stays. */
      },
    );
  };

  const footer = (
    <div style={s.footer}>
      {state.step > 0 && !state.prUrl && (
        <Button
          kind="ghost"
          icon="ChevronLeft"
          onClick={() => dispatch({ type: "step", step: state.step - 1 })}
        >
          {t("exportWizard.back")}
        </Button>
      )}
      <div style={s.footerRight}>
        {state.prUrl ? (
          <Button kind="primary" icon="Check" onClick={onClose}>
            {t("exportWizard.close")}
          </Button>
        ) : state.step < 3 ? (
          <Button
            kind="primary"
            iconRight="ArrowRight"
            disabled={!canContinue}
            onClick={onContinue}
          >
            {t("exportWizard.continue")}
          </Button>
        ) : (
          <Button
            kind="primary"
            icon="Check"
            loading={install.isPending || zip.isPending}
            onClick={() => void onInstall()}
          >
            {install.isPending || zip.isPending
              ? t("exportWizard.installing")
              : t("exportWizard.install")}
          </Button>
        )}
      </div>
    </div>
  );

  return (
    <Modal
      width={720}
      title={t("exportWizard.title")}
      subtitle={t("exportWizard.subtitle", { agentName: agentName || t("exportWizard.thisAgent") })}
      onClose={onClose}
      footer={footer}
    >
      <div style={s.steps}>
        <ExportWizardSteps step={state.step} labels={STEP_LABEL_KEYS.map((k) => t(k))} />
      </div>
      <div style={s.body}>
        {state.step === 0 && (
          <TargetStep
            repos={repos}
            reposLoaded={reposLoaded}
            repo={state.repo}
            base={state.base}
            alreadyInstalled={alreadyInstalled}
            onRepo={(fullName) =>
              dispatch({ type: "repo", repo: fullName, base: baseBranchOf(repos, fullName) })
            }
          />
        )}
        {state.step === 1 && (
          <PreviewStep
            files={state.files}
            selectedPath={state.selectedPath}
            contentsOf={(file) => contentsOf(state, file)}
            generating={generate.isPending}
            error={generate.isError ? errorMessage(generate.error) : null}
            onSelect={(path) => dispatch({ type: "select", path })}
            onEdit={(path, contents) => dispatch({ type: "edit", path, contents })}
          />
        )}
        {state.step === 2 && (
          <ConfigureStep
            triggers={state.triggers}
            postAs={state.postAs}
            pendingChange={state.pendingChange}
            pendingPath={firstEditedPath(state)}
            // Beside the controls, never instead of them (`client/INSIGHTS.md` —
            // "a mutation's error is sticky"): a regeneration that failed leaves
            // the bundle on screen one config behind, and the reader is the only
            // one who can decide whether to retry it or install anyway.
            error={generate.isError ? errorMessage(generate.error) : null}
            onChange={onConfigChange}
            onConfirmChange={() => state.pendingChange && applyChange(state.pendingChange)}
            onCancelChange={() => dispatch({ type: "cancelConfig" })}
          />
        )}
        {state.step === 3 && (
          <InstallStep
            repo={state.repo}
            fileCount={state.files.length}
            removals={state.removals}
            action={state.installAction}
            prUrl={state.prUrl}
            zipped={state.zipped}
            error={
              state.installAction === "files"
                ? zip.isError
                  ? errorMessage(zip.error)
                  : null
                : install.isError
                  ? errorMessage(install.error)
                  : null
            }
            onAction={(value) => dispatch({ type: "installAction", value })}
          />
        )}
      </div>
    </Modal>
  );
}
