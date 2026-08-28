/* hooks/multi-agent.ts — the six routes of SPEC-05 Multi-Agent Review, plus the
   one live-event subscription the results columns stream through.

   Every read here is a React Query hook because no component in this app calls
   `fetch` (`client/AGENTS.md`). What is deliberate and easy to undo is BELOW, on
   `useMultiAgentRun`: it has no `refetchInterval`, and it must not grow one. */
"use client";

import React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { openRunEventSource } from "../run-event-source";
import { RunEvent } from "@devdigest/shared";
import type {
  LastSuccessfulRun,
  MultiAgentRun,
  MultiAgentRunCreated,
  MultiAgentRunRef,
} from "@devdigest/shared";

/** Query key of the "which multi-run does this PR point at" read (R54). */
export const prMultiAgentKey = (prId: string | null | undefined) => ["pr-multi-agent", prId];

// ---- Starting a multi-run --------------------------------------------------

export interface CreateMultiAgentRunInput {
  prId: string;
  agentIds: string[];
}

/** POST /pulls/:prId/multi-agent-run — the chosen SET, in one request (AC-24). */
export function useCreateMultiAgentRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ prId, agentIds }: CreateMultiAgentRunInput) =>
      api.post<MultiAgentRunCreated>(`/pulls/${prId}/multi-agent-run`, { agentIds }),
    // The PR page reads its link from the server (R54), and that read happened
    // before this run existed. Without this the page would keep answering with
    // the PREVIOUS comparison until something else refetched it.
    onSuccess: (_created, { prId }) => {
      qc.invalidateQueries({ queryKey: prMultiAgentKey(prId) });
    },
  });
}

export interface RerunMultiAgentRunInput {
  multiRunId: string;
  /** The PR the stored set belongs to; `null` while the multi-run read is in
   *  flight, in which case there is no link on any PR page to refresh yet. */
  prId: string | null;
}

/**
 * POST /multi-agent-runs/:id/rerun — the same agent set on the same PR, as a NEW
 * multi-run (AC-114…AC-116). The set is resolved server-side from the stored
 * one, which is why this route takes no body: a client-named set is governed by
 * AC-28 and would have to refuse the whole request over one deleted agent.
 *
 * `prId` is carried only to invalidate the PR page's link, for the same reason
 * `useCreateMultiAgentRun` does: a rerun makes a NEW multi-run for that PR, and
 * a page that already read `prMultiAgentKey` would keep pointing at the one this
 * rerun replaced. The rerun navigates away from the results page, so the stale
 * answer is exactly what the reader meets on coming back.
 */
export function useRerunMultiAgentRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ multiRunId }: RerunMultiAgentRunInput) =>
      api.post<MultiAgentRunCreated>(`/multi-agent-runs/${multiRunId}/rerun`),
    onSuccess: (_created, { prId }) => {
      if (prId) qc.invalidateQueries({ queryKey: prMultiAgentKey(prId) });
    },
  });
}

// ---- Reading one multi-run -------------------------------------------------

/**
 * GET /multi-agent-runs/:id — everything both view modes and the finding detail
 * draw (AC-98).
 *
 * **No `refetchInterval`, on purpose.** `SPEC-05 § Non-functional requirements`
 * caps this page at the open plus at most one recompute per run that reached a
 * terminal state — 11 requests at a ceiling of 10 agents. The terminal signal
 * already arrives on the event stream, so `useMultiRunColumnEvents`' `onRunClosed`
 * is what calls `refetch()`. Copying the `usePrRuns` shape (a 4-second poll)
 * would be ~24 refetches over the 1 min 35 s a real multi-run takes.
 */
export function useMultiAgentRun(multiRunId: string | null | undefined) {
  return useQuery({
    queryKey: ["multi-agent-run", multiRunId],
    queryFn: () => api.get<MultiAgentRun>(`/multi-agent-runs/${multiRunId}`),
    enabled: !!multiRunId,
  });
}

/** GET /repos/:repoId/multi-agent-runs/latest — `null` when the repo has none (AC-94). */
export function useLatestMultiAgentRun(repoId: string | null | undefined) {
  return useQuery({
    queryKey: ["repo-multi-agent-latest", repoId],
    queryFn: () => api.get<MultiAgentRunRef | null>(`/repos/${repoId}/multi-agent-runs/latest`),
    enabled: !!repoId,
  });
}

