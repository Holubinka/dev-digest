/* FindingsPanel — hide-low-confidence + j/k navigation + FindingCard list,
   wiring the accept/dismiss action hook (A2). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Toggle, EmptyState } from "@devdigest/ui";
import type { FindingRecord } from "@devdigest/shared";
import { useRouter } from "next/navigation";
import { FindingCard } from "../FindingCard";
import type { SeverityLevel } from "../SeverityFilterBar";
import { useFindingAction } from "../../../../../../../lib/hooks/reviews";
// The eval hooks module directly, never `lib/hooks` — that barrel is `export *`
// over five domains, and this panel needs one mutation out of one of them.
import { useEvalCaseFromFinding } from "../../../../../../../lib/hooks/eval";
import { KEY_TO_ACTION } from "./constants";
import { visibleFindings } from "./helpers";
import { s } from "./styles";

export function FindingsPanel({
  findings,
  prId,
  repoFullName,
  headSha,
  severity = null,
  active = true,
  targetFindingId = null,
}: {
  findings: FindingRecord[];
  prId: string;
  repoFullName?: string | null;
  headSha?: string | null;
  /** A finding to reveal, focus and scroll to — set by a Smart Diff chip. */
  targetFindingId?: string | null;
  /** Set from the PR-level severity bar — show only findings at this level. */
  severity?: SeverityLevel | null;
  /**
   * Whether this panel owns the j/k/a/d shortcuts. The listener is on `window`,
   * so several mounted panels would each answer the same keypress.
   */
  active?: boolean;
}) {
  const t = useTranslations("prReview");
  const router = useRouter();
  const action = useFindingAction();
  const toEvalCase = useEvalCaseFromFinding();
  const [hideLow, setHideLow] = React.useState(false);
  const [focusIdx, setFocusIdx] = React.useState(0);

  /**
   * `created: false` is not an error — it means this finding already has a case,
   * and the second click must land on it rather than report a conflict (AC-10).
   * Both outcomes therefore navigate to the same place: the owning agent's Evals
   * tab, with the case open. `owner_id` comes back on the case, so this panel
   * never has to know which agent produced the finding.
   */
  const turnIntoEvalCase = (findingId: string) =>
    toEvalCase.mutate(findingId, {
      onSuccess: ({ case: c }) =>
        router.push(`/agents/${c.owner_id}?tab=evals&case=${encodeURIComponent(c.id)}`),
    });

  const shown = React.useMemo(
    () => visibleFindings(findings, hideLow, severity),
    [findings, hideLow, severity],
  );

  // Both filters can shrink the list under a focus that has already moved. Clamp
  // it, or nothing is focused and `k` has to be pressed as many times as the
  // list lost entries before anything responds again.
  React.useEffect(() => {
    setFocusIdx((i) => Math.min(i, Math.max(0, shown.length - 1)));
  }, [shown.length]);

  // A low-confidence target would be filtered out of its own arrival, so lift
  // the filter on ARRIVAL — keyed on the incoming id, not on a value derived
  // from `hideLow` itself. Keyed the other way it is not a one-shot: turning the
  // filter back on re-hides the target, which re-fires the lift, and the switch
  // is inert for the rest of the visit because `?finding=` is never cleared.
  React.useEffect(() => {
    if (targetFindingId) setHideLow(false);
  }, [targetFindingId]);

  // Focus and scroll to the targeted finding. `data-finding-id` is already on
  // every card (FindingCard.tsx) — this only has to find it, and only once the
  // accordion above has opened, which is why it keys off `shown`.
  React.useEffect(() => {
    if (!targetFindingId) return;
    const idx = shown.findIndex((f) => f.id === targetFindingId);
    if (idx < 0) return;
    setFocusIdx(idx);
    document
      .querySelector(`[data-finding-id="${CSS.escape(targetFindingId)}"]`)
      ?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [targetFindingId, shown]);

  // j/k navigation + a/d shortcuts on the focused finding (keyboard).
  React.useEffect(() => {
    if (!active) return;
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "j") setFocusIdx((i) => Math.min(i + 1, shown.length - 1));
      else if (e.key === "k") setFocusIdx((i) => Math.max(i - 1, 0));
      else if (KEY_TO_ACTION[e.key] && shown[focusIdx]) {
        action.mutate({ findingId: shown[focusIdx]!.id, action: KEY_TO_ACTION[e.key]!, prId });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [active, shown, focusIdx, action, prId]);

  return (
    <div>
      <div style={s.toolbar}>
        {active && <span style={s.shortcuts}>{t("panel.shortcuts")}</span>}
        <div style={s.toggleGroup}>
          {t("panel.hideLowConfidence")}
          <Toggle on={hideLow} onChange={setHideLow} size={16} />
        </div>
      </div>

      <div style={s.list}>
        {shown.length === 0 ? (
          <EmptyState icon="Filter" title={t("panel.noMatchTitle")} body={t("panel.noMatchBody")} />
        ) : (
          shown.map((f, i) => (
            <FindingCard
              key={f.id}
              f={f}
              focused={i === focusIdx}
              defaultExpanded={i === 0 || f.id === targetFindingId}
              pending={action.isPending}
              repoFullName={repoFullName}
              headSha={headSha}
              onAction={(act) => action.mutate({ findingId: f.id, action: act, prId })}
              onTurnIntoEvalCase={() => turnIntoEvalCase(f.id)}
              evalCasePending={toEvalCase.isPending && toEvalCase.variables === f.id}
            />
          ))
        )}
      </div>
    </div>
  );
}
