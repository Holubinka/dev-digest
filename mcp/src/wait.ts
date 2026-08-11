/**
 * Waiting for a review run to land (spec 06 step 8).
 *
 * `POST /pulls/:id/review` is fire-and-forget: it creates the `agent_runs` rows
 * and returns immediately while the review executes in the background
 * (`server/src/modules/reviews/service.ts:134-142`). Waiting is entirely the
 * caller's job, and this is where it happens.
 *
 * Polling, not the SSE stream. `GET /pulls/:id/runs` reads `agent_runs` — the
 * durable source of truth, which carries `status` and `error` for a run that has
 * already finished — while the SSE bus is in-memory and process-local
 * (`server/src/platform/sse.ts:19-103`): restart the API mid-run and `onDone`
 * never fires, so the stream hangs until our own ceiling. A poll sees the boot
 * reaper flip that same row to `failed`.
 *
 * Pure control flow: the clock, the sleep and the poll all arrive as parameters,
 * so a test drives ten minutes of waiting without waiting.
 */

import type { RunSummary } from './api/schemas.js';

/** A run in one of these states will never change again. */
export const TERMINAL_STATUSES = ['done', 'failed', 'cancelled'] as const;

/**
 * Unknown and null statuses are NOT terminal on purpose: a status this server
 * does not recognise must keep the caller waiting until the ceiling, never end
 * the wait on a run that is still billing.
 */
export function isTerminal(status: string | null | undefined): boolean {
  return TERMINAL_STATUSES.includes(status as (typeof TERMINAL_STATUSES)[number]);
}

/** 2s for the first 30s, then 5s — a review's median is ~30s. */
export const FAST_POLL_MS = 2_000;
export const SLOW_POLL_MS = 5_000;
export const FAST_PHASE_MS = 30_000;

/**
 * The stdio idle timeout is 30 minutes and aborts a call that sends neither a
 * response nor a progress notification. 20s leaves a wide margin and still costs
 * at most 6 frames a minute.
 */
export const PROGRESS_EVERY_MS = 20_000;

export interface ProgressUpdate {
  run_id: string;
  status: string | null;
  elapsedMs: number;
  /** True for the first update and whenever the run's status changed. */
  statusChanged: boolean;
}

export interface WaitOptions {
  /** The run being waited on — known before the first poll, so progress can name it. */
  runId: string;
  /** Reads the run's current row. `undefined` = the run is not in the list (yet). */
  poll: () => Promise<RunSummary | undefined>;
  ceilingMs: number;
  /** Omitted when the client sent no `progressToken` — see `tools/run-agent.ts`. */
  onProgress?: (update: ProgressUpdate) => void | Promise<void>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  fastPollMs?: number;
  slowPollMs?: number;
  fastPhaseMs?: number;
  progressEveryMs?: number;
}

export type WaitResult =
  | { outcome: 'finished'; run: RunSummary; elapsedMs: number }
  | { outcome: 'ceiling'; run: RunSummary | undefined; elapsedMs: number };

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Poll until the run reaches a terminal status or the ceiling is hit.
 *
 * The ceiling is SOFT: hitting it neither cancels the run nor produces an error.
 * It exists because progress notifications prevent the idle abort but not the
 * per-server `timeout`, which is a hard wall-clock limit per tool call.
 *
 * The sleep is clamped to the time left, so the last poll lands ON the ceiling
 * rather than up to one interval past it.
 */
export async function waitForRun(options: WaitOptions): Promise<WaitResult> {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  const fastPollMs = options.fastPollMs ?? FAST_POLL_MS;
  const slowPollMs = options.slowPollMs ?? SLOW_POLL_MS;
  const fastPhaseMs = options.fastPhaseMs ?? FAST_PHASE_MS;
  const progressEveryMs = options.progressEveryMs ?? PROGRESS_EVERY_MS;

  const startedAt = now();
  let lastStatus: string | null | undefined;
  let firstPoll = true;
  let lastProgressElapsed = 0;

  for (;;) {
    const run = await options.poll();
    const elapsedMs = now() - startedAt;

    if (run && isTerminal(run.status)) {
      return { outcome: 'finished', run, elapsedMs };
    }

    // Progress fires even when the run row is not visible yet: a call that sends
    // nothing for 30 minutes is aborted by the transport, and "not visible yet"
    // is exactly the state where that would go unnoticed.
    const status = run?.status ?? null;
    const statusChanged = firstPoll || status !== lastStatus;
    if (options.onProgress && (statusChanged || elapsedMs - lastProgressElapsed >= progressEveryMs)) {
      lastProgressElapsed = elapsedMs;
      await options.onProgress({ run_id: options.runId, status, elapsedMs, statusChanged });
    }
    lastStatus = status;
    firstPoll = false;

    if (elapsedMs >= options.ceilingMs) {
      return { outcome: 'ceiling', run, elapsedMs };
    }

    const interval = elapsedMs < fastPhaseMs ? fastPollMs : slowPollMs;
    await sleep(Math.min(interval, options.ceilingMs - elapsedMs));
  }
}
