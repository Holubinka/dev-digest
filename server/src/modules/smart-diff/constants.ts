/**
 * The file-role rules and size thresholds for Smart Diff.
 *
 * Everything that decides a role or trips a threshold lives here, so changing
 * the taxonomy never means reading `helpers.ts`.
 *
 * Patterns are tried BOILERPLATE → WIRING → core and the first match wins. The
 * order is load-bearing: `dist/index.js` matches both lists, and calling it a
 * barrel would promote generated output above real logic. Nothing carries the
 * `g` flag — a global RegExp keeps `lastIndex` between `.test()` calls and would
 * classify the same path differently depending on what came before it.
 */

/** Generated, mechanical or vendored — a reviewer skims these or skips them. */
export const BOILERPLATE_PATTERNS: readonly RegExp[] = [
  // Lock files. The acceptance criterion is that these are boilerplate from any
  // depth, so every pattern here is anchored to a path segment, not to the root.
  /(^|\/)(pnpm-lock\.yaml|package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|bun\.lockb?)$/,
  /(^|\/)(Cargo\.lock|Gemfile\.lock|composer\.lock|poetry\.lock|Pipfile\.lock|go\.sum)$/,
  // Build output and dependency trees.
  /(^|\/)(dist|build|out|coverage|\.next|node_modules|vendor)\//,
  /\.(min\.js|min\.css)$/,
  /\.map$/,
  // Snapshots and generated sources.
  /(^|\/)__snapshots__\//,
  /\.snap$/,
  /\.generated\.[^/]+$/,
  /(^|\/)generated\//,
  /(^|\/)drizzle\/migrations\/meta\//,
  // Manifests and prose. A dependency bump or a README edit is not the substance
  // of a change, and putting them here is what keeps `core` meaning "logic".
  /(^|\/)package\.json$/,
  /\.mdx?$/i,
];

/** Hooks the core into the app: barrels, entrypoints, configuration. */
export const WIRING_PATTERNS: readonly RegExp[] = [
  /(^|\/)index\.(ts|tsx|js|jsx|mjs|cjs)$/,
  /(^|\/)(server|main|app|bootstrap)\.(ts|tsx|js|jsx|mjs|cjs)$/,
  /(^|\/)[^/]*\.config\.[^/]+$/,
  /(^|\/)config\.(ts|js|mjs|cjs|json|ya?ml)$/,
  /(^|\/)\.env(\.|$)/,
  /(^|\/)tsconfig[^/]*\.json$/,
  /(^|\/)Dockerfile[^/]*$/,
  /(^|\/)docker-compose[^/]*\.ya?ml$/,
  /(^|\/)\.github\/workflows\//,
  /\.d\.ts$/,
];

/**
 * Group order in the response, and therefore top-to-bottom order on screen:
 * the substance of the change first, the mechanical residue last.
 */
export const ROLE_ORDER = ['core', 'wiring', 'boilerplate'] as const;

/**
 * Above this many changed lines the PR is flagged as too big to review in one
 * sitting. 400 is the upper end of the range review research keeps landing on
 * (defect detection falls off sharply past ~200-400 lines), and it is high
 * enough that an ordinary feature PR does not trip it on every open.
 */
export const MAX_REVIEWABLE_LINES = 400;

/** A role group smaller than this is not worth proposing as its own PR. */
export const MIN_SPLIT_FILES = 2;

/**
 * Widest finding range that is expanded line by line.
 *
 * `findings.start_line`/`end_line` are int4 written from model output. The
 * contract bounds them only with `z.number().int()`, and `db/text.ts` `toInt4`
 * deliberately CLAMPS to 2147483647 so a nonsense row is still storable — so a
 * range of two billion lines can reach this module. Expanding it would hang the
 * single-process API and then throw `Set maximum size exceeded`.
 *
 * Past this width the finding is badged on its start line alone: a finding
 * citing more than a couple of hundred lines is not pointing at anything a
 * reviewer can act on, and dropping it outright would hide a real finding.
 */
export const MAX_FINDING_LINE_SPAN = 200;

/** Human-readable names for the splits proposed from the role groups. */
export const SPLIT_NAMES: Record<(typeof ROLE_ORDER)[number], string> = {
  core: 'Core logic',
  wiring: 'Wiring and configuration',
  boilerplate: 'Generated and mechanical',
};
