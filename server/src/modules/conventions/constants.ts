/** Tunables for one conventions scan. Every number here costs tokens. */

/** Top-ranked source files pulled from repo-intel. */
export const TOP_FILE_COUNT = 12;

/** Ranked paths are fetched this many times over, then filtered down to N. */
export const SAMPLE_OVERFETCH = 4;

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

/**
 * Per-file cap. A 4000-line barrel would otherwise eat the whole budget, and a
 * file's conventions — how it imports, names, layers, throws — are visible in
 * its first hundred lines or they are not conventions.
 */
export const MAX_FILE_CHARS = 6_000;

/**
 * Byte bound handed to `GitClient.readFile`, which requires one: a sampled path
 * names content from an imported public repo, and a cap applied to the returned
 * string runs only once the whole file is in memory.
 *
 * Derived from `MAX_FILE_CHARS` rather than chosen. The prompt shows the model
 * at most that many characters of a file, so a quote it produces can only come
 * from that slice — and at a worst case of 3 UTF-8 bytes per UTF-16 unit, four
 * bytes per character is more than enough to hold the slice whole. So grounding
 * can still verify every quote the model was in a position to write.
 */
export const MAX_SAMPLE_FILE_BYTES = MAX_FILE_CHARS * 4;

/**
 * Floor for a sample. Ranking rewards being imported everywhere, which a
 * nine-line helper often is; there is no convention to read out of it, and it
 * still costs one of the twelve slots.
 */
export const MIN_FILE_CHARS = 400;

/**
 * Whole-prompt cap for the sample block, counted with the real encoder.
 *
 * Deliberately small. This is a cheap-model call, and the cost of a big prompt
 * is not only money: at ~7k tokens the round trip is ~15s, and it grows fast
 * enough that a generous budget turns "Re-scan" into something nobody presses.
 */
export const MAX_SAMPLE_TOKENS = 24_000;

/** Wall clock for the one model call. */
export const EXTRACT_TIMEOUT_MS = 120_000;

/** Ceiling on what the model may propose; anything past it is dropped unread. */
export const MAX_CANDIDATES = 24;

/** Lines of code kept per evidence site — a card shows a quote, not a file. */
export const MAX_EVIDENCE_LINES = 12;

/**
 * Characters kept per evidence site, on top of the line cap. A generated or
 * minified file is one line long, so the line cap alone would store megabytes
 * per site and re-serve them on every list request.
 */
export const MAX_EVIDENCE_CHARS = 2_000;

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
