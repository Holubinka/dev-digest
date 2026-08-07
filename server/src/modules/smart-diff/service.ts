import type { SmartDiff } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { NotFoundError } from '../../platform/errors.js';
import { SmartDiffRepository } from './repository.js';
import { buildSmartDiff, findingLinesByFile } from './helpers.js';

/**
 * Smart Diff: the reviewer-ordered view of a PR's changed files.
 *
 * Deterministic by construction — path patterns and line counts, nothing else.
 * This module must never reach `container.llm`: viewing a diff is not a reason
 * to spend money, and `test/smart-diff.it.test.ts` asserts that opening it
 * creates no `agent_runs` row.
 */
export class SmartDiffService {
  // Defaulted parameter, not constructed inside: the default keeps the call in
  // `routes.ts` a one-liner, while the seam lets a hermetic test drive `forPull`
  // — including the tenancy check — without a Postgres container.
  constructor(
    container: Container,
    private repo: SmartDiffRepository = new SmartDiffRepository(container.db),
  ) {}

  async forPull(workspaceId: string, prId: string): Promise<SmartDiff> {
    // Tenancy first. Reading `pr_files` by id alone would answer for another
    // workspace's PR, which is an IDOR and also leaks that the id exists.
    const found = await this.repo.findPullInWorkspace(workspaceId, prId);
    if (found === null) throw new NotFoundError('Pull request not found');

    const [files, findings] = await Promise.all([
      this.repo.filesForPull(prId),
      this.repo.findingRangesForPull(prId),
    ]);
    return buildSmartDiff(files, findingLinesByFile(findings));
  }
}
