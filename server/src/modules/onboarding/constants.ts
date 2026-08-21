/**
 * Tunables for one onboarding generation. One constant, one reason — the shape
 * `modules/brief/constants.ts` and `modules/conventions/constants.ts` use.
 *
 * The numbers here are STARTING numbers, named and measurable rather than
 * final: the spec fixes each one, ties it to a counter, and requires that what
 * did not fit stays visible (`specs/SPEC-03-onboarding-tour.md`, D23/D24). A
 * later review moves them from the numbers a run collected, not from a fresh
 * guess.
 */

import type { OnboardingPackageManager } from '@devdigest/shared';

/** The `FEATURE_MODELS` entry that configures which model writes the tour. */
export const ONBOARDING_FEATURE = 'onboarding' as const;

/**
 * The language of the generated content, FIXED IN CODE and identical for every
 * tour of every repository.
 *
 * Not read from the client locale, and that is the requirement rather than a
 * simplification: the interface stays English while the tour body is this. A
 * locale that reached here would have to enter the generation key too, which
 * multiplies the cache and makes two readers of one repository pay for two
 * different tours of it (D20).
 */
export const TOUR_LANGUAGE = 'Ukrainian';

/**
 * The FLOOR of the input budget, in tokens: what the assembled input (system +
 * user) may cost on a repository whose `files_indexed` is as small as the signal
 * can report. The applied value is `budgetForIndex(filesIndexed)` in
 * `sizing.ts`; this is one end of its ramp.
 *
 * `SPEC-04 § D11`, and deliberately not the "about 20 000" that was asked for:
 * this repository's own generation counts 23 481 tokens, so a floor of 20 000
 * would be a regression on exactly the repository the feature is demonstrated
 * on. 24 000 is the only budget this feature has a green run behind, and it is
 * "about 20 000" as well.
 */
export const ONBOARDING_BUDGET_FLOOR = 24_000;

/**
 * The CEILING of the input budget — derived, not chosen (`SPEC-04 § D11` and its
 * derivation table): ≈50 700 tokens is the full request of every input at
 * today's selection ceilings, so above 50 000 there is nothing left to buy.
 *
 * It buys more of what is already selected and never more selection: no sample
 * count, per-file cap or per-document cap moves with it (AC-67), which is what
 * keeps this number a bound on the WALK rather than a second dial on the gather.
 */
export const ONBOARDING_BUDGET_CEILING = 50_000;

/**
 * The `files_indexed` at which the budget reaches its ceiling, i.e. the ramp's
 * denominator.
 *
 * `SPEC-04 § D22`: the REQUEST saturates long before the index reaches
 * `MAX_INDEXED_FILES`. The documents stop at `MAX_PACKAGES`, the samples at
 * `SAMPLE_FILE_COUNT`, the skeleton is bounded by `REPO_MAP_TOKEN_BUDGET` and
 * the chains by `CRITICAL_PATH_CHAINS` — so a ramp tied to the index's own
 * ceiling calibrated on the limit of a DIFFERENT quantity than the one that
 * grows. This repository (656 files) is therefore funded at 32 528 rather than
 * at the 27 411 the first edition gave it.
 */
export const ONBOARDING_BUDGET_RAMP_FILES = 2_000;

/**
 * The budget handed to `getRepoMap`. NOT a free number, and not this feature's
 * to tune: it must equal the budget the pipeline rendered the cached map at —
 * `DEFAULT_REPO_MAP_TOKEN_BUDGET` in `repo-intel/constants.ts`, which is 1500.
 *
 * `getRepoMap` is a cache READ, not a render on demand. It looks the map up by
 * the exact triple `(repoId, commitSha, tokenBudget)` — an equality on the
 * budget column, not a "renders within" — and the pipeline writes exactly one
 * row per commit, at its own default. So a number chosen here because more is
 * better does not buy a larger skeleton: it matches no row at all, and the
 * highest-priority input of the whole feature (D13) arrives EMPTY on every
 * generation of every repository. Measured 2026-08-17 against a real index: at
 * 6000 the facade returned 0 characters and the gather recorded
 * `repo_map:missing`; at 1500 it returned 6215 characters / 1497 tokens.
 *
 * Raising it is therefore a change in `repo-intel` — teaching the facade to
 * render on demand, or the pipeline to cache a second budget — and that is
 * outside this feature (N7/D21). It is not an edit to this line.
 * `test/onboarding-gather.test.ts` holds the two numbers against each other,
 * because `no-cross-module` forbids importing the one from the other.
 */
