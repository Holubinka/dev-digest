/* ConfigureRunView — step 1 pick a PR, step 2 pick the agents, then one run.

   THE CHOSEN PR LIVES IN `?pr`, and it holds the PR's **id**, not its number:
   `MultiAgentRun.pr_number` is nullish in the contract while `pr_id` is not, so
   the results page's "Configure run" action (AC-43) can always hand this screen
   the PR it was looking at. An id that resolves to no PR of this repo is simply
   no selection — the address bar is an untrusted input like any other.

   THE TICKS COME FROM `useAgentSelection`, the state machine this screen shares
   with the PR page's picker (`@/lib/agent-selection`) — including the rule that
   no query data is ever copied into `useState`.

   THE CTA'S THREE LABELS COME FROM `prReview.runReview.*`, the same keys the PR
   page's picker reads. AC-13…AC-15 name the words once; two copies of them are
   two screens that disagree after the first edit. */
"use client";

import React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Checkbox, Dropdown, EmptyState, Icon } from "@devdigest/ui";
import type { DropdownItemDef } from "@devdigest/ui";
import type { PrMeta } from "@devdigest/shared";
import { DEFAULT_MULTI_RUN_CONCURRENCY, MAX_AGENTS_PER_MULTI_RUN } from "@devdigest/shared";
import { AppShell } from "@/components/app-shell";
import { AgentMonogram } from "@/components/agent-monogram";
import { RepoNotFound } from "@/components/repo-not-found";
import { formatCost, NO_DATA } from "@/components/run-cost-badge";
// The drawer's index exports the component only, and this is the app's single
// definition of "how a duration is printed" (`run-trace-drawer/helpers.ts:22`).
// Four surfaces print it now — trace stats, the picker card, the column header
// and the estimate — so it belongs in `src/lib/`; that folder is another work
// package's to write, and a second copy of a format rule is how two surfaces
// start disagreeing to the digit.
import { formatSeconds } from "@/components/run-trace-drawer/helpers";
import { ApiError } from "@/lib/api";
import { agentColor } from "@/lib/agent-color";
import { defaultSelection, useAgentSelection } from "@/lib/agent-selection";
import { useAgents } from "@/lib/hooks/agents";
import { usePulls } from "@/lib/hooks/core";
import { useCreateMultiAgentRun, useLastSuccessfulRuns } from "@/lib/hooks/multi-agent";
import { useRepoNotFound } from "@/lib/repo-context";
import { estimateRun, isAllSelected } from "./helpers";
import { s } from "./styles";

