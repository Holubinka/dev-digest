import { CI_BUNDLE } from '@devdigest/shared';

/**
 * Where an export to CI writes inside a target repository — one fact, two slices.
 *
 * `modules/ci` WRITES `.devdigest/agents/<slug>.yaml` and
 * `.devdigest/skills/<slug>.md`; `modules/context` must leave exactly those two
 * folders out of the scan, or a review reads the reviewing agent's own skill
 * back as project context and grounds a finding in it (`AC-106`, `AC-107`).
 *
 * `no-cross-module` forbids either slice importing the other, and while each
 * carried its own literals a subfolder rename on one side compiled, typechecked
 * and passed `pnpm arch` while silently reopening that loop. `_shared/` is the
 * remedy the rule's own message names; `_shared/budget.ts` is the same move for
 * another pair of slices.
 *
 * Nothing here is a rule about scanning or about generating — it is only the
 * names. Each slice keeps its own decision about them.
 */

/**
 * The folder DevDigest writes into inside a repository.
 *
 * It is also a scan root of EVERY repository whatever the workspace configured,
 * because that is the whole durability story: a document created here is
 * untracked, and untracked is what `git reset --hard` in `sync()` leaves alone.
 */
export const DEVDIGEST_ROOT = CI_BUNDLE.root;

/** One manifest per exported agent — `.devdigest/agents/<slug>.yaml`. */
export const BUNDLE_AGENTS_DIR = CI_BUNDLE.agents;

/** One document per bound skill — `.devdigest/skills/<slug>.md`. */
export const BUNDLE_SKILLS_DIR = CI_BUNDLE.skills;

/**
 * The subfolders of the root that ARE the exported bundle.
 *
 * Order is `skills` then `agents`: `context/service.ts` renders this list into
 * the refusal a writer sees, and the words of that message are asserted.
 *
 * Everything else under the root is the workspace's own documents and stays
 * both scannable and writable (`AC-108`). The non-markdown bundle files need no
 * entry here at all — `DOC_EXTENSIONS` is `['.md']`, so `.yaml`, `.jsonl`,
 * `.mjs` and `.gitattributes` were never scan candidates.
 */
export const BUNDLE_SUBROOTS = [BUNDLE_SKILLS_DIR, BUNDLE_AGENTS_DIR] as const;
