import type { PromptTemplates } from '@devdigest/shared';
import { renderPrompt } from '../../platform/prompts.js';

/**
 * `PromptTemplates` over the `src/prompts/*.md` files.
 *
 * A one-line delegation, and the line is the point: `platform/prompts.ts` reads
 * `node:fs`, so a service calling it directly does filesystem I/O with no port
 * in between. `no-fs-in-service` does not catch that — it matches a direct
 * `node:fs` import from a `service.ts`, and an indirection through a loader
 * module satisfies the rule while breaking the layering it stands for.
 *
 * The loader keeps its own module-level cache, so this adapter holds no state.
 */
export class FilePromptTemplates implements PromptTemplates {
  render(name: string, vars: Record<string, string>): Promise<string> {
    return renderPrompt(name, vars);
  }
}