/**
 * GET /pulls/:prId/multi-agent — the multi-run this PR was last compared in, or
 * `null`.
 *
 * This is the whole of R54: an id kept only in page state dies on reload, so a
 * visit to the same PR tomorrow would show no way back to a comparison that
 * exists. `MultiAgentRunRef` and not `MultiAgentRun` because the page draws one
 * anchor from it — the full shape would pull every finding to render a link.
 *
 * `when` is what keeps this off a PR page load that will never draw the anchor.
 * The row is cheap and the request is not serial — it goes out beside the other
 * reads keyed on `prId`, not before them — but it is one more connection on a
 * page that already opens an SSE stream per in-flight run against an origin a
 * browser gives six of them (`MAX_LIVE_COLUMN_STREAMS` below is the same budget,
 * spent from the other end). Most PR page loads land on a tab with nowhere to
 * put the link, and its answer is not needed until the reader asks for the tab
 * that has.
 */
export function useLatestMultiAgentRunForPull(prId: string | null | undefined, when = true) {
  return useQuery({
    queryKey: prMultiAgentKey(prId),
    queryFn: () => api.get<MultiAgentRunRef | null>(`/pulls/${prId}/multi-agent`),
    enabled: !!prId && when,
  });
}

/** GET /runs/last-successful — one row per agent that has one, for the estimate (AC-17…AC-23). */
export function useLastSuccessfulRuns() {
  return useQuery({
    queryKey: ["runs-last-successful"],
    queryFn: () => api.get<LastSuccessfulRun[]>("/runs/last-successful"),
  });
}

// ---- Live column state -----------------------------------------------------

/** What one column knows from its own stream: the last line, whether the run has
 *  been seen to START, and whether the stream ended. */
export interface ColumnStreamState {
  lastMsg: string | null;
  /**
   * The run announced that it holds a slot and is `running` (AC-78).
   *
   * NOT "an event arrived". The diff and the intent are published to EVERY run
   * of a multi-run at once, while every one of those rows is still `queued`
   * (`server/src/platform/run-logger.ts:50`), so a first message proves only
   * that the batch has begun. The server emits exactly one event carrying
   * `data.status`, and it does so after the claim that promoted THIS row
   * (`run-executor.ts`, right after `startAgentRun` returns true) — which is why
   * this flag is set from that field and never from the arrival of a line.
   */
  started: boolean;
  closed: boolean;
}

/** `data.status` of a run event, when it carries one. Hand-checked rather than
 *  parsed: `RunEvent.data` is `unknown` by contract, and this reads one field of
 *  it. Anything else on the wire leaves `started` alone. */
function announcesStart(data: unknown): boolean {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { status?: unknown }).status === "running"
  );
}

/**
 * How many column streams may be open at once (AC-145, D27).
 *
 * A browser gives ONE ORIGIN six HTTP/1.1 connections, and every request this
 * page makes goes to the API: the columns' streams, the ordinary reads, and the
 * trace drawer's own live log. At a ceiling of ten agents, one stream per run
 * meant columns 7-10 never connected at all — and, because they never connected,
 * their streams never closed, so the page never refetched after they finished.
 *
 * Four leaves 4 + 1 for the drawer (AC-150) + 1 spare. Six was rejected: it
 * leaves nothing for either.
 */
export const MAX_LIVE_COLUMN_STREAMS = 4;

/**
 * `EventSource` for the runs of a multi-run that are still going, attributed by
 * `RunEvent.runId`, at most `MAX_LIVE_COLUMN_STREAMS` at a time.
 *
 * A NEW hook beside `useRunEvents` rather than a change to it: the trace drawer
 * and `RunStatus` both stream through that one, and AC-81 forbids this feature
 * from changing what the PR page does. The two differences that matter here are
 * per-run attribution (`useRunEvents` accumulates every run into one list) and
 * `onRunClosed`, which fires exactly once per run as its stream ends and is the
 * only thing that refetches the multi-run (AC-134).
 *
 * PASS THE NON-TERMINAL RUNS ONLY. A finished run has nothing left to say, and a
 * stream for one closes the instant it opens — which would spend a slot and fire
 * a pointless refetch on every visit to an old comparison.
 *
 * A run WAITING for a slot is not a run in an unknown state: its column reads its
 * status, its duration and its cost from the multi-run itself, exactly like every
 * other column, so the difference between "not listening yet" and "doing nothing"
 * is invisible on screen (AC-148). The only thing a stream adds is the live line.
 *
 * A queued run gets a stream too — `failAll` and `runOneAgent` both end with
 * `runBus.complete(runId)`, so a run that never starts still closes and still
 * reports its terminal state exactly once.
 */