export const REPO_MAP_TOKEN_BUDGET = 1_500;

/**
 * Top-ranked files read as samples. Twenty rather than the twelve
 * `conventions/constants.ts` uses, because the task is wider: conventions
 * extracts style rules, for which the first lines of a file are enough, while a
 * tour has to describe an architecture, follow critical paths and invent first
 * tasks (D23).
 */
export const SAMPLE_FILE_COUNT = 20;

/**
 * Per-file cap, in code points. Unchanged from `conventions/constants.ts`
 * because it is DERIVED, not chosen: it holds the property "the model could
 * only quote what we are able to verify", and that property does not depend on
 * how many files there are.
 */
export const MAX_FILE_CHARS = 6_000;

/**
 * Byte bound handed to `GitClient.readFile`, which requires one. A sampled path
 * names content from an imported public repository, and a cap applied to the
 * returned string runs only once the whole file is in memory. Four bytes per
 * code point is UTF-8's maximum, so this holds the slice above whole.
 */
export const MAX_SAMPLE_FILE_BYTES = MAX_FILE_CHARS * 4;

/**
 * Floor for a sample. Ranking rewards being imported everywhere, which a
 * nine-line helper often is; there is nothing to learn from it and it still
 * costs one of the twenty slots.
 */
export const MIN_FILE_CHARS = 400;

/**
 * Wall clock on the one model call at the FLOOR budget.
 *
 * Set explicitly because every default here is worse than a choice: the native
 * adapters use 60 000 ms and `OpenRouterProvider` — the default path of this
 * feature — carries its own 600 000 ms deadline, which is not a bound anyone
 * would have picked. Half again the conventions scan's 120 000 ms, because that
 * call produces a list of sentences while this one produces five markdown
 * bodies, a mermaid diagram and a task list in Ukrainian, which `cl100k_base`
 * encodes far less densely than Latin script.
 *
 * It is a FLOOR now rather than the whole answer: the clock is a function of the
 * budget (`timeoutForBudget`, `sizing.ts`), because a budget raised without the
 * clock raised with it times out precisely on the repositories the budget was
 * raised for — and a timeout is a generation already paid for and thrown away.
 */
export const ONBOARDING_TIMEOUT_FLOOR_MS = 180_000;

/**
 * Wall clock at the CEILING budget, and the absolute upper bound of the clock
 * (AC-63, AC-64).
 *
 * Derived (`SPEC-04 § D12`): the measured pair is 105 000 ms for 23 481 input
 * tokens, i.e. 4,47 ms per input token if time grows with the input, so 50 000
 * tokens is on the order of 223 500 ms and 300 000 leaves 34 % of headroom over
 * it. The estimate is deliberately pessimistic — the output length is bounded by
 * the contract's caps rather than by the input, so real growth is sublinear —
 * because the two errors cost differently: a spare minute costs a minute, and a
 * timeout costs the whole generation.
 *
 * Five minutes is also the edge of what may still be called a button, which is
 * why the ceiling of the ramp and the ceiling of the clock are the same number.
 */
export const ONBOARDING_TIMEOUT_CEILING_MS = 300_000;

/**
 * ONE schema repair, then the generation fails and nothing is stored. A second
 * retry is what turned a review into a half-hour `running` row once already
 * (`reviewer-core/INSIGHTS.md`).
 */
export const ONBOARDING_MAX_RETRIES = 1;

/* ------------------------------------------------------------ package walk */

/**
 * Directory depth below the clone root that the manifest walk descends.
 *
 * Two covers both real layouts: DevDigest keeps its packages at depth 1
 * (`server/`, `client/`, `reviewer-core/`, `e2e/`, `mcp/`), while most of the
 * world keeps them at depth 2 (`packages/*`, `apps/*`). Depth 1 would break the
 * second case; depth 3 buys little and pays for it in walking (D24).
 */
export const PACKAGE_SCAN_DEPTH = 2;

