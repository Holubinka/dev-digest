import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunSummary } from '../src/api/schemas.js';
import {
  FAST_POLL_MS,
  PROGRESS_EVERY_MS,
  SLOW_POLL_MS,
  isTerminal,
  waitForRun,
  type ProgressUpdate,
} from '../src/wait.js';
import { makeProgressReporter, type ProgressFrame } from '../src/tools/run-agent.js';
import { DEFAULT_RUN_TIMEOUT_MS } from '../src/config.js';

const RUN_ID = 'run-1';

const run = (over: Partial<RunSummary> = {}): RunSummary => ({
  run_id: RUN_ID,
  agent_id: 'a1',
  agent_name: 'Security Reviewer',
  status: 'running',
  error: null,
  ran_at: '2026-08-08T10:00:00.000Z',
  ...over,
});

/** Answers with the given statuses in order, repeating the last one forever. */
function poller(statuses: (string | null)[]) {
  const seen: number[] = [];
  let calls = 0;
  const poll = async (): Promise<RunSummary | undefined> => {
    const status = statuses[Math.min(calls, statuses.length - 1)] ?? null;
    calls += 1;
    seen.push(Date.now());
    return run({ status });
  };
  return { poll, at: seen, get calls() { return calls; } };
}

describe('isTerminal', () => {
  it('is true for done, failed and cancelled', () => {
    expect(['done', 'failed', 'cancelled'].map(isTerminal)).toEqual([true, true, true]);
  });

  it('keeps waiting on a status it does not recognise, and on null', () => {
    // A run this server cannot classify is still billing. Guessing "finished"
    // would return an empty answer for a review that is about to produce one.
    expect(isTerminal('queued')).toBe(false);
    expect(isTerminal('some-future-status')).toBe(false);
    expect(isTerminal(null)).toBe(false);
    expect(isTerminal(undefined)).toBe(false);
  });
});