export function useMultiRunColumnEvents(
  runIds: string[],
  onRunClosed?: (runId: string) => void,
): Record<string, ColumnStreamState> {
  const [byRun, setByRun] = React.useState<Record<string, ColumnStreamState>>({});
  const key = runIds.join(",");

  // The callback is read through a ref so that a caller passing an inline arrow
  // does not tear down and rebuild every subscription on each render — which
  // would re-fire `onRunClosed` for runs that had already ended.
  const closedCb = React.useRef(onRunClosed);
  React.useEffect(() => {
    closedCb.current = onRunClosed;
  }, [onRunClosed]);

  /* THE SOCKETS OUTLIVE THE EFFECT, and that is the point of holding them in a
     ref. `runIds` shrinks every time a run reaches a terminal state, so an effect
     that closed everything on cleanup would tear down and reconnect the three
     streams that are still running each time a fourth one ends — losing their
     live lines and burning connections on a page whose whole problem is that it
     has too few. The effect below RECONCILES instead: close what is no longer
     wanted, open what is wanted and has no socket, up to the ceiling.

     `ended` is what stops a slot being refilled with the run that just vacated
     it: its terminal state is not in `runIds` until the refetch lands, and
     without this the freed slot would go straight back to the same finished run. */
  const sourcesRef = React.useRef(new Map<string, EventSource>());
  const endedRef = React.useRef(new Set<string>());
  const wantedRef = React.useRef<string[]>([]);

  React.useEffect(() => {
    const sources = sourcesRef.current;
    const ended = endedRef.current;
    wantedRef.current = key ? key.split(",") : [];

    const open = (runId: string) => {
      setByRun((prev) => ({ ...prev, [runId]: { lastMsg: null, started: false, closed: false } }));

      const onMsg = (ev: MessageEvent) => {
        try {
          // Parsed against the contract, not asserted into it: `msg` reaches a
          // column header and `runId` decides which column that is, so a frame
          // of another shape must be dropped at this boundary rather than
          // rendered. `data` stays `unknown` by contract — `announcesStart`
          // above is what reads one field of it.
          const parsed = RunEvent.parse(JSON.parse(ev.data));
          // The event says which run it belongs to; the socket it arrived on is
          // only a hint. They agree today, and attribution by the payload is
          // what keeps a shared bus from painting a line in the wrong column.
          const id = parsed.runId || runId;
          setByRun((prev) => ({
            ...prev,
            [id]: {
              lastMsg: parsed.msg,
              // Latches: the run does not stop being started because a later
              // line says nothing about state.
              started: (prev[id]?.started ?? false) || announcesStart(parsed.data),
              closed: prev[id]?.closed ?? false,
            },
          }));
        } catch {
          /* keepalive frames, dataless native errors and anything that is not a
             `RunEvent` are not events */
        }
      };
      const es = openRunEventSource(runId, onMsg);
      sources.set(runId, es);
      es.onerror = () => {
        es.close();
        if (sources.get(runId) === es) sources.delete(runId);
        if (!ended.has(runId)) {
          ended.add(runId);
          setByRun((prev) => ({
            ...prev,
            [runId]: {
              lastMsg: prev[runId]?.lastMsg ?? null,
              started: prev[runId]?.started ?? false,
              closed: true,
            },
          }));
          // AC-134/AC-149: the refetch this triggers is also how a run that
          // finished while nothing was listening gets noticed — its terminal
          // state arrives in the same read, no later than the moment a slot for
          // it comes free.
          closedCb.current?.(runId);
        }
        fill(); // AC-147: the slot this run just gave up goes to the next one.
      };
    };

    const fill = () => {
      for (const runId of wantedRef.current) {
        if (sources.size >= MAX_LIVE_COLUMN_STREAMS) return;
        if (sources.has(runId) || ended.has(runId)) continue;
        open(runId);
      }
    };

    const wanted = new Set(wantedRef.current);
    for (const [runId, es] of [...sources]) {
      if (wanted.has(runId)) continue;
      sources.delete(runId);
      es.close(); // AC-146 — and `close()` fires no `onerror`, so nothing re-reports.
    }
    setByRun((prev) =>
      Object.fromEntries(Object.entries(prev).filter(([runId]) => sources.has(runId))),
    );
    fill();
  }, [key]);

  // Unmount only. Deliberately NOT the cleanup of the effect above, which runs on
  // every change of `runIds` and would close the streams that reconciliation is
  // there to keep.
  React.useEffect(() => {
    const sources = sourcesRef.current;
    return () => {
      for (const es of sources.values()) es.close();
      sources.clear();
    };
  }, []);

  return byRun;
}
