/* TaskDetailDialog — one first task, in full: what to do, in what order, what
   the change touches, and how the reader will see it is done.

   IT TAKES A TASK AND NOTHING ELSE ABOUT ONE. Every field it draws is a field of
   `OnboardingTask`, so a value that is not in the tour contract cannot appear
   here — not because someone remembered the rule, but because it was never
   passed in (AC-70).

   NOTHING HERE RE-CHECKS THE SERVER'S GROUNDING. A `steps[].path` arrived proven
   to exist and a `steps[].command` arrived verbatim one of the commands "How to
   run locally" already grounded; the client re-derives neither, exactly as it
   does not re-derive `stale` (`docs/onboarding-tour.md` § What the client reads
   and never recomputes). The one question left to the client is `fileHref`'s,
   which is a different one: whether a proven path is safe inside a URL.

   EVERY STRING HERE IS MODEL PROSE OVER AN IMPORTED REPOSITORY, and all of it is
   rendered by React as text. No `dangerouslySetInnerHTML`, no markdown renderer —
   a renderer is a second way for a link to appear that grounding never approved
   (AC-48, AC-49) — and no control that runs anything. The page has never had a
   run control and this window does not introduce one (`CommandRow.tsx`).

   AN ABSENT STATEMENT DRAWS NOTHING AT ALL. `impact` and `verification` default
   to `''` for every tour saved before they existed, and a heading over an empty
   paragraph would tell the reader the model answered when it did not. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { IconBtn, SectionLabel } from "@devdigest/ui";
import type { OnboardingTask } from "@/lib/types";
import { FileRef } from "../FileRef";
import { CommandRow } from "../CommandRow";
import { ComplexityBadge } from "../ComplexityBadge";
import { useFocusTrap } from "./hooks/useFocusTrap";
import { s } from "./styles";

export function TaskDetailDialog({
  task,
  repoFullName,
  indexSha,
  onClose,
}: {
  task: OnboardingTask;
  /** `owner/repo`, or null until the active repository resolves. */
  repoFullName: string | null | undefined;
  /** The tour's own `index_state.last_indexed_sha`, never the branch head. */
  indexSha: string | null | undefined;
  onClose: () => void;
}) {
  const t = useTranslations("onboarding");
  const dialog = React.useRef<HTMLDivElement>(null);
  const titleId = React.useId();

  const { onScrimMouseDown } = useFocusTrap(dialog, onClose);

  return (
    /* The scrim still does not close the window — that is deliberate — but a
       press on it must not take focus off the trap either (`useFocusTrap`). */
    <div style={s.overlay} onMouseDown={onScrimMouseDown}>
      {/* `aria-labelledby` and not `aria-label`: the window's accessible name is
          the task's own title, which is the string on screen, and it names the
          task rather than the kind of element (AC-71). `tabIndex={-1}` is what
          lets the trap move focus onto the window itself on open. */}
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        style={s.dialog}
      >
        <div style={s.header}>
          <div style={s.headerText}>
            <h2 id={titleId} style={s.title}>
              {task.title}
            </h2>
            <FileRef path={task.path} repoFullName={repoFullName} indexSha={indexSha} />
            <ComplexityBadge complexity={task.complexity} />
          </div>
          <IconBtn icon="X" label={t("task.close")} onClick={onClose} />
        </div>

        <div style={s.body}>
          {task.why !== "" && (
            <Block label={t("task.why")}>
              <p style={s.prose}>{task.why}</p>
            </Block>
          )}

          {task.steps.length > 0 && (
            <Block label={t("task.steps")}>
              <ol style={s.steps}>
                {task.steps.map((step, i) => (
                  <li key={i} style={s.step}>
                    <div style={s.stepTop}>
                      <span className="mono" style={s.stepIndex}>
                        {i + 1}
                      </span>
                      <span style={s.stepText}>{step.text}</span>
                    </div>
                    {step.path !== null && (
                      <div style={s.stepDetail}>
                        <FileRef
                          path={step.path}
                          repoFullName={repoFullName}
                          indexSha={indexSha}
                        />
                      </div>
                    )}
                    {step.command !== null && (
                      <div style={s.stepDetail}>
                        <CommandRow command={step.command} />
                      </div>
                    )}
                  </li>
                ))}
              </ol>
            </Block>
          )}

          {task.impact !== "" && (
            <Block label={t("task.impact")}>
              <p style={s.prose}>{task.impact}</p>
            </Block>
          )}

          {task.verification !== "" && (
            <Block label={t("task.verification")}>
              <p style={s.prose}>{task.verification}</p>
            </Block>
          )}
        </div>
      </div>
    </div>
  );
}

/** One labelled block of the window. Rendered only by a caller that already
    knows it has something to put in it. */
function Block({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={s.block}>
      <SectionLabel>{label}</SectionLabel>
      {children}
    </div>
  );
}
