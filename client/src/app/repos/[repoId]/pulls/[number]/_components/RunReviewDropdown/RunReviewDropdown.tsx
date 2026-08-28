/* RunReviewDropdown — the PR page's "which agents should review this?" control.

   SPEC-05 AC-87 replaced "one agent or all of them" with a chosen SET: every
   agent is a checkbox, and one press starts one multi-run over the lot. What is
   kept from the old body on purpose: every agent is listed whether or not it is
   enabled, a disabled agent stays selectable, and a merged/closed PR still gets
   its non-blocking warning and dimmed trigger.

   The vendored `Dropdown` is deliberately not used here. It closes the menu on
   every item click, which is right for a list of commands and wrong for a list of
   checkboxes — ticking a second agent would shut the panel. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Checkbox, Icon } from "@devdigest/ui";
import { MAX_AGENTS_PER_MULTI_RUN } from "@devdigest/shared";
import { useAgents } from "@/lib/hooks/agents";
import { useCreateMultiAgentRun } from "@/lib/hooks/multi-agent";
import { agentColor } from "@/lib/agent-color";
import { useAgentSelection } from "@/lib/agent-selection";
import { AgentMonogram } from "@/components/agent-monogram";
import { MENU_WIDTH } from "./constants";
import { s } from "./styles";

/** What the parent needs to follow the run it just started. */
export interface MultiRunStarted {
  multiRunId: string;
  runIds: string[];
}

