/**
 * A finding-derived eval case used to be a one-time snapshot: switching a
 * finding's decision after the case existed left the case's polarity stale
 * (accepted → must_find frozen forever, even after a later dismiss). Now
 * `actOnFinding` re-syncs it, best-effort, on every accept/dismiss — see
 * `EvalRepository.syncPolarityByFindingId` and `server/INSIGHTS.md`.
 *
 * Hermetic: `ReviewRepository` and the `EvalSync` port are both stubs.
 */
import { describe, it, expect, vi } from 'vitest';
import { actOnFinding, type EvalSync } from '../src/modules/reviews/findings.js';
import type { FindingRow, ReviewRepository, ReviewRow } from '../src/modules/reviews/repository.js';
import type { PullRow } from '../src/db/rows.js';

const WORKSPACE_ID = 'ws-1';
const FINDING_ID = 'finding-1';

function repoStub() {
  const finding = { id: FINDING_ID, acceptedAt: null, dismissedAt: null } as unknown as FindingRow;
  return {
    findingContext: vi.fn(async () => ({
      finding,
      review: {} as ReviewRow,
      pull: { workspaceId: WORKSPACE_ID } as unknown as PullRow,
    })),
    setFindingAccepted: vi.fn(async () => ({ ...finding, acceptedAt: new Date() }) as FindingRow),
    setFindingDismissed: vi.fn(async () => ({ ...finding, dismissedAt: new Date() }) as FindingRow),
  } as unknown as ReviewRepository;
}

function evalSyncSpy(): EvalSync & { calls: Array<['accepted' | 'dismissed']> } {
  const calls: Array<['accepted' | 'dismissed']> = [];
  return {
    calls,
    syncPolarityByFindingId: async (_ws, _id, decision) => {
      calls.push([decision]);
    },
  };
}

describe('actOnFinding re-syncs a finding-derived eval case on every decision', () => {
  it('calls syncPolarityByFindingId("accepted") on accept', async () => {
    const evalRepo = evalSyncSpy();
    await actOnFinding(repoStub(), evalRepo, WORKSPACE_ID, FINDING_ID, 'accept');
    expect(evalRepo.calls).toEqual([['accepted']]);
  });

  it('calls syncPolarityByFindingId("dismissed") on dismiss', async () => {
    const evalRepo = evalSyncSpy();
    await actOnFinding(repoStub(), evalRepo, WORKSPACE_ID, FINDING_ID, 'dismiss');
    expect(evalRepo.calls).toEqual([['dismissed']]);
  });

  it('re-deciding accept → dismiss → accept re-syncs every time, not just the first', async () => {
    const evalRepo = evalSyncSpy();
    const repo = repoStub();
    await actOnFinding(repo, evalRepo, WORKSPACE_ID, FINDING_ID, 'accept');
    await actOnFinding(repo, evalRepo, WORKSPACE_ID, FINDING_ID, 'dismiss');
    await actOnFinding(repo, evalRepo, WORKSPACE_ID, FINDING_ID, 'accept');
    expect(evalRepo.calls).toEqual([['accepted'], ['dismissed'], ['accepted']]);
  });

  it('a sync failure does not fail the accept/dismiss action itself', async () => {
    const evalRepo: EvalSync = {
      syncPolarityByFindingId: async () => {
        throw new Error('eval db unavailable');
      },
    };
    const result = await actOnFinding(repoStub(), evalRepo, WORKSPACE_ID, FINDING_ID, 'accept');
    expect(result.finding.accepted_at).not.toBeNull();
  });
});
