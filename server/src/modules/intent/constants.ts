/**
 * Caps and literals for intent derivation.
 *
 * Every cap here bounds something a PR author controls: a body can link any
 * number of files, a spec file has no size limit, and a long-lived branch has
 * no commit limit. The classifier prompt is paid for per review run, so an
 * unbounded input is a cost bug as well as a safety one.
 */

/** Plan/spec files read from the clone for one PR. */
export const MAX_PLAN_FILES = 3;

/** Code points kept from each plan/spec file (NOT UTF-16 units — see helpers). */
export const MAX_PLAN_FILE_CHARS = 6000;

/** Longest repo-relative path `sanitizeRepoPath` accepts. */
export const MAX_PATH_LENGTH = 200;

/**
 * Code points of the PR body handed to the classifier. Deliberately the same
 * number as `MAX_PR_DESCRIPTION_CHARS` in `reviewer-core/src/prompt.ts:37`, so
 * the classifier never reads more of the body than the reviewer itself does.
 * On a public repo this string is attacker-controlled and the call is paid for.
 */
export const MAX_PR_BODY_CHARS = 4000;

/** Code points kept from the linked issue's body — attacker-controlled too. */
export const MAX_ISSUE_BODY_CHARS = 2000;

/** Code points kept from the linked issue's title. */
export const MAX_ISSUE_TITLE_CHARS = 300;

/** Commit subjects handed to the classifier (first line of each message). */
export const MAX_COMMIT_MESSAGES = 20;

/** Changed file paths handed to the classifier. */
export const MAX_FILE_PATHS = 40;

/** The `FEATURE_MODELS` entry that configures which model classifies intent. */
export const INTENT_FEATURE = 'review_intent' as const;

/** The system prompt template under `src/prompts/`. */
export const INTENT_SYSTEM_PROMPT = 'intent.system.md';

/**
 * One repair attempt and an explicit wall clock, rather than the provider
 * defaults. `reviewer-core/INSIGHTS.md:54-77` records a review that sat in
 * `running` for over half an hour because a per-request timeout, the SDK's own
 * retries and the schema-repair loop multiplied. The intent prompt is small and
 * the model is cheap: one repair is enough.
 */
export const INTENT_MAX_RETRIES = 1;
export const INTENT_TIMEOUT_MS = 45_000;