/**
 * Package blocks shown. Six DevDigest packages (five plus the root) with room
 * to spare, and at the same time the line past which the section stops being an
 * onboarding and becomes a directory listing — nobody reads fifty command
 * blocks. What the ceiling cut is disclosed, never silently dropped.
 */
export const MAX_PACKAGES = 12;

/**
 * `maxFiles` handed to the walk — LARGER THAN `MAX_PACKAGES` ON PURPOSE.
 *
 * Not for the root package's sake: `listFiles` orders shallowest first, so the
 * root manifest survives any ceiling that returns anything at all, and no number
 * here can buy that property. It was tried the other way — this constant was 12,
 * then 64 — and both are the same alphabetical slice with the cut in a different
 * place, which is what a repository with 65 `apps/aNNN/package.json` proved.
 *
 * What the margin is for is the ORDER the blocks are shown in. `selectPackages`
 * ranks the walk's matches itself (root first, then by path) and only then takes
 * twelve; a walk asked for exactly twelve would have pre-selected which twelve
 * it ranks, by depth, and a shallow package the model needs would be missing
 * with nothing to say so.
 */
export const PACKAGE_SCAN_LIMIT = 64;

/** The file whose presence defines a package. A NAME, not an extension. */
export const PACKAGE_MANIFEST = 'package.json';

/**
 * Lock file → the package manager it dictates. Presence beside a manifest is
 * the only evidence used: exactly one known lock file names a manager, none
 * names nothing, and two different ones also name nothing, because either
 * answer would be a guess and these commands are copied into a shell. The root
 * `AGENTS.md` says it in one line — "Do not mix".
 */
export const LOCKFILES = {
  'pnpm-lock.yaml': 'pnpm',
  'package-lock.json': 'npm',
  'yarn.lock': 'yarn',
  'bun.lockb': 'bun',
} as const satisfies Record<string, OnboardingPackageManager>;

/**
 * Config files looked for beside each shown package. Two jobs: they are where env
 * vars are allowed to come from (AC-21), and one of them existing is what
 * authorises a `cp <file> .env` setup command — `OnboardingSetupCommand`'s
 * `source_path` is that file.
 */
export const PACKAGE_CONFIG_FILES = ['.env.example', '.env.sample'] as const;

/**
 * Compose files looked for at the clone root — the second thing that can
 * authorise a repo-level setup command.
 *
 * These four names, in this order, are the ones Docker Compose itself resolves,
 * so a repository is asked the same question the tool would ask; this one keeps
 * its services in `docker-compose.yml`. The file is read for its TEXT, not merely
 * probed for existence, because a `docker compose up -d postgres redis` is
 * grounded only when the file declares each service it names — an undeclared
 * service is not nearly right, it is an invention handed to a reader as a command
 * to run.
 */
export const COMPOSE_FILES = [
  'compose.yaml',
  'compose.yml',
  'docker-compose.yaml',
  'docker-compose.yml',
] as const;

/**
 * Documents read at the clone root, lowest input priority. They describe the
 * repository as a whole, which is why they come before any package's own.
 */
export const PROJECT_DOC_PATHS = ['README.md', 'AGENTS.md'] as const;

/**
 * Documents looked for beside each shown package, on top of the root pair.
 *
 * `README.md` only, and the asymmetry with `PROJECT_DOC_PATHS` is the point: a
 * package's README is the one file that says what THAT package is, which is
 * exactly what the architecture and critical-path sections were writing without
 * — this repository keeps its API map and its module-registration contract in
 * `server/README.md`, and the tour never opened it.
 *
 * Gathered by the same walk-then-read-beside mechanism as `PACKAGE_CONFIG_FILES`,
 * so a package the ceiling did not show contributes no document either: what the
 * model is told about is the set of packages it was shown.
 */
export const PACKAGE_DOC_FILES = ['README.md'] as const;

