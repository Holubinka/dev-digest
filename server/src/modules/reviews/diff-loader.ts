import type { Container } from '../../platform/container.js';
import type { UnifiedDiff } from '@devdigest/shared';
import { loadPrDiff, diffFromPrFiles } from '../_shared/pr-diff.js';
import type { ReviewRepository } from './repository.js';
import type { ReviewPull, ReviewRepo } from './types.js';

// The body moved to `_shared/pr-diff.ts` so `modules/eval` can cut a case's
// fragment from the same diff without a `no-cross-module` violation. Behaviour
// is unchanged and this signature is unchanged: `run-executor.ts` calls
// `loadDiff(container, repo, workspaceId, pull, repo)` and must keep compiling.
export { diffFromPrFiles };

/**
 * Load the unified diff for a PR. Prefers a real `git diff base...head`; falls
 * back to assembling a synthetic unified diff from the persisted pr_files
 * patches (so the reviewer works even before a clone completes / in tests).
 */
export async function loadDiff(
  container: Container,
  repo: ReviewRepository,
  workspaceId: string,
  pull: ReviewPull,
  repoRow: ReviewRepo,
): Promise<UnifiedDiff> {
  return loadPrDiff({ git: container.git, reviewRepo: repo }, pull, repoRow);
}
