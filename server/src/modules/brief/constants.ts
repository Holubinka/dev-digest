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

/**
 * Code points kept from ONE VARIABLE PART of a blast fact line: a symbol name,
 * the indexer's `kind`, a file path, an endpoint label. Every one of them is
 * repository content, and none of them is bounded by anything upstream.
 *
 * THE PART IS CAPPED, NOT THE LINE, and that is the whole point. A path and a
 * label are also REFERENCES — `blastBlock` puts them in the allowed set — so
 * cutting the assembled line cuts names already declared printed and licenses the
 * model to cite what it never read (`buildAllowedRefs`; found 2026-08-16, the
 * third break of that one invariant). Clamping each part first makes the string
 * that enters the line the same string that enters the set.
 *
 * 200 rather than something tighter because a truncated path is a dead link on
 * the card: measured against `Holubinka/dev-digest` PR #20 on 2026-08-16, 4 of the
 * 1835 parts in its blast view are longer than 120 code points and the longest is
 * 125 (`client/src/app/settings/[section]/_components/…`). A cap that cuts real
 * paths in the repository the feature is run against trades one wrong answer for
 * another.
 */
export const MAX_BLAST_PART_CHARS = 200;

/**
 * Code points kept from one rendered blast fact line, and from `view.reason`.
 *
 * DERIVED from the part cap, not chosen beside it: the longest line the block
 * renders is a symbol's — three variable parts plus 22 code points of fixed text
 * and up to 10 digits of `caller_count` — so 3 × 200 + 32 = 632 ≤ 640. It is the
 * ceiling the per-part caps have to keep, which is why it moved when they did;
 * `test/brief-allowed-refs.test.ts` measures every rendered line of a hostile view
 * against it instead of trusting this paragraph.
 */
export const MAX_BLAST_FACT_CHARS = 640;

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
 *
 * A COUNT IS HALF A BOUND. Each element is an arbitrary string the model wrote,
 * so thirty of them are thirty times whatever it felt like writing; the length of
 * one is `MAX_FILE_PATH_CHARS`, the path-shaped ceiling, because a dropped ref is
 * a path or an endpoint label that failed to match — not prose.
 */
export const MAX_DROPPED_REFS = 30;

/**
 * Code points kept from `what` and `why`, and from a risk's `explanation`. One
 * constant for the three: the prompt asks for "one or two sentences" in each
 * (`risk-brief.system.md`), so they are one rule, and the card renders all three
 * as text with no length of its own.
 */
export const MAX_PROSE_CHARS = 600;

/**
 * Code points kept from a risk's `kind` and `title` and from a review-focus
 * `reason` — the fields the prompt asks for as ONE LINE: "a short noun phrase",
 * "a `title` of at most one line", "a `reason` of one short sentence".
 *
 * Same argument as `MAX_PROSE_CHARS`, one step shorter, and it needs stating
 * because until 2026-08-16 only `what` and `why` had a ceiling at all: every other
 * string on the answer travelled from an untrusted input through the model into
 * jsonb and out of every GET at whatever length the model's own max-output allowed.
 * `service.ts` sends no `max_tokens`, so that was the only bound in the system.
 *
 * A CEILING, NOT A STYLE RULE, which is why it is not 200. The real brief cached
 * for `Holubinka/dev-digest` PR #20 (`GET /pulls/:id/brief`, 2026-08-16) has kinds
 * of 10-35 code points, titles of 58-79 and reasons of 139-190: the model writes
 * "one short sentence" at 190, so a cap near it would clip ordinary answers on the
 * card while doing nothing extra against a pathological one.
 */
export const MAX_LINE_CHARS = 400;
