import type { UnifiedDiff } from '@devdigest/shared';
import { parseUnifiedDiff } from '../../adapters/git/diff-parser.js';

/**
 * Loading a pull request's unified diff — the one way, for every slice.
 *
 * It lived inside `modules/reviews/diff-loader.ts` until the eval pipeline
 * needed the same diff to cut a case's fragment from. `no-cross-module` follows
 * `import type` too, so `modules/eval/**` importing it there would be a real
 * violation and a re-export barrel would only move the edge onto the barrel; the
 * shared thing has to leave the slice. `modules/reviews/diff-loader.ts` now
 * delegates here and keeps its own signature, so `run-executor.ts` is unchanged.
 */

/** The `pull_requests` columns loading a diff reads: the two refs, and the id. */
export interface PrDiffPull {
  id: string;
  /** The two refs git is asked for: `git diff base...headSha`. */
  base: string;
  headSha: string;
}

/** The `repos` columns loading a diff reads — only enough to name the clone. */
export interface PrDiffRepo {
  owner: string;
  name: string;
}

/** One persisted `pr_files` row, as the reconstruction reads it. */
export interface PrDiffFile {
  path: string;
  patch: string | null;
}

/**
 * What loading a diff needs from the composition root, stated STRUCTURALLY.
 *
 * `Container` is deliberately NOT imported, for the reason
 * `_shared/feature-models.ts` records about `SettingsReader`: the container
 * constructs the services that reach this file, so naming `Container` here
 * closes an import cycle `no-circular` rejects. A `Container` satisfies this
 * shape by construction.
 *
 * `reviewRepo` is named as the narrowest thing that answers the question — one
 * method — rather than as `ReviewRepository`, which would carry that class's
 * whole surface (and its slice) across the boundary. `modules/reviews` passes
 * its own instance; `modules/eval` passes `container.reviewRepo`.
 */
export interface PrDiffSource {
  readonly git: {
    diff(repo: PrDiffRepo, base: string, head: string): Promise<UnifiedDiff>;
  };
  readonly reviewRepo: {
    getPrFiles(prId: string): Promise<PrDiffFile[]>;
  };
}

/**
 * Load the unified diff for a PR. Prefers a real `git diff base...head`; falls
 * back to assembling a synthetic unified diff from the persisted pr_files
 * patches (so the reviewer works even before a clone completes / in tests).
 */
export async function loadPrDiff(
  source: PrDiffSource,
  pull: PrDiffPull,
  repoRow: PrDiffRepo,
): Promise<UnifiedDiff> {
  try {
    const diff = await source.git.diff(
      { owner: repoRow.owner, name: repoRow.name },
      pull.base,
      pull.headSha,
    );
    if (diff.files.length > 0) return diff;
  } catch {
    /* fall through to pr_files reconstruction */
  }
  return diffFromPrFiles(source.reviewRepo, pull.id);
}

/** Reconstruct a UnifiedDiff from persisted pr_files patches. */
export async function diffFromPrFiles(
  repo: PrDiffSource['reviewRepo'],
  prId: string,
): Promise<UnifiedDiff> {
  const files = await repo.getPrFiles(prId);
  const parts: string[] = [];
  for (const f of files) {
    if (!f.patch) continue;
    parts.push(`diff --git a/${f.path} b/${f.path}`);
    parts.push(`--- a/${f.path}`);
    parts.push(`+++ b/${f.path}`);
    parts.push(f.patch);
  }
  return parseUnifiedDiff(parts.join('\n'));
}
