import { describe, it, expect, vi } from 'vitest';
import { JobRunner } from '../src/platform/jobs.js';
import type { Db } from '../src/db/client.js';

function fakeDb() {
  const updates: Array<Record<string, unknown>> = [];
  const db = {
    insert: () => ({ values: () => ({ returning: async () => [{ id: 'job-1' }] }) }),
    update: () => ({
      set: (v: Record<string, unknown>) => {
        updates.push(v);
        return { where: async () => undefined };
      },
    }),
  } as unknown as Db;
  return { db, updates };
}

describe('JobRunner', () => {
  it('records a failed job without raising an unhandledRejection when nobody awaits done', async () => {
    const { db, updates } = fakeDb();
    const runner = new JobRunner(db, { retries: 0 });
    runner.register('boom', async () => {
      throw new Error('clone failed');
    });

    await runner.enqueue('ws', 'boom', {});
    await runner.onIdle();

    expect(updates.some((u) => u.status === 'failed' && u.error === 'clone failed')).toBe(true);
  });

  it('still rejects `done` for a caller that awaits it', async () => {
    const { db } = fakeDb();
    const runner = new JobRunner(db, { retries: 0 });
    runner.register('boom', async () => {
      throw new Error('nope');
    });

    const { done } = await runner.enqueue('ws', 'boom', {});
    await expect(done).rejects.toThrow('nope');
  });

  it('applies the per-kind timeout instead of the runner default', async () => {
    vi.useFakeTimers();
    try {
      const { db, updates } = fakeDb();
      const runner = new JobRunner(db, { retries: 0, timeoutMs: 1_000 });
      runner.register('slow', () => new Promise<void>((r) => setTimeout(r, 5_000)), { timeoutMs: 10_000 });

      const { done } = await runner.enqueue('ws', 'slow', {});
      await vi.advanceTimersByTimeAsync(6_000);
      await done;

      expect(updates.some((u) => u.status === 'done')).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