export function ConfigureRunView({ repoId }: { repoId: string }) {
  const t = useTranslations("runs");
  const tPr = useTranslations("prReview");
  const router = useRouter();
  const search = useSearchParams();
  const repoNotFound = useRepoNotFound(repoId);

  const { data: pulls } = usePulls(repoId);
  const { data: agents } = useAgents();
  const { data: lastRuns } = useLastSuccessfulRuns();
  const create = useCreateMultiAgentRun();

  const all = React.useMemo(() => agents ?? [], [agents]);
  const prId = search.get("pr");
  const pr = (pulls ?? []).find((p) => p.id === prId) ?? null;

  /** `#482 · Add rate limiting…`, with the status appended when it is not `open`. */
  const prLabel = (p: PrMeta) =>
    p.status === "open"
      ? t("page.configure.prItem", { number: p.number, title: p.title })
      : t("page.configure.prItemStatus", {
          number: p.number,
          title: p.title,
          status: p.status,
        });

  /* The same state machine the PR page's picker runs on, and it hands the ticks
     back in the agents list's own order — the stable order AC-46 fixes for every
     surface, and what lets the wave estimate below break ties among agents with
     no run history deterministically (AC-152). */
  const { selected, atCeiling, toggle, setSelection } = useAgentSelection(all);

  const setPr = (next: string) => {
    const sp = new URLSearchParams(search.toString());
    sp.set("pr", next);
    router.replace(`/repos/${repoId}/multi-agent/configure?${sp.toString()}`);
  };

  const allOn = isAllSelected(all, selected);
  const toggleAll = () => setSelection(allOn ? [] : defaultSelection(all));

  const estimate = estimateRun(selected, lastRuns);
  const cta =
    selected.length === 0
      ? tPr("runReview.selectAgents")
      : selected.length === 1
        ? tPr("runReview.runOne")
        : tPr("runReview.runMany", { count: selected.length });

  const prItems: DropdownItemDef[] =
    (pulls ?? []).length === 0
      ? [{ label: t("page.configure.noPulls"), muted: true }]
      : // Every PR of the repo, `merged` / `closed` / `stale` included (AC-4).
        // The mockup's prototype filters `stale` out (`screen.jsx:113`); D13 is
        // explicit that the product warns instead of hiding.
        (pulls ?? []).map((p) => ({
          label: prLabel(p),
          icon: "GitPullRequest" as const,
          muted: p.id == null,
          onClick: p.id ? () => setPr(p.id!) : undefined,
        }));

  /* `mutate` and not `mutateAsync`: a rejected `mutateAsync` handed straight to
     `onClick` is an unhandled rejection in the console, and the failure is
     already on screen through `create.isError` below. */
  const run = () => {
    if (!pr?.id || selected.length === 0) return;
    create.mutate(
      { prId: pr.id, agentIds: selected },
      {
        onSuccess: (created) =>
          router.push(`/repos/${repoId}/multi-agent/${encodeURIComponent(created.id)}`),
      },
    );
  };

  const crumb = [
    { label: t("page.crumb"), href: `/repos/${repoId}/multi-agent` },
    { label: t("page.configureCrumb") },
  ];

  if (repoNotFound) {
    return (
      <AppShell crumb={crumb}>
        <RepoNotFound />
      </AppShell>
    );
  }

  return (
    <AppShell crumb={crumb}>
      <div className="dd-page" style={s.page}>
        <h1 style={s.h1}>{t("page.configure.title")}</h1>
        <p style={s.subtitle}>{t("page.configure.subtitle")}</p>

        <div style={s.stepRow}>
          <span style={s.stepMark(true)}>1</span>
          <span style={s.stepLabel(true)}>{t("page.configure.step1")}</span>
        </div>
        <div style={s.stepBody}>
          {/* `full`: the trigger takes the width of the step body — the same box
              the agent cards fill below — instead of the width of whichever PR
              title it happens to be showing, which moved the control on every
              pick. It also gives the menu that same width; the two are one
              decision in `Dropdown`, since a fixed button over a 420px menu
              reads as a mistake.

              The label is a span rather than bare text because `full` makes the
              button wide enough to hold a long title, not short enough to be
              stretched by one: `flex: 1` + `minWidth: 0` leaves the icon and the
              chevron at their own size and gives the ellipsis to the text. */}
          <Dropdown
            full
            items={prItems}
            filter={{
              placeholder: t("page.configure.searchPr"),
              noMatches: t("page.configure.noPrMatch"),
            }}
            trigger={
              <Button kind="secondary" full icon="GitPullRequest" iconRight="ChevronDown">
                <span style={s.prTriggerLabel}>
                  {pr ? prLabel(pr) : t("page.configure.selectPr")}
                </span>
              </Button>
            }
          />
          {/* AC-5: the PR page's own non-blocking warning, by its own key —
              "the same warning" is a promise about the words, not about the
              shape of the box they sit in. */}
          {pr && (pr.status === "merged" || pr.status === "closed") && (
            <div style={s.warnRow}>
              <Icon.AlertTriangle size={14} style={s.warnIcon} />
              <span>{tPr("runReview.mergedWarning")}</span>
            </div>
          )}
        </div>

        <div style={s.stepRow}>
          <span style={s.stepMark(!!pr)}>2</span>
          <span style={s.stepLabel(!!pr)}>{t("page.configure.step2")}</span>
          {pr && all.length > 0 && (
            <button type="button" style={s.selectAll} onClick={toggleAll}>
              {allOn ? t("page.configure.clearAll") : t("page.configure.selectAll")}
            </button>
          )}
        </div>

        {!pr ? (
          <div style={s.stepBody}>
            <div style={s.noPr}>
              <span style={s.noPrIcon}>
                <Icon.GitPullRequest size={21} style={s.mutedIcon} />
              </span>
              <div style={s.noPrTitle}>{t("page.configure.noPr.title")}</div>
              <p style={s.noPrBody}>{t("page.configure.noPr.body")}</p>
            </div>
          </div>
        ) : all.length === 0 ? (
          <div style={s.stepBody}>
            <EmptyState
              icon="Users"
              title={t("page.configure.noAgents.title")}
              body={t("page.configure.noAgents.body")}
              cta={t("page.configure.noAgents.cta")}
              onCta={() => router.push("/agents")}
            />
          </div>
        ) : (
          <div style={s.cards}>
            {all.map((a) => {
              const on = selected.includes(a.id);
              const row = (lastRuns ?? []).find((r) => r.agent_id === a.id);
              return (
                <div key={a.id} style={s.card(on, agentColor(a.id), a.enabled)}>
                  <Checkbox
                    checked={on}
                    onChange={() => toggle(a.id)}
                    label={
                      <span style={s.cardLabel}>
                        <AgentMonogram agentId={a.id} name={a.name} />
                        <span style={s.cardMain}>
                          <span style={s.cardNameRow}>
                            <span style={s.cardName}>{a.name}</span>
                            {/* AC-8: marked disabled, and still selectable. */}
                            {!a.enabled && (
                              <span style={s.disabledTag}>{tPr("runReview.disabled")}</span>
                            )}
                          </span>
                          {/* AC-7 asks for the agent's DESCRIPTION. The mockup's
                              second line is a past run's summary and this card is
                              drawn before the run; the human resolved it for the
                              spec on 2026-08-26. `description` is required but may
                              be empty, and an empty line is worse than no line. */}
                          {a.description.trim() !== "" && (
                            <span style={s.cardDesc}>{a.description}</span>
                          )}
                        </span>
                        <span className="mono" style={s.cardMeta}>
                          {row?.duration_ms != null ? formatSeconds(row.duration_ms) : NO_DATA}
                          {" · "}
                          {formatCost(row?.cost_usd)}
                        </span>
                      </span>
                    }
                  />
                </div>
              );
            })}
          </div>
        )}

        {pr && all.length > 0 && atCeiling && (
          <div style={s.ceilingHint}>
            {tPr("runReview.maxAgents", { max: MAX_AGENTS_PER_MULTI_RUN })}
          </div>
        )}

        <div style={s.runRow}>
          <Button
            kind="primary"
            icon="Users"
            loading={create.isPending}
            /* AC-3: disabled whatever the tick count is, and visibly so — the
               vendored Button dims and drops its pointer on `disabled`. */
            disabled={!pr || selected.length === 0}
            onClick={run}
          >
            {cta}
          </Button>
          {pr && selected.length > 0 && (
            <span className="mono" style={s.estimate}>
              {t("page.configure.estimate", {
                /* AC-154: with an agent that has never run, the waves it sits in
                   contribute nothing, so the number stops being an estimate and
                   is presented as a floor. `≈` when there is no number at all —
                   `≥ —` claims a bound over nothing. */
                bound:
                  estimate.durationMs != null && estimate.missingTime > 0 ? "lower" : "approx",
                time: estimate.durationMs != null ? formatSeconds(estimate.durationMs) : NO_DATA,
                cost: formatCost(estimate.costUsd),
                // AC-141: the ceiling this run WILL get, from the published
                // default — not from a number this screen keeps of its own.
                concurrency: DEFAULT_MULTI_RUN_CONCURRENCY,
              })}
            </span>
          )}
          {pr && selected.length > 0 && estimate.missingTime > 0 && (
            <span style={s.estimateNote}>
              {t("page.configure.missingTime", { count: estimate.missingTime })}
            </span>
          )}
          {pr && selected.length > 0 && estimate.missingCost > 0 && (
            <span style={s.estimateNote}>
              {t("page.configure.missingCost", { count: estimate.missingCost })}
            </span>
          )}
        </div>

        {create.isError && (
          <div role="alert" style={s.runError}>
            {t("page.configure.runFailed", {
              reason: create.error instanceof ApiError ? create.error.message : "",
            })}
          </div>
        )}
      </div>
    </AppShell>
  );
}
