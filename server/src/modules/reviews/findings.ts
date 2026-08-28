import type { FindingActionKind } from '@devdigest/shared';
import { AppError, NotFoundError } from '../../platform/errors.js';
import type { ReviewRepository } from './repository.js';
import { findingRowToDto, type ReviewDtoFinding } from './helpers.js';

/**
 * The narrowest shape this function needs from `container.evalRepo` — stated
 * structurally, not as the concrete `EvalRepository` class, because
 * `no-cross-module` forbids `modules/reviews` importing from `modules/eval`
 * (see `EvalContainer.reviewRepo` in `modules/eval/types.ts` for the mirror of
 * this in the opposite direction).
 */
export interface EvalSync {
  syncPolarityByFindingId(
    workspaceId: string,
    findingId: string,
    decision: 'accepted' | 'dismissed',
  ): Promise<void>;
}

/**
 * Finding actions available in the starter: accept / dismiss. These decisions
 * are the dataset later lessons build on (eval cases from accept/dismiss, the
 * `learn → memory` action, etc.).
 *
 * A decision can flip after a case was already built from this finding — the
 * Accept/Dismiss buttons stay clickable either way (they were never actually
 * disabled once decided; only their fade misleadingly suggested otherwise).
 * `evalRepo.syncPolarityByFindingId` re-derives that case's polarity to match
 * the new decision, best-effort: a sync failure must not fail the accept/
 * dismiss action itself, the same way `buildCallersDigest`'s enrichment
 * failures never fail a review.
 */
export async function actOnFinding(
  repo: ReviewRepository,
  evalRepo: EvalSync,
  workspaceId: string,
  findingId: string,
  action: FindingActionKind,
): Promise<{ finding: ReviewDtoFinding }> {
  const ctx = await repo.findingContext(findingId);
  if (!ctx || ctx.pull.workspaceId !== workspaceId) {
    throw new NotFoundError('Finding not found');
  }

  switch (action) {
    case 'accept': {
      const row = await repo.setFindingAccepted(findingId, new Date());
      await evalRepo.syncPolarityByFindingId(workspaceId, findingId, 'accepted').catch(() => undefined);
      return { finding: findingRowToDto(row!) };
    }
    case 'dismiss': {
      const row = await repo.setFindingDismissed(findingId, new Date());
      await evalRepo.syncPolarityByFindingId(workspaceId, findingId, 'dismissed').catch(() => undefined);
      return { finding: findingRowToDto(row!) };
    }
    default:
      throw new AppError('invalid_action', `Action '${action}' is not available in the starter`, 400);
  }
}