describe('waitForRun', () => {
  beforeEach(() => {
    // From 0, so a recorded `Date.now()` reads as "ms since the wait started"
    // rather than an epoch timestamp.
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns as soon as the status transitions to done', async () => {
    const p = poller(['running', 'running', 'done']);
    const promise = waitForRun({ runId: RUN_ID, poll: p.poll, ceilingMs: DEFAULT_RUN_TIMEOUT_MS });
    await vi.advanceTimersByTimeAsync(60_000);

    const result = await promise;
    expect(result.outcome).toBe('finished');
    expect(result.run?.status).toBe('done');
    // Two 2s sleeps: it did not wait out the ceiling once the run landed.
    expect(result.elapsedMs).toBe(2 * FAST_POLL_MS);
    expect(p.calls).toBe(3);
  });

  it('polls every 2s for the first 30s and every 5s after that', async () => {
    const p = poller(['running']);
    const promise = waitForRun({ runId: RUN_ID, poll: p.poll, ceilingMs: 60_000 });
    await vi.advanceTimersByTimeAsync(60_000);
    await promise;

    const early = p.at.filter((t) => t < 30_000);
    const late = p.at.filter((t) => t >= 30_000);
    expect(early).toEqual(
      Array.from({ length: 30_000 / FAST_POLL_MS }, (_, i) => i * FAST_POLL_MS),
    );
    expect(late[1]! - late[0]!).toBe(SLOW_POLL_MS);
  });

  it('returns still-running at the ceiling, exactly on it, without cancelling anything', async () => {
    const p = poller(['running']);
    const promise = waitForRun({ runId: RUN_ID, poll: p.poll, ceilingMs: DEFAULT_RUN_TIMEOUT_MS });
    await vi.advanceTimersByTimeAsync(DEFAULT_RUN_TIMEOUT_MS + 30_000);

    const result = await promise;
    expect(result.outcome).toBe('ceiling');
    // Exactly on the ceiling: the last sleep is clamped to the time left, so the
    // tool returns before any client-side per-call timeout that sits just above.
    expect(result.elapsedMs).toBe(DEFAULT_RUN_TIMEOUT_MS);
    expect(result.run?.status).toBe('running');
  });

  it('lands ON a ceiling that does not fall on the poll grid', async () => {
    // 121s is not a multiple of the 5s poll, so an unclamped last sleep would
    // overshoot to 125s — past whatever per-call timeout the ceiling sits under.
    const p = poller(['running']);
    const promise = waitForRun({ runId: RUN_ID, poll: p.poll, ceilingMs: 121_000 });
    await vi.advanceTimersByTimeAsync(200_000);

    const result = await promise;
    expect(result.outcome).toBe('ceiling');
    expect(result.elapsedMs).toBe(121_000);
  });

  it('reports progress at least every 20s, and immediately on a status change', async () => {
    const updates: ProgressUpdate[] = [];
    const p = poller(['running']);
    const promise = waitForRun({
      runId: RUN_ID,
      poll: p.poll,
      ceilingMs: DEFAULT_RUN_TIMEOUT_MS,
      onProgress: (u) => {
        updates.push(u);
      },
    });
    await vi.advanceTimersByTimeAsync(DEFAULT_RUN_TIMEOUT_MS);
    await promise;

    expect(updates[0]).toMatchObject({ elapsedMs: 0, statusChanged: true, run_id: RUN_ID });
    const gaps = updates.slice(1).map((u, i) => u.elapsedMs - updates[i]!.elapsedMs);
    expect(Math.max(...gaps)).toBeLessThanOrEqual(PROGRESS_EVERY_MS);
    // The stdio idle timeout is 30 minutes; a 120s call must never be silent.
    expect(updates.length).toBeGreaterThanOrEqual(DEFAULT_RUN_TIMEOUT_MS / PROGRESS_EVERY_MS);
  });

  it('reports a status change even when it lands between the 20s beats', async () => {
    const updates: ProgressUpdate[] = [];
    // queued for two polls, then running.
    const p = poller(['queued', 'queued', 'running']);
    const promise = waitForRun({
      runId: RUN_ID,
      poll: p.poll,
      ceilingMs: 20_000,
      onProgress: (u) => {
        updates.push(u);
      },
    });
    await vi.advanceTimersByTimeAsync(20_000);
    await promise;

    const changes = updates.filter((u) => u.statusChanged);
    expect(changes.map((u) => u.status)).toEqual(['queued', 'running']);
    expect(changes[1]!.elapsedMs).toBe(2 * FAST_POLL_MS);
  });

  it('still reports progress while the run row is not visible yet', async () => {
    const updates: ProgressUpdate[] = [];
    let calls = 0;
    const promise = waitForRun({
      runId: RUN_ID,
      poll: async () => {
        calls += 1;
        return calls > 3 ? run({ status: 'done' }) : undefined;
      },
      ceilingMs: 60_000,
      onProgress: (u) => {
        updates.push(u);
      },
    });
    await vi.advanceTimersByTimeAsync(60_000);

    expect((await promise).outcome).toBe('finished');
    expect(updates[0]).toMatchObject({ run_id: RUN_ID, status: null, elapsedMs: 0 });
  });
});

describe('makeProgressReporter', () => {
  it('is undefined when the client sent no progressToken', () => {
    // Nothing may be sent for a request that did not ask: the notification would
    // name a token the client never issued.
    expect(makeProgressReporter(undefined, () => {})).toBeUndefined();
  });

  it('sends elapsed and ceiling seconds under the token the client issued', async () => {
    const frames: ProgressFrame[] = [];
    const report = makeProgressReporter('tok-9', (f) => {
      frames.push(f);
    });
    await report?.({
      run_id: RUN_ID,
      status: 'running',
      elapsedMs: 45_400,
      statusChanged: false,
      ceilingMs: DEFAULT_RUN_TIMEOUT_MS,
    });

    expect(frames).toEqual([
      { progressToken: 'tok-9', progress: 45, total: 120, message: 'running — 45s elapsed' },
    ]);
  });
});