/**
 * Per-document cap, in code points — the one ceiling this input cannot do
 * without.
 *
 * `MAX_FILE_CHARS` is 6 000 and is DERIVED for a sampled source file: it holds
 * "the model could only quote what we are able to verify". A document is not
 * quoted line by line, it is read for orientation, and its orientation is
 * front-loaded — so the two caps hold different properties and the number does
 * not carry over. Two thirds of it, the same fraction `MAX_DIAGRAM_CHARS` takes
 * off `MAX_BODY_CHARS`, and for a comparable reason: denser material, less
 * tolerance for the tail.
 *
 * What 6 000 would cost, since this input grew from two documents to as many as
 * `MAX_PACKAGES` + 2: fourteen documents at 6 000 code points is 84 000 of them,
 * on the order of 22 000 tokens against a floor budget of 24 000
 * (`ONBOARDING_BUDGET_FLOOR`) — the LOWEST-priority input sized to displace
 * everything above it, and the floor is the budget a small repository gets. At 4 000 the
 * same fourteen are on the order of 14 700, and the per-document budget walk cuts
 * them long before that.
 *
 * Measured against the seven documents this repository has (2026-08-18,
 * `server/clones/Holubinka/dev-digest`): `reviewer-core/README.md` (2 583) and
 * `client/README.md` (2 896) arrive whole; `e2e/README.md` (4 300) keeps
 * everything above its coverage table; and each long one keeps its title and its
 * architecture section — `README.md` `## Architecture` at 1 723, `AGENTS.md`
 * `## Stack` at 206, `server/README.md` `## Request & DI flow` at 1 816,
 * `mcp/README.md` `## The five tools` at 2 019.
 *
 * What it costs, named rather than hidden: `server/README.md` `## API map` runs
 * from code point 3 461 to 4 700, so the tour sees the map's first rows and not
 * its tail. Fitting it whole would put this cap at 5 000 — 83 % of
 * `MAX_FILE_CHARS`, which is not a ceiling.
 *
 * MEASURABLE, and that is a requirement rather than a nicety: the `project_docs`
 * row of `inputs[]` reports how many documents shipped out of how many were read
 * AND how many this cap shortened, so a later review moves this number from what
 * a run collected instead of guessing again.
 */
export const MAX_DOC_CHARS = 4_000;

/**
 * Byte bound handed to `GitClient.readFile` for a document. Four bytes per code
 * point is UTF-8's maximum, so this holds `MAX_DOC_CHARS` whole — the same
 * derivation as `MAX_SAMPLE_FILE_BYTES`, and the same reason it is a separate
 * constant rather than the cap applied to the returned string: `readFile` reads
 * into a fixed buffer, and a cap applied afterwards runs one step too late.
 */
export const MAX_DOC_FILE_BYTES = MAX_DOC_CHARS * 4;

/**
 * Bytes requested when a read is only asking "does this path exist". One byte:
 * the answer is whether the read succeeded, and pulling the file to learn it
 * would make an existence check as expensive as the file is large.
 */
export const PATH_PROBE_BYTES = 1;

/**
 * Existence probes one generation may spend. The model decides how many paths
 * it claims, so without a ceiling the number of clone reads is model-controlled;
 * paths past it are treated as unverified and counted, which is the same outcome
 * a failed probe has.
 *
 * Two hundred, and the number is anchored on the SUPPLY that now feeds it rather
 * than on how many claims look reasonable. The chains alone can carry
 * `CRITICAL_PATH_CHAINS` × (1 + `BFS_DEPTH`) = 100 distinct paths
 * (`repo-intel/constants.ts`), and a task may now name a file per step. A
 * ceiling below the claims a GROUNDED answer can legitimately contain does not
 * merely truncate: it turns real files into `unknown_path`, corrupting the exact
 * counters this feature's evidence is read from.
 */
export const MAX_PATH_PROBES = 200;

/**
 * Longest repo-relative path accepted, in code points, before any existence test.
 *
 * Two hundred rather than a number of this feature's own. `sanitizeRelativePath`
 * takes `maxLength` as a PARAMETER precisely because its callers differ, and its
 * docstring names the split: 200 for a path parsed out of an attacker's PR body,
 * 512 for one a maintainer typed into the editor (`_shared/repo-paths.ts`;
 * `brief/constants.ts`, `MAX_PATH_LENGTH = 200`; `context/constants.ts`,
 * `MAX_PATH_LENGTH = 512`). A path written by a model over an imported public
 * repository is the first class, not the second, so this adopts that ceiling
 * instead of inventing a third number beside it.
 *
 * It runs before anything else, and that ordering is the reason it lives with the
 * inputs rather than with the output caps: the cheapest way to spend
 * `MAX_PATH_PROBES` on nothing is to probe a four-kilobyte string that was never
 * a path.
 */