export function RunReviewDropdown({
  prId,
  size = "sm",
  kind = "primary",
  warnMerged = false,
  onRunStart,
  onRunsStarted,
  onRunSettled,
}: {
  prId: string;
  size?: "sm" | "md" | "lg";
  kind?: "primary" | "secondary";
  /** PR is already merged/closed — dim the trigger and warn, but still allow. */
  warnMerged?: boolean;
  /** Fired the moment a run is kicked off (before it completes). */
  onRunStart?: () => void;
  onRunsStarted?: (started: MultiRunStarted) => void;
  /** Fired when the run request settles (success or error). */
  onRunSettled?: () => void;
}) {
  const t = useTranslations("prReview");
  const router = useRouter();
  const { data: agents } = useAgents();
  const run = useCreateMultiAgentRun();
  const all = React.useMemo(() => agents ?? [], [agents]);

  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  /* Is anything below the fold of the agent list? A measurement of the DOM, not
     a value that can be derived from props: the rows are as tall as their
     descriptions wrap, so only layout knows whether `maxHeight` cut one. Read on
     open and on every scroll — both are the events that can change the answer,
     and neither is a timer. */
  const listRef = React.useRef<HTMLDivElement>(null);
  const [moreBelow, setMoreBelow] = React.useState(false);
  const syncMoreBelow = React.useCallback(() => {
    const el = listRef.current;
    // 1px, not 0: fractional layout leaves a sub-pixel remainder at the true
    // bottom, and a fade that never quite goes away is the defect it fixes.
    if (el) setMoreBelow(el.scrollHeight - el.scrollTop - el.clientHeight > 1);
  }, []);
  React.useEffect(() => {
    if (open) syncMoreBelow();
  }, [open, all.length, syncMoreBelow]);

  // Pre-ticks the enabled agents and enforces AC-30's ceiling; the same state
  // machine the Configure run screen drives its cards with.
  const { selected, atCeiling, toggle } = useAgentSelection(all);

  const cta =
    selected.length === 0
      ? t("runReview.selectAgents")
      : selected.length === 1
        ? t("runReview.runOne")
        : t("runReview.runMany", { count: selected.length });

  /* The catch reports nothing and closes nothing, which is the same bargain
     `CreateAgentModal` and `ImportSkillDrawer` strike: the `MutationCache` in
     `lib/providers.tsx` already toasts a failed mutation with the server's own
     reason, and a second message here would be that sentence twice.

     It is NOT the inline `role="alert"` block `ConfigureRunView` renders. That
     screen stays on screen to hold it; this panel is already shut by the line
     above (the tick list has to close on a press, or the reader is left looking
     at checkboxes for a run that started), so an alert inside it would render
     into something nobody can see.

     What the catch is for is the rejection itself. `onClick` cannot await this,
     so a rejected `mutateAsync` escapes as an unhandled promise rejection —
     which is exactly why `ConfigureRunView` reaches for `mutate` instead. */
  const kick = async () => {
    if (selected.length === 0) return;
    onRunStart?.();
    setOpen(false);
    try {
      const res = await run.mutateAsync({ prId, agentIds: selected });
      onRunsStarted?.({ multiRunId: res.id, runIds: res.runs.map((r) => r.run_id) });
    } catch {
      /* toasted globally; `onRunSettled` below still lets the parent stand down */
    } finally {
      onRunSettled?.();
    }
  };

  return (
    <div ref={ref} style={s.root}>
      <span
        title={warnMerged ? t("runReview.mergedTooltip") : undefined}
        style={warnMerged ? s.dimmedTrigger : undefined}
      >
        <Button
          kind={kind}
          size={size}
          iconRight="ChevronDown"
          icon="Sparkles"
          loading={run.isPending}
          onClick={() => setOpen((o) => !o)}
        >
          {run.isPending ? t("runReview.running") : t("runReview.runReview")}
        </Button>
      </span>

      {open && (
        <div style={s.menu(MENU_WIDTH)}>
          {/* Merged/closed PRs can still be reviewed (informational only); lead
              with a muted, non-actionable warning so the intent is clear. */}
          {warnMerged && (
            <div style={s.warnRow}>
              <Icon.AlertTriangle size={14} style={s.warnIcon} />
              <span>{t("runReview.mergedWarning")}</span>
            </div>
          )}

          {all.length === 0 ? (
            <button type="button" style={s.linkRow} onClick={() => router.push("/agents")}>
              <Icon.Plus size={14} style={s.mutedIcon} />
              <span>{t("runReview.noAgents")}</span>
            </button>
          ) : (
            <div style={s.listWrap}>
              <div ref={listRef} style={s.list} onScroll={syncMoreBelow}>
                {all.map((a) => {
                  const on = selected.includes(a.id);
                  return (
                    <div key={a.id} style={s.agentRow(on, agentColor(a.id))}>
                      <Checkbox
                        checked={on}
                        onChange={() => toggle(a.id)}
                        label={
                          <span style={s.agentLabelRow}>
                            <AgentMonogram agentId={a.id} name={a.name} />
                            <span style={s.agentLabel}>
                              <span style={s.agentNameRow}>
                                <span style={s.agentName}>{a.name}</span>
                                {/* AC-8: a disabled agent is MARKED and still
                                    selectable. It used to share the line with the
                                    model; the description took that line, so the
                                    mark moved up beside the name, where it cannot
                                    be pushed out of sight by a long description. */}
                                {!a.enabled && (
                                  <span style={s.disabledTag}>{t("runReview.disabled")}</span>
                                )}
                              </span>
                              {/* AC-7 asks for the agent's DESCRIPTION. The mockup's
                                  second line reads like a past run's summary, and the
                                  human resolved it for the spec on 2026-08-26.
                                  `description` is required but may be empty, and an
                                  empty line is worse than no line. */}
                              {a.description.trim() !== "" && (
                                <span style={s.agentHint}>{a.description}</span>
                              )}
                            </span>
                          </span>
                        }
                      />
                    </div>
                  );
                })}
              </div>
              {/* Only while a card is genuinely cut off below — see `s.listFade`. */}
              {moreBelow && <div aria-hidden="true" style={s.listFade} />}
            </div>
          )}

          {atCeiling && (
            <div style={s.ceilingHint}>
              {t("runReview.maxAgents", { max: MAX_AGENTS_PER_MULTI_RUN })}
            </div>
          )}

          {all.length > 0 && (
            <div style={s.footer}>
              <Button
                kind="primary"
                size="sm"
                icon="Users"
                full
                disabled={selected.length === 0}
                loading={run.isPending}
                onClick={kick}
              >
                {cta}
              </Button>
            </div>
          )}

          <button type="button" style={s.linkRow} onClick={() => router.push("/agents")}>
            <Icon.Settings size={14} style={s.mutedIcon} />
            <span>{t("runReview.configureAgents")}</span>
          </button>
        </div>
      )}
    </div>
  );
}
