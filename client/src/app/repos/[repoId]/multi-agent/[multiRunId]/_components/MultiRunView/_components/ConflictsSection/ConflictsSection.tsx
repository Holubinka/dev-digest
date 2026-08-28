/* ConflictsSection — "Where agents disagree", in both view modes (AC-64).

   THREE VERDICTS, THREE RENDERINGS, BRANCHED EXPLICITLY. The mockup's prototype
   computes `flagged = t.verdict !== "ignored"` (`screen.jsx:35`), which answers
   `true` for `not_reviewed` and paints an agent whose run crashed as one that
   found something, at `var(--warn)`. That is the fifth named divergence in
   `SPEC-05 § П'ять розходжень з макетом`, and the reason there is no boolean
   here at all:

     a severity   the agent flagged it — its colour, the word, and the note
     `ignored`    it looked and passed — a grey ROUND marker, `did not flag`,
                  and no note, because no such text exists (D1)
     not_reviewed it was never there — a HOLLOW RING, different in shape and not
                  merely in shade (AC-121), no note at all (AC-122), and a
                  caption naming the run's state (AC-123)

   THE TAKE FINDS ITS COLUMN BY `run_id`, never by `agent_id`: two deleted agents
   both carry `agent_id: null`, and AC-125 needs an exact join to print the same
   word in the caption and in that run's column header.

   THE SECTION RENDERS FROM THE FIRST OPEN, mid-run included (D24). While any run
   is non-terminal it carries the not-final mark, and that mark sits ABOVE the
   list so it is on screen whether the list has positions or an empty text.

   ONE AGENT IS ITS OWN WHOLE SECTION, and it returns before any of the above
   (D25, AC-136…AC-138). Grouping keeps every component of a lone agent's finding
   — it has to, or AC-128 would lose it — so the list is not empty and the empty
   branch never fires: the text was reachable only when that agent found nothing.
   The human's answer is that with one agent the section IS the text, always:
   no positions, because a single opinion presented as a "position" implies a
   comparison that did not happen; no toggle, with nothing to filter; and no
   not-final mark, which would promise a comparison that will not arrive when the
   run ends either. The findings lose nothing — they are in that agent's column
   and in its tab, in full (AC-139). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { EmptyState, Icon, SectionLabel, Toggle } from "@devdigest/ui";
import type { AgentColumn, Conflict, ConflictTake } from "@devdigest/shared";
import { severityColor } from "@/components/severity-badge";
import { lineLabel } from "@/lib/line-numbers";
import {
  emptyReason,
  fileRefHref,
  isTerminal,
  runCounts,
  runStateKey,
  visiblePositions,
} from "../../helpers";
import { FileRef } from "../FileRef";
import { s } from "../../styles";

export function ConflictsSection({
  positions,
  columns,
  onlyConflicts,
  rerunPending,
  repoFullName,
  headSha,
  onToggle,
  onConfigure,
  onRunAgain,
}: {
  positions: Conflict[];
  columns: AgentColumn[];
  onlyConflicts: boolean;
  rerunPending: boolean;
  /** `owner/repo`, for the link into the code. Null until the repo list loads. */
  repoFullName: string | null;
  /** The multi-run's head, NOT the PR's — see `fileRefHref`. */
  headSha: string | null;
  onToggle: (on: boolean) => void;
  onConfigure: () => void;
  onRunAgain: () => void;
}) {
  const t = useTranslations("runs");

  // AC-136…AC-138. Before the toggle and before the not-final mark, because it
  // is the absence of both that makes the text true.
  if (columns.length === 1) {
    return (
      <div style={s.section}>
        <SectionLabel icon="Activity">{t("conflicts.title")}</SectionLabel>
        <EmptyState
          icon="Users"
          title={t("conflicts.empty.oneAgentTitle")}
          body={t("conflicts.empty.oneAgentBody")}
          cta={t("page.configureRun")}
          onCta={onConfigure}
        />
      </div>
    );
  }

  const counts = runCounts(columns);
  const shown = visiblePositions(positions, onlyConflicts);
  const notFinal = columns.some((c) => !isTerminal(c.status));
  const reason = emptyReason(counts, positions.length);

  return (
    <div style={s.section}>
      <SectionLabel
        icon="Activity"
        right={
          <label style={s.toggleRow}>
            {t("conflicts.onlyConflicts")}
            <Toggle on={onlyConflicts} onChange={onToggle} size={15} />
          </label>
        }
      >
        {t("conflicts.title")}
      </SectionLabel>

      {notFinal && (
        <div style={s.notFinal}>
          <Icon.Clock size={13} style={s.mutedIcon} />
          <span>{t("conflicts.notFinal")}</span>
        </div>
      )}

      {shown.length === 0 ? (
        <EmptySection
          reason={reason}
          counts={counts}
          rerunPending={rerunPending}
          onConfigure={onConfigure}
          onRunAgain={onRunAgain}
        />
      ) : (
        <div style={s.positions}>
          {shown.map((p) => (
            <div key={`${p.file}:${p.start_line}-${p.end_line}:${p.title}`} style={s.position}>
              <div style={s.positionHead}>
                <Icon.Code size={13} style={s.mutedIcon} />
                {/* The reference opens the disputed lines on github.com — the
                    same jump the finding cards make, so a reader can go from
                    "they disagree here" to the code in one click. `p.title` gets
                    no link: it is the model's prose, not a location. */}
                <FileRef href={fileRefHref(repoFullName, headSha, p)} style={s.positionFile}>
                  {p.file}:{lineLabel(p)}
                </FileRef>
                <span style={s.positionTitle}>{p.title}</span>
              </div>
              <div
                className="dd-take-grid"
                style={{ "--dd-takes": p.takes.length } as React.CSSProperties}
              >
                {p.takes.map((take) => (
                  <Take
                    key={take.run_id}
                    take={take}
                    column={columns.find((c) => c.run_id === take.run_id) ?? null}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* `data-take-run` is the run this cell speaks for — the same join key the take
   itself carries, and what lets a test scope an assertion to one agent's cell in
   a grid of otherwise unlabelled cells. */
function Take({ take, column }: { take: ConflictTake; column: AgentColumn | null }) {
  const t = useTranslations("runs");

  if (take.verdict === "not_reviewed") {
    return (
      <div data-take-run={take.run_id} style={s.take}>
        <div style={s.takePersona}>{take.persona}</div>
        <div style={s.takeMarkerRow}>
          <span style={s.markerRing} />
          {/* The run's own state, in the column header's word (AC-123, AC-125).
              With no column to join to there is no honest word, and none is
              printed — `did not flag` is never one of the options here (AC-124). */}
          {column && <span style={s.takeStateWord}>{t(runStateKey(column.status))}</span>}
        </div>
      </div>
    );
  }

  if (take.verdict === "ignored") {
    return (
      <div data-take-run={take.run_id} style={s.take}>
        <div style={s.takePersona}>{take.persona}</div>
        <div style={s.takeMarkerRow}>
          <span style={s.markerDot("var(--text-muted)")} />
          <span style={s.takeSilent}>{t("conflicts.didNotFlag")}</span>
        </div>
      </div>
    );
  }

  return (
    <div data-take-run={take.run_id} style={s.take}>
      <div style={s.takePersona}>{take.persona}</div>
      <div style={s.takeMarkerRow}>
        <span style={s.markerDot(severityColor(take.verdict))} />
        <span style={s.takeVerdict}>{take.verdict}</span>
      </div>
      {take.note && (
        <div className="dd-take-note" style={s.takeNote}>
          {take.note}
        </div>
      )}
    </div>
  );
}

function EmptySection({
  reason,
  counts,
  rerunPending,
  onConfigure,
  onRunAgain,
}: {
  reason: ReturnType<typeof emptyReason>;
  counts: ReturnType<typeof runCounts>;
  rerunPending: boolean;
  onConfigure: () => void;
  onRunAgain: () => void;
}) {
  const t = useTranslations("runs");

  // Reached only with NO columns at all — one agent is answered above, before any
  // position is drawn (D25). `emptyReason` still returns it for `agents <= 1`, so
  // a multi-run whose every run was deleted has a text rather than a blank box.
  if (reason === "one-agent") {
    return (
      <EmptyState
        icon="Users"
        title={t("conflicts.empty.oneAgentTitle")}
        body={t("conflicts.empty.oneAgentBody")}
        cta={t("page.configureRun")}
        onCta={onConfigure}
      />
    );
  }

  if (reason === "unfinished") {
    return (
      <EmptyState
        icon="Clock"
        title={t("conflicts.empty.unfinishedTitle")}
        /* The three numbers, and nothing about agreement or about different
           places — neither is true of runs that never finished (AC-130). */
        body={t("conflicts.empty.unfinishedBody", {
          done: counts.done,
          running: counts.running,
          unfinished: counts.never,
        })}
        /* AC-131: offer the re-run only once nothing is still going — while a
           run is live, the answer may still arrive on its own. */
        cta={counts.anyLive ? undefined : t("page.runAgain")}
        onCta={onRunAgain}
        ctaLoading={rerunPending}
      />
    );
  }

  if (reason === "nothing-found") {
    return (
      <EmptyState
        icon="Filter"
        title={t("conflicts.empty.nothingFoundTitle")}
        body={t("conflicts.empty.nothingFoundBody")}
      />
    );
  }

  // AC-112: this is a RESULT, not missing data — every agent that reviewed said
  // the same thing about every shared position.
  return (
    <EmptyState
      icon="CheckCircle"
      title={t("conflicts.empty.agreedTitle")}
      body={t("conflicts.empty.agreedBody")}
    />
  );
}