export const MAX_PATH_CHARS = 200;

/* ------------------------------------------------------------- output caps */

/**
 * The numbers above bound what goes IN. These bound what comes back.
 *
 * Every one of them is applied AFTER the parse, in grounding, and none is
 * stated as a Zod `.max()`. Two reasons: `toJsonSchema` renders a bound as
 * `maxItems`/`maximum` and Anthropic's structured-output subset rejects both
 * (`server/INSIGHTS.md`, "Anthropic's structured-output API rejects a Zod schema
 * that states a bound"), and grounding by membership is not a bound on the
 * answer — one allowed path repeated four hundred times passes a membership
 * filter four hundred times (`server/INSIGHTS.md`, "Grounding by membership is
 * not a bound on the answer").
 */

/**
 * Links kept on one section. A card offers a few places to look, not thirty.
 *
 * The one cap in this block that a criterion states outright: **AC-72** — every
 * section carries at most four links. The number was chosen before the feature
 * was ordered, by the scaffolding prompt (`prompts/onboarding.system.md`), and
 * the spec turned it into a criterion so it would survive that prompt being
 * rewritten. It then was rewritten, which is why the four are here: a ceiling
 * stated in a prompt is a request to the model, and this one is a requirement.
 */
export const MAX_LINKS_PER_SECTION = 4;

/**
 * Critical-path flows kept — the DISPLAY ceiling, and it may never sit below the
 * supply (SPEC-04 § AC-21, AC-22).
 *
 * That anchor is new and it replaces the old one, which said this number sat one
 * below `CRITICAL_PATH_ROOTS` = 5 because "above five, no further flow could
 * survive grounding at all". Both halves of that sentence are now false: the
 * supply is `CRITICAL_PATH_CHAINS` = 20 (`repo-intel/constants.ts`), and every
 * grounded flow is to be shown. A ceiling below the supply would discard flows
 * that passed every membership test — the one drop this feature would have no
 * counter for, because it is not a claim that failed.
 *
 * The two numbers cannot see each other: `no-cross-module` forbids
 * `modules/onboarding` from importing `modules/repo-intel`, `import type`
 * included. `test/onboarding-generate.test.ts` holds `MAX_FLOWS >=
 * CRITICAL_PATH_CHAINS` instead — the `REPO_MAP_TOKEN_BUDGET` precedent above.
 *
 * What it still defends against is the model repeating a chain it was given —
 * membership is not a bound on how often a member may appear
 * (`server/INSIGHTS.md`, "Grounding by membership is not a bound on the answer").
 */
export const MAX_FLOWS = 20;

/**
 * Steps kept in one flow. Six, unchanged, on a corrected anchor.
 *
 * AC-14 says a flow is an ordered list assembled from the chains and states no
 * length. One chain is at most `1 + BFS_DEPTH` = FIVE files
 * (`repo-intel/constants.ts`) — three when this cap was written, and the old
 * docstring still said three — and membership is tested against the union of the
 * chains rather than against one of them. So six still lets a flow walk a whole
 * chain, still leaves a step over for one that legitimately crosses into
 * another, and still bounds one that repeats a single path.
 */
export const MAX_FLOW_STEPS = 6;

/**
 * Items kept in the reading path.
 *
 * The plan's own (R39): AC-26 asks for a numbered list and AC-28 fixes only its
 * FIRST item; neither states a length. The ground set here is wide — the chains
 * plus `SAMPLE_FILE_COUNT` ranked files — so this cap, not the membership test,
 * is what bounds the list.
 *
 * Eight because it is a reading ORDER someone is asked to follow to the end: the
 * design draws three (`specs/assets/SPEC-03-onboarding-tour.png`), and a "start
 * here" of twenty is the directory listing `MAX_PACKAGES` refuses for the same
 * reason. Grounding never reorders — the order is the model's judgement — so the
 * cut takes the tail, i.e. the end the model itself ranked last.
 */
export const MAX_READING_STEPS = 8;

/**
 * First tasks kept, and now the number the screen draws as well (AC-72).
 *
 * It was twelve, on the reasoning that the store may hold more than the screen
 * shows and the rest sits behind a disclosure. SPEC-04 § D15 closes that gap in
 * the other direction: every stored task carries steps, an impact line and a
 * verification line, so six detailed tasks are worth more than twelve headlines
 * — and the number stored equalling the number shown is what makes a "show more"
 * control unnecessary rather than merely unused.
 */
