import type { AgentColumn, AgentColumnStatus, Conflict, ConflictTake } from "@devdigest/shared";
import type { ColumnStreamState } from "@/lib/hooks/multi-agent";
import { githubBlobUrl } from "@/lib/github-urls";
import { formatCost, NO_DATA } from "@/components/run-cost-badge";
import { formatSeconds } from "@/components/run-trace-drawer/helpers";

export interface RunStateTone {
  color: string;
  bg: string;
}

/**
 * The i18n key AND the colour a run state is read in — the ONE place either
 * comes from.
 *
 * AC-125 requires the caption under a `not_reviewed` take and the header of
 * that run's column to name the state with the same word, and to read it in
 * the same colour. Two maps were two things that could drift; this is
 * literally one object, so both surfaces call `runStateKey`/`runStateTone` and
 * neither owns a string or a colour. Exhaustive over `AgentColumnStatus` on
 * purpose: adding a state to the contract should fail the build here rather
 * than render a raw enum value on screen.
 *
 * Foreground plus a 12%-alpha background, which is the pairing every other
 * badge in this app uses (`SEV` in `vendor/ui/primitives/tokens.ts`, and the
 * `--x` / `--x-bg` token pairs it draws from). Tokens rather than literals so
 * both themes follow; `--accent-bg` and friends are defined for light as well.
 *
 * FOUR READINGS, not five colours. `failed` is the one that went wrong, so it
 * takes `--crit`; `cancelled` ended without an opinion too but nothing broke, so
 * it takes `--warn` rather than borrowing the crash colour or the muted grey
 * that `queued` needs to keep — a run nobody stopped and a run that will never
 * run again must not look alike.
 *
 * The colour is never the only carrier: the badge always prints the word, which
 * is what keeps it legible to a reader who cannot separate the hues (the rule
 * `SeverityBadge` states as "never color alone").
 */
const RUN_STATE_META = {
  queued: { key: "runState.queued", tone: { color: "var(--text-muted)", bg: "var(--bg-hover)" } },
  running: { key: "runState.running", tone: { color: "var(--accent)", bg: "var(--accent-bg)" } },
  done: { key: "runState.done", tone: { color: "var(--ok)", bg: "var(--ok-bg)" } },
  failed: { key: "runState.failed", tone: { color: "var(--crit)", bg: "var(--crit-bg)" } },
  cancelled: { key: "runState.cancelled", tone: { color: "var(--warn)", bg: "var(--warn-bg)" } },
} as const satisfies Record<AgentColumnStatus, { key: string; tone: RunStateTone }>;

export function runStateKey(status: AgentColumnStatus): string {
  return RUN_STATE_META[status].key;
}

export function runStateTone(status: AgentColumnStatus): RunStateTone {
  return RUN_STATE_META[status].tone;
}

/**
 * github.com/blob link for a model-written `file:line`, or `undefined` when one
 * must not be built.
 *
 * THE SHA IS THE MULTI-RUN'S, NEVER THE PR'S. A finding was made against the
 * tree the agents actually read, and `multiRun.head_sha` carries exactly that.
 * `pr.head_sha` is where the branch is TODAY, so a link built from it opens the
 * right file at a line that may have moved — silently, with nothing on screen to
 * say so. AC-109 already guards the loud version of this trap for `Reply to
 * author`; this is the quiet one, and the reason both surfaces call this
 * function instead of reaching for whichever sha is in scope.
 *
 * NO SHA, NO LINK. An old multi-run from before the column existed has none, and
 * the honest fallback is the plain `file:line` text the page has always shown —
 * quietly substituting the PR's head would be the defect above, dressed as a
 * feature.
 *
 * The path itself stays hostile input and is treated as such by `githubBlobUrl`:
 * it refuses any `..` segment in the repo, the sha or the file, encodes every
 * segment, and takes the host from a constant, so a model cannot steer a reader
 * off github.com. What it cannot rule out is a path to a file that does not
 * exist — that is a 404, which is a broken link and not a way in. The human
 * lifted `SPEC-05 § Untrusted inputs`' no-link rule for this page on 2026-08-26
 * on exactly that reading.
 */
