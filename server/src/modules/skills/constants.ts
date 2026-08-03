export const INITIAL_SKILL_VERSION = 1;
export const DEFAULT_SKILL_DESCRIPTION = '';
export const MAX_NAME_CHARS = 120;
export const MAX_DESCRIPTION_CHARS = 500;

/** A body is spliced into the prompt of every agent that binds it, so this is a
 *  token budget as much as a storage limit. */
export const MAX_BODY_CHARS = 64_000;

// ---- import limits ------------------------------------------------------

export const MAX_UPLOAD_BYTES = 2_000_000;
export const MAX_ENTRIES = 200;

/** Checked BEFORE an entry is inflated, so a small archive declaring a huge
 *  member never allocates. */
export const MAX_ENTRY_BYTES = 256_000;
export const MAX_TOTAL_BYTES = 1_000_000;

/** An allowlist, not a denylist: a denylist fails open on `.rb`, `.ps1`,
 *  `.wasm`, or an extensionless `Makefile`. */
export const READ_EXTENSIONS = ['.md', '.markdown'];

/**
 * Not load-bearing for safety — READ_EXTENSIONS already excludes every one of
 * these. It exists so the preview can say WHY an entry was skipped, which turns
 * "nothing executable was processed" from a claim into something visible.
 */
export const EXECUTABLE_EXTENSIONS = [
  '.sh', '.bash', '.zsh', '.fish', '.ps1', '.bat', '.cmd',
  '.py', '.rb', '.pl', '.php', '.lua',
  '.js', '.mjs', '.cjs', '.ts', '.jar',
  '.exe', '.dll', '.so', '.dylib', '.wasm', '.bin',
];
export const EXECUTABLE_DIRS = ['scripts', 'bin', 'hooks', '.git', 'node_modules'];

/** Best first. */
export const CORE_FILENAMES = ['skill.md', 'readme.md'];

// The URL import's own limits live beside the adapter that enforces them
// (adapters/skill-fetch): nothing under adapters/ may import a feature module.

/** Retries when a concurrent body edit invalidates the injection check. A third
 *  attempt would mean sustained contention on one skill in a single-user tool,
 *  which is a bug report, not a retry. */
export const UPDATE_ATTEMPTS = 3;