export const MAX_TASKS = 6;

/**
 * Actions kept in one first task.
 *
 * The plan's own number, and it exists for a failure mode the spec names in its
 * own edge case: grounding by membership is not a bound on the answer, so "one
 * path repeated in twenty steps" passes every check twenty times
 * (`server/INSIGHTS.md`). Six is the shape `MAX_COMMANDS_PER_PACKAGE` already
 * has, and it bounds what a first task can honestly ask of somebody's first
 * week; a task that needs a seventh step is a project, not a first task.
 */
export const MAX_TASK_STEPS = 6;

/**
 * Commands kept in one package block.
 *
 * The plan's own (R39). AC-19 requires one block per shown package, and AC-23 and
 * AC-25 decide WHICH commands survive — a script that exists in that package's
 * own manifest, a manager its own lock file dictates — but neither bounds how
 * many. Six is measured against the manifests this repository actually has:
 * `server/package.json` declares twelve scripts and `client/package.json` six, of
 * which someone arriving runs install, `db:migrate`, `dev`, `test` and perhaps
 * `lint`.
 *
 * Per PACKAGE and not per section deliberately: with `MAX_PACKAGES` the run
 * section is bounded at twelve blocks of six, and it is the block a reader copies
 * from, one line at a time.
 */
export const MAX_COMMANDS_PER_PACKAGE = 6;

/**
 * Repo-level setup commands kept — the `cp .env.example .env` and
 * `docker compose up …` class, which is not a script of any package.
 *
 * The plan's own (R39), and the same rule as the cap above for the same reason:
 * one list, copied one line at a time. The design draws two of them
 * (`specs/assets/SPEC-03-onboarding-tour.png`), so six is three times what the
 * source material shows.
 *
 * A repository with more authorised setup commands than this loses the tail
 * silently — unlike the package ceiling, whose overflow is disclosed by
 * `package_scan` (AC-90). That is a deliberate asymmetry, not an oversight: the
 * number of packages is a fact about the repository worth reporting, while these
 * commands are a model's selection out of what the config files authorise.
 */
export const MAX_SETUP_COMMANDS = 6;

/**
 * Environment variables kept across all config files.
 *
 * The plan's own (R39): AC-21 says a variable may be named only when a config
 * this run actually read names it — a membership rule with no count in it.
 *
 * Twelve is the size of a real one, and the measurement is this repository:
 * `server/.env.example` declares thirteen keys. So a project like this one sits
 * right at the ceiling and a longer config loses its tail — which is the accepted
 * price of a list that a reader fills in by hand rather than an inventory.
 * Across ALL config files rather than per file, because the reader has one `.env`
 * to write and the question is how long that list is, not how many files it was
 * gathered from.
 */
export const MAX_ENV_VARS = 12;

/**
 * Code points kept from one section `body`. Model markdown over untrusted
 * repository content, stored and re-served on every open, so it needs a ceiling
 * of its own — nothing upstream bounds the model's output length.
 */
export const MAX_BODY_CHARS = 6_000;

/**
 * Code points kept from the architecture diagram.
 *
 * The plan's own (R39): AC-71 says only the architecture section carries a
 * diagram and AC-80 says a section without one has the field absent — neither
 * bounds its length, and nothing upstream does either.
 *
 * Two thirds of `MAX_BODY_CHARS` because mermaid is denser than prose: one node
 * or one edge per line, so four thousand code points is a graph already far past
 * readable (the design's is six nodes and their edges, on the order of two
 * hundred — `specs/assets/SPEC-03-onboarding-tour.png`). It carries more weight than the
 * prose cap, not less: this source is rendered client-side into SVG, i.e. into
 * something executable in shape, and every node label is a string the model wrote
 * over untrusted repository content.
 */
export const MAX_DIAGRAM_CHARS = 4_000;

/**
 * Code points kept from every free string that is asked for as ONE LINE: a
 * section or flow title, a flow step note, a reading reason, a task title, a
 * task `why`, a command and its `why`, an env var name.
 */
export const MAX_LINE_CHARS = 200;
