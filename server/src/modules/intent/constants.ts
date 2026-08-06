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

/**
 * Bytes the clone read itself is allowed to pull for one plan/spec file.
 *
 * `MAX_PLAN_FILE_CHARS` bounds the string the classifier sees; this bounds the
 * allocation that produces it, which is the half an attacker can move. Four
 * bytes per code point is UTF-8's maximum, so this can only ever cut a file
 * that was already going to be truncated by the character cap above.
 */
export const MAX_PLAN_FILE_BYTES = MAX_PLAN_FILE_CHARS * 4;

/**
 * Code points kept from the PR title.
 *
 * `pull_requests.title` is `text` with no constraint, written verbatim from
 * GitHub on every list sync. The only bound without this one is whatever GitHub
 * enforces — a number nothing here names, and one this file already declined to
 * trust for the analogous field, since the linked issue's title is capped below.
 */
export const MAX_PR_TITLE_CHARS = 300;

/**
 * Code points kept from each changed-file path.
 *
 * `MAX_FILE_PATHS` bounds how many arrive as a SQL `limit`, not how long one is;
 * `pr_files.path` is `text` written straight from GitHub's `filename`. Sized
 * above `MAX_PATH_LENGTH` on purpose — that cap gates a path we are about to
 * *read*, this one only gates a path we print, and a real path truncated in a
 * prompt is worse than a long one.
 */
export const MAX_FILE_PATH_CHARS = 400;

/**
 * Code points kept from each commit subject.
 *
 * `MAX_COMMIT_MESSAGES` bounds how many subjects reach the classifier, not how
 * long any one of them is — and git imposes no limit on a subject line, which
 * `pr_commits.message` then stores verbatim. Counting without measuring is the
 * gap: twenty subjects is a small number of arbitrarily large strings.
 */
export const MAX_COMMIT_SUBJECT_CHARS = 200;

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
