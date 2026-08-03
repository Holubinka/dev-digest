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
