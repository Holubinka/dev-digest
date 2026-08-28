import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RunnerBundle, RunnerBundleInfo } from '@devdigest/shared';
import { ConfigError } from '../../platform/errors.js';

/**
 * `RunnerBundle` over `agent-runner/dist/`.
 *
 * A port for the same reason `PromptTemplates` is one: the bytes come off the
 * filesystem and the service that needs them may not touch it. `no-fs-in-service`
 * only sees a DIRECT `node:fs` edge, so a generator reaching a loader module
 * would satisfy the rule and still break the layering — this adapter is the part
 * the rule cannot enforce.
 *
 * The path is resolved relative to THIS module, the way `platform/prompts.ts:20`
 * resolves `src/prompts`: four levels up is the repository root under `tsx`
 * (`server/src/adapters/runner-bundle`) and under a compiled build
 * (`server/dist/adapters/runner-bundle`) alike.
 *
 * Nothing is cached. `read()` is reached once per export — a rare, deliberate
 * user action — and a cache would serve the pre-rebuild version and SHA into
 * `.devdigest/runner.mjs`'s header comment (AC-22) for the life of the process.
 */

/** The build's own record, written next to the bundle by `scripts/build.mjs`. */
interface RunnerMeta {
  version?: unknown;
  sourceSha?: unknown;
}

const BUILD_COMMAND = 'cd agent-runner && npm run build';

const DEFAULT_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
  'agent-runner',
  'dist',
);

export class FileRunnerBundle implements RunnerBundle {
  constructor(private dir: string = DEFAULT_DIR) {}

  async read(): Promise<RunnerBundleInfo> {
    const contents = await this.readOrExplain('runner.mjs');
    const meta = this.parseMeta(await this.readOrExplain('runner.meta.json'));
    return {
      contents,
      version: typeof meta.version === 'string' ? meta.version : 'unknown',
      sourceSha: typeof meta.sourceSha === 'string' ? meta.sourceSha : 'unknown',
      // Measured here rather than read from the meta file: the number is what
      // the export step reports, and a stale `bytes` in a meta file that was
      // written by an earlier build would describe a different file.
      bytes: Buffer.byteLength(contents, 'utf8'),
    };
  }

  /**
   * `agent-runner/dist` is git-ignored, so a fresh clone has no bundle at all.
   * The error names the command rather than the missing path alone: without the
   * build there is nothing to export, and "ENOENT" does not say so.
   */
  private async readOrExplain(name: string): Promise<string> {
    try {
      return await readFile(join(this.dir, name), 'utf8');
    } catch {
      throw new ConfigError(
        `The CI runner bundle is not built — ${join(this.dir, name)} is missing. ` +
          `Run \`${BUILD_COMMAND}\`.`,
      );
    }
  }

  private parseMeta(text: string): RunnerMeta {
    try {
      return JSON.parse(text) as RunnerMeta;
    } catch {
      throw new ConfigError(
        `The CI runner bundle's runner.meta.json is not valid JSON. Run \`${BUILD_COMMAND}\`.`,
      );
    }
  }
}