export function fileRefHref(
  repoFullName: string | null,
  headSha: string | null,
  ref: { file: string; start_line: number; end_line: number },
): string | undefined {
  if (!repoFullName || !headSha) return undefined;
  return githubBlobUrl(repoFullName, headSha, ref.file, ref.start_line, ref.end_line);
}

/** A run that will not change again. `queued` and `running` still can (AC-133),
 *  and it is also what decides which runs get a live stream (AC-145). */
export function isTerminal(status: AgentColumnStatus): boolean {
  return status === "done" || status === "failed" || status === "cancelled";
}

/**
 * The columns as they are RIGHT NOW: the multi-run read, with `queued` promoted
 * to `running` for any run whose own stream announced that it took a slot
 * (AC-78).
 *
 * THIS IS THE ONE PLACE THE PROMOTION HAPPENS, and that is the whole point.
 * `MultiRunView` calls it once and hands the SAME array to the columns, the
 * tabs, the disagreement section and the trace drawer, so AC-125's "the header
 * and the take say one word about one run" is true by construction rather than
 * by four call sites remembering to agree. Deriving it a second time anywhere
 * downstream is the bug this shape exists to prevent.
 *
 * WHY THE PAGE NEEDS IT AT ALL. The read has no `refetchInterval` (NFR) and the
 * only refetch fires when a stream CLOSES — a terminal transition. So nothing
 * asked the server again between "queued" and "done", and a run spent its whole
 * life labelled `queued` before jumping straight to `done`. This closes that
 * window with no request at all: the fact is already on a socket the page is
 * holding open.
 *
 * ONLY `queued → running`, and only upward. Every other state stays the
 * server's: a terminal state is authoritative and arrives through the refetch
 * that `onRunClosed` triggers, and nothing here may ever walk a run backwards.
 *
 * A RUN WITH NO STREAM IS LEFT ALONE (AC-148). Beyond `MAX_LIVE_COLUMN_STREAMS`
 * there is no socket and therefore no fact, so the column keeps the state the
 * multi-run read gave it — which is what every other column is showing too. It
 * is not upgraded on a guess, and it is not frozen either: each stream that
 * closes refetches the whole multi-run, and that read carries every column.
 *
 * Returns the ORIGINAL array when nothing is promoted, so a page holding four
 * quiet sockets does not hand its children a new array identity each render.
 */
export function liveColumns(
  columns: AgentColumn[],
  streams: Record<string, ColumnStreamState>,
): AgentColumn[] {
  let promoted = false;
  const next = columns.map((c) => {
    if (c.status !== "queued" || !streams[c.run_id]?.started) return c;
    promoted = true;
    return { ...c, status: "running" as const };
  });
  return promoted ? next : columns;
}

/**
 * Is this position a CONFLICT (AC-126)?
 *
 * A DISAGREEMENT ABOUT SEVERITY, and nothing else. One agent flags while the
 * other finished agents stay silent is AGREEMENT — the human's reading on
 * 2026-08-27 — so a position reaches the "Show only conflicts" toggle only when
 * two agents that both flagged it put different severities on it.
 *
 * THE OLDER RULE COUNTED flagged-versus-`ignored` AS WELL, and that did not make
 * the toggle stricter, it made it useless: run over nine real multi-runs on
 * 2026-08-27 it hid not one position. `buildConflicts` keeps every component
 * (`server/src/modules/reviews/conflicts.ts`), so nearly every position is one
 * flag beside a row of finished agents that said nothing — which under that rule
 * was a conflict every time.
 *
 * `not_reviewed` takes are dropped FIRST, before any question about agreement is
 * asked: an agent whose run never reached `done` counts neither for nor against
 * (D23, AC-119). AC-127 needs no guard of its own any more — two distinct
 * severities cannot come from fewer than two flagging agents.
 *
 * The three verdict values are branched on explicitly. The mockup's
 * `flagged = t.verdict !== "ignored"` (`screen.jsx:35`) is NOT ported: on
 * `not_reviewed` it answers `true`, which paints a crashed agent as one that
 * found something.
 */
