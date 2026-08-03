/** Constants for the skills module. */

/** Body version recorded for a newly-created skill. */
export const INITIAL_SKILL_VERSION = 1;

/** Description stored when a skill is created without one (create, then edit). */
export const DEFAULT_SKILL_DESCRIPTION = '';

export const MAX_NAME_CHARS = 120;
export const MAX_DESCRIPTION_CHARS = 500;

/**
 * Cap on a stored body. A skill is spliced into the prompt of every agent that
 * binds it, so this is a token budget as much as a storage limit.
 */
export const MAX_BODY_CHARS = 64_000;

// ---- import limits ------------------------------------------------------

/** Cap on an uploaded file, and on a document fetched by URL. */
export const MAX_UPLOAD_BYTES = 2_000_000;

/** Archive entries considered before the upload is rejected outright. */
export const MAX_ENTRIES = 200;

/** Per markdown entry, uncompressed — checked BEFORE the entry is inflated,
 *  so a small archive declaring a huge member never allocates. */
export const MAX_ENTRY_BYTES = 256_000;

/** Sum of inflated markdown across one archive. */
export const MAX_TOTAL_BYTES = 1_000_000;

/**
 * The only extensions ever inflated. An allowlist, not a denylist: a denylist
 * fails open on `.rb`, `.ps1`, `.wasm`, or an extensionless `Makefile`.
 */
export const READ_EXTENSIONS = ['.md', '.markdown'];

/**
 * What earns the `executable` label. None of this is load-bearing for safety —
 * READ_EXTENSIONS already excludes every one of them. It exists so the preview
 * can say WHY an entry was skipped, which is what turns "nothing executable was
 * processed" from a claim into something the user can see.
 */
export const EXECUTABLE_EXTENSIONS = [
  '.sh', '.bash', '.zsh', '.fish', '.ps1', '.bat', '.cmd',
  '.py', '.rb', '.pl', '.php', '.lua',
  '.js', '.mjs', '.cjs', '.ts', '.jar',
  '.exe', '.dll', '.so', '.dylib', '.wasm', '.bin',
];
export const EXECUTABLE_DIRS = ['scripts', 'bin', 'hooks', '.git', 'node_modules'];

/** Basenames (lowercased) that mark an archive's skill core, best first. */
export const CORE_FILENAMES = ['skill.md', 'readme.md'];

// The URL import's own limits — redirect hops, timeout, response cap — live
// beside the adapter that enforces them (adapters/skill-fetch), not here.
// Nothing under adapters/ may import a feature module.
