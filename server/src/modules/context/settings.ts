import { SettingsKnown } from '@devdigest/shared';
import type { SettingsReader } from '../_shared/feature-models.js';
import { normalizeRoot } from './helpers.js';
import {
  DEFAULT_CONTEXT_BUDGET_TOKENS,
  DEFAULT_SCAN_ROOTS,
  DEVDIGEST_ROOT,
} from './constants.js';

/**
 * The two workspace settings this feature reads.
 *
 * They are typed keys in the existing `SettingsKnown` bag and round-trip through
 * `PUT /settings`, so there is no endpoint here — only the resolution of "never
 * set" to the spec's defaults, in ONE place, so the scan, the page and the
 * editor footer can never disagree about what a workspace is configured with.
 *
 * Read through `container.settingsRepo` rather than by importing
 * `modules/settings` (`no-cross-module`), the same route
 * `_shared/feature-models.ts` takes.
 */
export interface ContextSettings {
  roots: string[];
  budgetTokens: number;
}

/**
 * A stored value that fails its schema falls back to the default rather than
 * failing the request: these rows are hand-editable, and a malformed one should
 * degrade the feature to its documented defaults, not take a page down.
 *
 * `roots` are NORMALISED here and nowhere else. `PUT /settings` accepts
 * `z.array(z.string())` verbatim and the client's own scrub is not a defence, so
 * this is the single point at which `docs/`, `./docs` and `docs` become one
 * value — which is what lets the walk and the later `path === root` comparisons
 * agree. An entry that normalises to nothing, or that climbs out of the clone,
 * is dropped.
 */
export async function resolveContextSettings(
  container: SettingsReader,
  workspaceId: string,
): Promise<ContextSettings> {
  const [storedRoots, storedBudget] = await Promise.all([
    container.settingsRepo.value(workspaceId, 'context_scan_roots'),
    container.settingsRepo.value(workspaceId, 'context_token_budget'),
  ]);

  const parsedRoots = SettingsKnown.shape.context_scan_roots.safeParse(storedRoots);
  const roots =
    parsedRoots.success && storedRoots !== undefined && storedRoots !== null
      ? // De-duplicated AFTER normalising, because that is when `docs` and
        // `docs/` become visibly the same root — and a root walked twice would
        // offer the same file twice to a table with a unique index on it.
        [
          ...new Set(
            parsedRoots.data
              .map((raw) => normalizeRoot(raw.trim()))
              .filter((root): root is string => root !== null),
          ),
        ]
      : [];

  const parsedBudget = SettingsKnown.shape.context_token_budget.safeParse(storedBudget);

  return {
    roots: withDevdigest(roots.length > 0 ? roots : [...DEFAULT_SCAN_ROOTS]),
    budgetTokens:
      parsedBudget.success && storedBudget !== undefined && storedBudget !== null
        ? parsedBudget.data
        : DEFAULT_CONTEXT_BUDGET_TOKENS,
  };
}

/**
 * Append `.devdigest` to a root list that has ALREADY been resolved.
 *
 * The order is the whole risk, and it is why this is a function called at the
 * end rather than an extra entry somewhere in the expression above. The fallback
 * to `DEFAULT_SCAN_ROOTS` fires on `roots.length > 0`, so appending
 * `.devdigest` any earlier makes that list non-empty for EVERY workspace and
 * silently deletes the three defaults — a page that quietly stops showing
 * `docs/` and `specs/`, with no error anywhere.
 *
 * De-duplicated after `normalizeRoot`, so a workspace that typed `.devdigest/`
 * by hand gets one root and one group rather than two spellings of the same
 * folder. A root walked twice would also offer the same file twice to a table
 * with a unique index on `(repo_id, path)`.
 */
function withDevdigest(roots: string[]): string[] {
  return [...new Set([...roots, DEVDIGEST_ROOT])];
}