export function isConflict(takes: ConflictTake[]): boolean {
  const reviewed = takes.filter((t) => t.verdict !== "not_reviewed");
  const flagged = reviewed.filter((t) => t.verdict !== "ignored");
  return new Set(flagged.map((t) => t.verdict)).size > 1;
}

/** The positions the section shows: every one, or only the conflicts (AC-75, AC-76). */
export function visiblePositions(positions: Conflict[], onlyConflicts: boolean): Conflict[] {
  return onlyConflicts ? positions.filter((p) => isConflict(p.takes)) : positions;
}

/**
 * How the multi-run's runs are doing, in the three numbers AC-129 puts on screen.
 *
 * `running` counts `queued` too: from the reader's side both mean "still going",
 * and the state each column shows separately is what tells them apart. `never`
 * is `failed` + `cancelled` — runs that ended without an opinion.
 */
export interface RunCounts {
  agents: number;
  done: number;
  running: number;
  never: number;
  anyLive: boolean;
}

export function runCounts(columns: AgentColumn[]): RunCounts {
  const done = columns.filter((c) => c.status === "done").length;
  const running = columns.filter((c) => c.status === "running" || c.status === "queued").length;
  return {
    agents: columns.length,
    done,
    running,
    never: columns.length - done - running,
    anyLive: running > 0,
  };
}

/**
 * WHY the disagreement section is empty — consulted only when the list the
 * toggle leaves is empty, and then in AC-132's order, first match wins.
 *
 * The order is the whole point and it is not alphabetical convenience: with one
 * agent that also crashed, both the first and the second condition hold, and
 * "there is nobody to compare with" is the truer of the two. "They found
 * nothing" may only be claimed once two runs actually reached `done` (AC-111) —
 * before that they found nothing because they never looked.
 *
 * `nothing-found` IS NO LONGER "they looked at different places". Since
 * `buildConflicts` keeps every component, one agent's lone finding is already a
 * position, so no positions at all with two runs at `done` means the finished
 * agents flagged nothing anywhere (2026-08-27).
 *
 * `one-agent` is no longer reached with ONE column: `ConflictsSection` answers
 * that case before it builds anything, because the text now shows whether or not
 * the lone agent found something (D25, AC-110). What is left here is the
 * degenerate `agents === 0` — every run of the multi-run deleted — which gets a
 * text instead of a blank box.
 */
export type EmptyReason = "one-agent" | "unfinished" | "nothing-found" | "agreed";

export function emptyReason(counts: RunCounts, positions: number): EmptyReason {
  if (counts.agents <= 1) return "one-agent";
  if (counts.done < 2) return "unfinished";
  if (positions === 0) return "nothing-found";
  return "agreed";
}

/** A deleted agent has no id to derive a colour or a monogram from, and the
 *  snapshot name is what the column still has (AC-118). Every caller that keys
 *  off an agent — colour, monogram, tab colour — falls back the same way, so
 *  one agent keeps one identity across every surface. */
export function agentKey(c: Pick<AgentColumn, "agent_id" | "agent_name">): string {
  return c.agent_id ?? c.agent_name;
}

/** The `duration · cost` reading every column, tab and header prints beside a
 *  run — `NO_DATA` for a duration that has not landed yet, `formatCost`'s own
 *  `NO_DATA` for a cost that has not. */
export function durationCostLabel(durationMs: number | null, costUsd: number | null): string {
  return `${durationMs != null ? formatSeconds(durationMs) : NO_DATA} · ${formatCost(costUsd)}`;
}
