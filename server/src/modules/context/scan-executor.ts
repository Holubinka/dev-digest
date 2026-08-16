import type { ContextContainer, ContextRepo, ScannedDoc } from './types.js';
import { contentHash, kindForRoot, renderDoc, rootFor, truncateCodePoints } from './helpers.js';
import { resolveContextSettings } from './settings.js';
import {
  DOC_EXTENSIONS,
  MAX_DOC_BYTES,
  MAX_DOC_CHARS,
  MAX_DOC_FILE_BYTES,
  MAX_SCAN_CANDIDATES,
} from './constants.js';

/**
 * The background document scan.
 *
 * Named `*-executor` so the architecture rules that bind a service bind it too —
 * `no-fs-in-service` above all: the clone is reached through `GitClient` and
 * never through `node:fs`.
 *
 * It runs under `JobRunner`'s existing settings — concurrency 3, a 120 s
 * timeout, 2 retries — which are already the numbers this feature's
 * non-functional requirements ask for, so no new runner is introduced.
 */
export class ContextScanExecutor {
  constructor(
    private container: ContextContainer,
    private repo: ContextRepo,
  ) {}

  /**
   * Scan one repo's clone and replace its persisted document set.
   *
   * On ANY throw the failure columns are written and the error is re-thrown, so
   * `JobRunner` records the job failed and retries it. The rows and `scanned_at`
   * from the last success are left untouched — that untouched-ness is the
   * requirement, and it is why the failure path writes different columns rather
   * than a status.
   */
  async run(input: { workspaceId: string; repoId: string }): Promise<void> {
    const { workspaceId, repoId } = input;
    const { roots } = await resolveContextSettings(this.container, workspaceId);
    try {
      const repo = await this.repo.repoById(workspaceId, repoId);
      if (!repo) throw new Error(`repo ${repoId} is not in workspace ${workspaceId}`);
      if (!repo.clonePath) {
        // No clone yet. Not a failure: the page reports `no_clone` and offers a
        // retry, and writing an error here would show a red state for something
        // nobody did wrong.
        await this.repo.replaceDocs(workspaceId, repoId, [], { roots, bounded: false });
        return;
      }

      const ref = { owner: repo.owner, name: repo.name };
      const { files, bounded } = await this.container.git.listFiles(ref, {
        roots,
        extensions: [...DOC_EXTENSIONS],
        maxFiles: MAX_SCAN_CANDIDATES,
        maxFileBytes: MAX_DOC_FILE_BYTES,
      });

      const docs: ScannedDoc[] = [];
      for (const file of files) {
        const root = rootFor(file.path, roots);
        // A file the walk produced but no configured root claims cannot happen
        // today; if it ever does, counting it under a root nobody configured is
        // worse than leaving it out.
        if (root === undefined) continue;
        let text: string;
        try {
          text = await this.container.git.readFile(ref, file.path, MAX_DOC_BYTES);
        } catch {
          // One unreadable file does not fail a scan of two thousand. It simply
          // does not appear, and the next scan will pick it up if it comes back.
          continue;
        }
        const body = truncateCodePoints(text, MAX_DOC_CHARS);
        docs.push({
          path: file.path,
          root,
          // The PATH as well as the root: under `.devdigest` the folder below it
          // is what names the family, and the root alone cannot see it.
          kind: kindForRoot(root, file.path),
          sizeBytes: file.size_bytes,
          // Counted over the SAME rendered string the run assembles, by the SAME
          // counter it measures the budget with. That is the whole of why the
          // editor's number and the run's number agree for an unchanged clone.
          tokens: this.container.tokenizer.count(renderDoc(file.path, body)),
          modifiedAt: parseDate(file.modified_at),
          // Hashed over the SAME truncated string a save writes, which is what
          // makes the comparison against `repo_doc_edits.content_hash` mean
          // "the disk no longer holds what DevDigest saved" rather than "the two
          // sides measured different things".
          contentHash: contentHash(body),
        });
      }

      await this.repo.replaceDocs(workspaceId, repoId, docs, { roots, bounded });
    } catch (err) {
      await this.repo
        .recordScanFailure(repoId, roots, (err as Error).message)
        .catch(() => undefined);
      throw err;
    }
  }
}

function parseDate(iso: string): Date | null {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}
