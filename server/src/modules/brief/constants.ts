/**
 * Caps and literals for the Risk Brief.
 *
 * Every cap here bounds something a PR author controls: a title, a body, a linked
 * issue, a spec file, a file list, a blast answer whose length is set by
 * repository content. All of it feeds ONE paid call, so an unbounded input is a
 * cost bug as well as a prompt-injection surface. The shape follows
 * `modules/intent/constants.ts`: one constant, one reason.
 */

/** The `FEATURE_MODELS` entry that configures which model writes the brief. */
export const BRIEF_FEATURE = 'risk_brief' as const;

/** The system prompt template under `src/prompts/`. */
export const BRIEF_SYSTEM_PROMPT = 'risk-brief.system.md';

/**
 * The ceiling the FIRST assembled input (system + user) is measured against,
 * before the call. A number rather than a fraction of a model's window: the
 * window differs per model and the budget is a property of this feature.
 */
export const BRIEF_TOKEN_BUDGET = 8000;

/**
 * The wall clock on the whole computation, not on one HTTP request.
 * `OpenRouterProvider` ignores `platform/resilience.ts` behind its own 600 000 ms
 * deadline, so a per-request `timeoutMs` is not a bound on this call
 * (`reviewer-core/src/llm/openrouter.ts:33,111`).
 */
export const BRIEF_TIMEOUT_MS = 45_000;

/**
 * ONE schema repair, then the failure is reported. A second retry is what turned
 * a review into a half-hour `running` row once already
 * (`reviewer-core/INSIGHTS.md:54-77`).
 */
export const BRIEF_MAX_RETRIES = 1;

/** States kept per PR. The oldest beyond this is evicted, and the eviction is disclosed. */
export const BRIEF_MAX_STATES = 20;

/**
 * Changed-file paths printed in the diff-stats block.
 *
 * This is also the size of the diff-stats half of the allowed-refs set: a path
 * the model never saw must not be a reference it may return, so the cap and the
 * inventory are the same list, not two lists that happen to agree.
 */
export const MAX_FILE_PATHS = 40;

/**
 * Code points kept from each changed-file path. `pr_files.path` is `text`,
 * written verbatim from GitHub's `filename`; the count cap above bounds how many
 * arrive, not how long one is.
 */
export const MAX_FILE_PATH_CHARS = 400;

/** Code points kept from the PR title. `pull_requests.title` is `text` with no constraint. */
export const MAX_PR_TITLE_CHARS = 300;

/**
 * Code points of the PR body. The same number as `modules/intent`'s and as
 * `MAX_PR_DESCRIPTION_CHARS` in `reviewer-core/src/prompt.ts`, so no path here
 * reads more of an attacker-controlled body than the reviewer itself does.
 */
export const MAX_PR_BODY_CHARS = 4000;

/** Code points kept from the linked issue's title — attacker-controlled. */
export const MAX_ISSUE_TITLE_CHARS = 300;

/** Code points kept from the linked issue's body — attacker-controlled. */
export const MAX_ISSUE_BODY_CHARS = 2000;

/**
 * Code points of the rendered intent block.
 *
 * The intent is a DERIVED summary of a body that already pays full price above,
 * so it is capped lower than the body it came from — the same argument
 * `MAX_INTENT_CHARS` in `reviewer-core/src/prompt.ts` makes.
 */
export const MAX_INTENT_CHARS = 2000;

/** Changed symbols named in the blast fact list. */
export const MAX_BLAST_SYMBOLS = 15;

/** Call sites listed per changed symbol. */
export const MAX_BLAST_CALLERS = 5;

/** Endpoints and crons listed per changed symbol. */
export const MAX_BLAST_ENDPOINTS = 10;

/** Code points kept from one rendered blast fact line — every part of it is repository content. */
export const MAX_BLAST_FACT_CHARS = 400;

/** Plan/spec files read from the clone for one brief. */
export const MAX_SPEC_FILES = 3;

/** Code points kept from each spec file before the elastic budget walk sees it. */
export const MAX_SPEC_FILE_CHARS = 6000;

/**
 * Bytes the clone read is allowed to pull for one spec file. `MAX_SPEC_FILE_CHARS`
 * bounds the string; this bounds the allocation that produces it, which is the
 * half an attacker can move. Four bytes per code point is UTF-8's maximum.
 */
export const MAX_SPEC_FILE_BYTES = MAX_SPEC_FILE_CHARS * 4;

/** Longest repo-relative path the spec-path gate accepts, for a path out of a PR body. */
export const MAX_PATH_LENGTH = 200;

/* -------------------------------------------------------------- output caps */

/**
 * The caps above bound what goes IN. These bound what comes back.
 *
 * The model's answer is untrusted text over an input a PR author controls, and
 * `groundBrief` filters it by membership without bounding its size: the same
 * allowed path could repeat unboundedly and every copy passed, straight into
 * jsonb and out of every GET. So every cap here is applied AFTER the parse, in
 * `groundBrief`, and none of them is stated as a Zod `.max()`: `toJsonSchema`
 * renders that as `maxItems`/`maximum` and Anthropic's structured-output subset
 * rejects both (`server/INSIGHTS.md`, "Anthropic's structured-output API rejects
 * a Zod schema that states a bound"). `ConventionsService.ground` slicing to
 * `MAX_CANDIDATES` is the same move for the same reason.
 */

/** Risks kept, after the severity sort — so a cut takes the least severe. */
export const MAX_RISKS = 12;

/** Review-focus items kept. The prompt asks for "most important first", so a cut takes the tail. */
export const MAX_REVIEW_FOCUS = 10;

/**
 * Grounded references kept on ONE risk. The card opens each as a link, and a
 * reviewer given thirty places to look has been given none.
 */
export const MAX_RISK_FILE_REFS = 10;

/**
 * Refs listed in `dropped_refs`. Pure ungrounded model text — the one field on
 * the record that is served without ever having been vouched for — so it is the
 * one that most needs a ceiling. It is a disclosure, not an inventory: thirty
 * names already say "this answer was not grounded".
 */
export const MAX_DROPPED_REFS = 30;

/**
 * Code points kept from `what` and `why`. One constant for both: the prompt asks
 * for "one or two sentences of plain prose" in each, so they are one rule, and
 * the card renders both as text with no length of its own.
 */
export const MAX_PROSE_CHARS = 600;
