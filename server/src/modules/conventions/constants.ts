/** Tunables for one conventions scan. Every number here costs tokens. */

/** Top-ranked source files pulled from repo-intel (the ТЗ's "top-12"). */
export const TOP_FILE_COUNT = 12;

/**
 * Config files read before the source samples. They are what makes the
 * "already machine-enforced" filter possible: a rule ESLint or tsconfig already
 * fails the build over is not a house convention worth a skill.
 */
export const CONFIG_PATHS = [
  'eslint.config.mjs',
  'eslint.config.js',
  'eslint.config.ts',
  '.eslintrc.json',
  '.eslintrc.js',
  '.eslintrc.cjs',
  'tsconfig.json',
  '.prettierrc',
  '.prettierrc.json',
  '.prettierrc.js',
  'prettier.config.js',
  'package.json',
] as const;

/** Per-file cap. A 4000-line barrel would otherwise eat the whole budget. */
export const MAX_FILE_CHARS = 12_000;

/** Whole-prompt cap for the sample block, counted with the real encoder. */
export const MAX_SAMPLE_TOKENS = 60_000;

/** Wall clock for the one model call. */
export const EXTRACT_TIMEOUT_MS = 120_000;

/** Ceiling on what the model may propose; anything past it is dropped unread. */
export const MAX_CANDIDATES = 24;

/** Lines of code kept per evidence site — a card shows a quote, not a file. */
export const MAX_EVIDENCE_LINES = 12;

/**
 * How long a quoted line must be before a substring match counts. Below this a
 * fragment like `}` or `return;` would "match" almost anywhere.
 */
export const MIN_SNIPPET_MATCH_CHARS = 12;

/** Ceiling on a hand-edited rule. A rule is a sentence, not a document. */
export const MAX_RULE_CHARS = 500;

/**
 * Verified evidence sites a candidate needs to survive.
 *
 * One site is an observation ("this file does X"); two is the beginning of a
 * rule. This is the single strongest quality lever in the pipeline — drop it to
 * 1 and the list roughly doubles, mostly with things nobody would enforce.
 */
export const MIN_VERIFIED_EVIDENCE = 2;
