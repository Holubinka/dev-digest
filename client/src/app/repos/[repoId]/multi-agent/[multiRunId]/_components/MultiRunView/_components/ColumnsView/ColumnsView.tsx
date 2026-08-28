/* ColumnsView — one column per agent of the multi-run (AC-47…AC-53).

   THE STATE WORD IN THE HEADER COMES FROM `runStateKey`, the same function the
   disagreement section's `not_reviewed` caption calls. AC-125 requires the two
   to say the same word about the same run, and a second map here is the way
   that stops being true.

   THE LIVE LINE IS A LINE, NOT A STATE. The stream tells this column what its
   run is doing right now; the WORD stays the server's, because the section reads
   the same field and a header saying `done` beside a take saying `reviewing`
   would be a defect the reader can see. What the stream changes is the last
   message under the header — and, through `onRunClosed` upstream, when the page
   asks the server again.

   THE STATE IS A BADGE, AND THE BADGE IS THE INDICATOR. A bare word carried no
   weight — `queued` and `done` read alike — so the word now sits in the same
   chip the rest of the app puts a severity or a category in (`Badge`, from
   `vendor/ui`), coloured by `runStateTone`. The colour is a second reading of
   the state, never the only one: the word is always printed, which is the rule
   `SeverityBadge` states as "never color alone".

   NOTHING ANIMATES, and that is the point. An earlier pass put a pulsing dot
   beside the word and three pulsing dots where the live line would be; the human
   asked for something readable instead, on 2026-08-26. A badge is legible at a
   glance on ten columns at once, which a field of blinking dots is not — and it
   claims nothing about progress, which this page cannot know: there is a run
   state and, when a stream happens to be attached, the last event. No
   percentage, no stage.

   A COLUMN WITH NO STREAM IS STILL A COLUMN WITH A STATE. Only four streams are
   open at once (`MAX_LIVE_COLUMN_STREAMS`), so on a run of five or more agents
   some columns have no live line at all. They are not second-class: the badge is
   keyed on `c.status` — the same field every other column draws from — so a run
   only WAITING for a slot reads exactly like one being listened to (AC-148).
   What a stream adds is the message under the header, nothing else.

   The horizontal overflow is `.dd-multiagent-columns` in `globals.css` rather
   than an inline rule: the track sizing changes at a breakpoint, and an inline
   style beats a stylesheet rule whatever the selector (`client/AGENTS.md`). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, CircularScore, MonoLink } from "@devdigest/ui";
import type { AgentColumn } from "@devdigest/shared";
import type { ColumnStreamState } from "@/lib/hooks/multi-agent";
import { AgentMonogram } from "@/components/agent-monogram";
import { FindingSeverityBadge, severityColor } from "@/components/severity-badge";
import { NO_DATA } from "@/components/run-cost-badge";
import { agentColor } from "@/lib/agent-color";
import { lineLabel } from "@/lib/line-numbers";
import {
  agentKey,
  durationCostLabel,
  fileRefHref,
  isTerminal,
  runStateKey,
  runStateTone,
} from "../../helpers";
import { FileRef } from "../FileRef";
import { s } from "../../styles";

export function ColumnsView({
  columns,
  streams,
  repoFullName,
  headSha,
  onOpenTrace,
}: {
  columns: AgentColumn[];
  streams: Record<string, ColumnStreamState>;
  /** `owner/repo`, for the link into the code. Null until the repo list loads. */
  repoFullName: string | null;
  /** The multi-run's head, NOT the PR's — see `fileRefHref`. */
  headSha: string | null;
  onOpenTrace: (runId: string) => void;
}) {
  const t = useTranslations("runs");

  return (
    <div className="dd-page" style={s.columnsPage}>
      <div className="dd-multiagent-columns">
        {columns.map((c) => {
          // A deleted agent has no id to derive a colour from, and the snapshot
          // name is what the column still has (AC-118). Same fallback as the
          // takes, so one agent keeps one colour across both.
          const color = agentColor(agentKey(c));
          const live = streams[c.run_id];
          return (
            <div key={c.run_id} data-column-run={c.run_id} style={s.column(color)}>
              <div style={s.columnHead}>
                <AgentMonogram agentId={agentKey(c)} name={c.agent_name} />
                <div style={s.columnHeadMain}>
                  <div style={s.columnNameRow}>
                    <span style={s.columnName}>{c.agent_name}</span>
                    {c.agent_deleted && <span style={s.deletedTag}>{t("page.deleted")}</span>}
                  </div>
                  <div style={s.columnStateRow}>
                    <Badge {...runStateTone(c.status)}>{t(runStateKey(c.status))}</Badge>
                    <span className="mono tnum" style={s.columnMeta}>
                      {durationCostLabel(c.duration_ms, c.cost_usd)}
                    </span>
                  </div>
                  {/* AC-36: the reason belongs beside the column that failed. */}
                  {c.error && <div style={s.columnError}>{c.error}</div>}
                  {!isTerminal(c.status) && live?.lastMsg && (
                    <div style={s.columnLive}>{live.lastMsg}</div>
                  )}
                </div>
                {/* AC-49: no score is `—`, never a zero, which is a real score. */}
                {c.score != null ? (
                  <CircularScore score={c.score} size={32} stroke={3.5} />
                ) : (
                  <span style={s.noScore}>{NO_DATA}</span>
                )}
              </div>

              <div style={s.columnBody}>
                {c.findings.length === 0 ? (
                  <span style={s.columnEmpty}>{t("column.noFindings")}</span>
                ) : (
                  c.findings.map((f) => (
                    <div key={f.id} style={s.mini(severityColor(f.severity))}>
                      <div style={s.miniTitleRow}>
                        <FindingSeverityBadge severity={f.severity} compact />
                        <span style={s.miniTitle}>{f.title}</span>
                      </div>
                      {/* Opens the exact lines on github.com, the same move the
                          PR page's finding list makes. The path is still a
                          model-written string and still hostile: `fileRefHref`
                          is where that is dealt with, and it answers `undefined`
                          — leaving this plain text — whenever a safe link cannot
                          be built. */}
                      <div style={s.miniFileRow}>
                        <FileRef href={fileRefHref(repoFullName, headSha, f)} style={s.miniFile}>
                          {f.file}:{lineLabel(f)}
                        </FileRef>
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div style={s.columnFoot}>
                <MonoLink onClick={() => onOpenTrace(c.run_id)}>{t("viewTrace")}</MonoLink>
                <span style={s.columnCount}>
                  {t("column.findingsCount", { count: c.findings.length })}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
