/* FirstTasksSection — somewhere to start, one card per task, and the window one
   card opens.

   Nothing here creates, sends or registers anything (AC-36 SPEC-03). There is no
   "open an issue", no assignment and no checkbox: a task is a suggestion the
   model made about a file that exists, and the page's whole claim about it is
   that the file exists. The one control a card now carries opens a window over
   details that were already generated and saved — it asks the server for nothing
   and it costs no model call (AC-11).

   No tasks leaves the card and its own sentence, never a rendered `0`
   (AC-35 SPEC-03).

   EVERY TASK THE TOUR CARRIES IS DRAWN. The disclosure this section used to have
   is gone with `TASKS_SHOWN`: `MAX_TASKS` is 6 on the server, so the number
   stored is the number shown and there is nothing left to hide (AC-72). SPEC-03's
   AC-34 asked that tasks past the sixth sit behind one control CARRYING HOW MANY,
   never dropped silently; SPEC-04 D15 reverses it deliberately, and the guarantee
   is now met by there being no hidden task at all. A tour saved before this
   change may still hold twelve — all twelve are drawn, because hiding six with no
   way to say so is the one outcome both decisions refuse.

   THE OPEN TASK IS IN THE URL AND NOWHERE ELSE. It is shareable and it survives a
   reload, which is what D8 SPEC-03 already decided for the active section; it is
   derived during render from `?task=` and never copied into state, so the two can
   never disagree. Keyed on the task's PATH rather than its index: after a
   regeneration index 3 still exists and would open a different task in silence,
   while a path that is gone is observable — the tour draws with no window and no
   error (AC-57). Two tasks sharing a path are one link and the first wins.

   THIS SECTION DRAWS NO PROSE, and that is a decision rather than an omission.
   Every section carries a `body`, but measured against a live tour
   (`Holubinka/dev-digest`, 2026-08-18) the four non-architecture bodies restate
   the structured fields beside them — the same files, the same order, the same
   complexity words — so drawing both would print every list twice. Plan 14
   wires `TourProse` into `ArchitectureSection` and nowhere else, and this is
   why. Reported rather than resolved here: whether those bodies should be
   drawn at all is a question about the contract, not about this file. */
"use client";

import React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import type { OnboardingTask } from "@/lib/types";
import { SectionCard } from "../SectionCard";
import { FileRef } from "../FileRef";
import { ComplexityBadge } from "../ComplexityBadge";
import { TaskDetailDialog } from "../TaskDetailDialog";
import { s } from "./styles";

export function FirstTasksSection({
  tasks,
  repoFullName,
  indexSha,
}: {
  tasks: readonly OnboardingTask[];
  repoFullName: string | null | undefined;
  indexSha: string | null | undefined;
}) {
  const t = useTranslations("onboarding");
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();

  const openPath = search.get("task");
  const openTask = openPath === null ? undefined : tasks.find((task) => task.path === openPath);

  /* `replace`, never `push`: one history entry per opened task fills the back
     button with places nobody asked to go, which is the rule this page already
     states for the section fragment (`OnboardingTourView.tsx`). `scroll: false`
     keeps the reader where the card was.

     THE FRAGMENT IS CARRIED ACROSS BY HAND. The rail and `Share link` both live
     in `window.location.hash`, and a URL rebuilt from the pathname and the query
     alone drops it silently. It is read in the handler rather than during render
     because an event only ever runs on the client (`ShareLinkButton.tsx`). */
  const show = (taskPath: string | null) => {
    const params = new URLSearchParams(search.toString());
    if (taskPath === null) params.delete("task");
    else params.set("task", taskPath);
    const query = params.toString();
    router.replace(`${pathname}${query ? `?${query}` : ""}${window.location.hash}`, {
      scroll: false,
    });
  };

  return (
    <SectionCard kind="first_tasks">
      {tasks.length === 0 ? (
        <p style={s.empty}>{t("empty.first_tasks")}</p>
      ) : (
        <div style={s.grid}>
          {tasks.map((task, i) => (
            <TaskCard
              key={`${task.path}-${i}`}
              task={task}
              repoFullName={repoFullName}
              indexSha={indexSha}
              onOpen={task.steps.length > 0 ? () => show(task.path) : undefined}
            />
          ))}
        </div>
      )}
      {openTask && (
        <TaskDetailDialog
          task={openTask}
          repoFullName={repoFullName}
          indexSha={indexSha}
          onClose={() => show(null)}
        />
      )}
    </SectionCard>
  );
}

/**
 * One task, as the design draws it: title, path, badge.
 *
 * `onOpen` is absent for a task that carries no step, and the title is then the
 * plain heading it has always been — a card with nothing to show offers no
 * control to show it (AC-9). The control is the TITLE and never the card: the
 * card already contains `FileRef`'s link, and an interactive element inside a
 * button is invalid HTML that a keyboard reaches in two different ways.
 */
function TaskCard({
  task,
  repoFullName,
  indexSha,
  onOpen,
}: {
  task: OnboardingTask;
  repoFullName: string | null | undefined;
  indexSha: string | null | undefined;
  onOpen?: () => void;
}) {
  return (
    <div style={s.card}>
      <h3 style={s.title}>
        {onOpen ? (
          <button type="button" aria-haspopup="dialog" onClick={onOpen} style={s.titleButton}>
            {task.title}
          </button>
        ) : (
          task.title
        )}
      </h3>
      <FileRef path={task.path} repoFullName={repoFullName} indexSha={indexSha} />
      {/* `task.why` is NOT drawn on the card. The mockup's card is title, path
          and badge, and plan 14 · P2 · 9 lists the same three — the reason the
          model gave is a contract field this design does not show HERE. It is
          shown in the detail window, where AC-68's list is the requirement and
          there is no mockup to build past. */}
      <div style={s.badgeRow}>
        <ComplexityBadge complexity={task.complexity} />
      </div>
    </div>
  );
}
