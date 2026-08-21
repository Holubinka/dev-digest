import { z } from 'zod';

/**
 * Conformance, Onboarding, Eval, Memory, Conventions, Skills,
 * Agents and their DTOs.
 */

// ---- Conformance ----
export const ConformanceStatus = z.enum(['implemented', 'missing', 'out_of_scope']);
export type ConformanceStatus = z.infer<typeof ConformanceStatus>;

export const ConformanceItem = z.object({
  requirement: z.string(),
  status: ConformanceStatus,
  evidence_file: z.string().nullish(),
  notes: z.string().nullish(),
});
export type ConformanceItem = z.infer<typeof ConformanceItem>;

export const Conformance = z.object({
  spec_id: z.string(),
  spec_title: z.string(),
  items: z.array(ConformanceItem),
  completeness_pct: z.number().min(0).max(100),
});
export type Conformance = z.infer<typeof Conformance>;

// ---- Onboarding ----

/**
 * The five sections of a tour. THE ORDER OF THIS ENUM IS THE ORDER OF THE PAGE.
 *
 * Closed for the reason `ConventionCategory` further down this file is closed:
 * the page draws an icon per kind, builds its side navigation from the list and
 * fixes the order, and none of that holds on a free string. A `kind` outside
 * these five is REJECTED and counted, never normalised to the nearest member —
 * normalising is how a sixth section arrives wearing the name of a fifth.
 *
 * `routes_and_apis` and `gotchas` are the two names scaffolding written before
 * this feature still uses (`server/src/prompts/onboarding.system.md`,
 * `client/messages/en/onboarding.json`). Neither is a member: a response naming
 * one loses that section rather than gaining a sixth.
 */
export const OnboardingSectionKind = z.enum([
  'architecture',
  'critical_paths',
  'how_to_run',
  'reading_path',
  'first_tasks',
]);
export type OnboardingSectionKind = z.infer<typeof OnboardingSectionKind>;

/**
 * Whether a section has content. A section is never omitted — all five are
 * always present, in enum order — so `empty` is what keeps a place on the page
 * instead of collapsing the layout when one input was missing.
 */
export const OnboardingSectionState = z.enum(['ready', 'empty']);
export type OnboardingSectionState = z.infer<typeof OnboardingSectionState>;

/**
 * Why an empty section is empty, in the pipeline's own terms: the first four
 * name an input that was not there, the last names a model that answered
 * nothing for a section whose inputs were.
 *
 * The distinction is the point. "No import graph" is a fact about the
 * repository; "the model returned nothing" is a fact about the generation, and
 * only one of them is worth pressing the button again over.
 */
export const OnboardingEmptyReason = z.enum([
  'no_import_graph',
  'no_ranked_files',
  'no_packages',
  'no_tasks',
  'model_returned_nothing',
]);
export type OnboardingEmptyReason = z.infer<typeof OnboardingEmptyReason>;

/** One link on a section card. `path` is repo-relative and proven to exist. */
export const OnboardingLink = z.object({
  label: z.string(),
  path: z.string(),
});
export type OnboardingLink = z.infer<typeof OnboardingLink>;

export const OnboardingSection = z.object({
  kind: OnboardingSectionKind,
  /**
   * The model's own heading. STORED AND NEVER RENDERED: the page takes its
   * headings from `client/messages/*`, so the interface stays one language while
   * the tour body is another. Kept because it is evidence of what the model
   * thought the section was, which is worth having when a body reads oddly.
   */
  title: z.string(),
  /** Markdown, untrusted: model text over repository content. Never executed. */
  body: z.string(),
  /**
   * Mermaid, and ONLY on the `architecture` section.
   *
   * `.optional()` rather than `.nullable()`, and the two are different claims —
   * absent versus present-and-null. A section with no diagram has this key
   * ABSENT: not `""`, not `null`, not a placeholder body. An empty string is a
   * diagram that renders as a broken frame, which is worse than no frame, and a
   * consumer that checks `'diagram' in section` must get a truthful answer.
   */
  diagram: z.string().optional(),
  /**
   * At most four. The cap is applied after the parse, in grounding, never as a
   * Zod `.max()` — see the note on `OnboardingDraft` below.
   */
  links: z.array(OnboardingLink).default([]),
  /**
   * Paths that appear inside `body` AND were proven to exist in the clone. It is
   * what lets a renderer link a path in prose and leave an unverified one as
   * plain text; grounding never rewrites the body to make the two agree.
   */
  verified_paths: z.array(z.string()).default([]),
  state: OnboardingSectionState,
  /** `null` exactly when `state` is `ready`. Present either way — see the enum. */
  empty_reason: OnboardingEmptyReason.nullable(),
});
export type OnboardingSection = z.infer<typeof OnboardingSection>;

/** An ordered walk through one critical path. Every step is a file in the chains. */
export const OnboardingFlow = z.object({
  title: z.string(),
  steps: z.array(z.object({ path: z.string(), note: z.string() })).default([]),
});
export type OnboardingFlow = z.infer<typeof OnboardingFlow>;

export const OnboardingReadingStep = z.object({
  path: z.string(),
  reason: z.string(),
});
export type OnboardingReadingStep = z.infer<typeof OnboardingReadingStep>;

/**
 * Exactly three, closed for the same reason `OnboardingSectionKind` is: the card
 * paints a badge per value and the list filters on it. A value outside the three
 * REJECTS THE WHOLE TASK and is counted — it is never coerced to `medium` and
 * never defaulted. Two generations of one repository that wrote `medium` and
 * `Medium` would otherwise be two different values on one screen.
 */
export const OnboardingTaskComplexity = z.enum(['low', 'medium', 'high']);
export type OnboardingTaskComplexity = z.infer<typeof OnboardingTaskComplexity>;

/**
 * One action of a first task: what to do, and — when the step names them — the
 * file to do it in and the command that shows it worked.
 *
 * `path` and `command` are `.nullable()`, NOT `.optional()`, which is the
 * opposite call from `OnboardingSection.diagram` above and is deliberate. A step
 * is written by grounding, which decides both keys for every step it keeps, so
 * "this step names no file" is a value the step HAS rather than a key it lacks.
 * Null is also what a step whose path failed the existence check carries: the
 * step survives as plain text — "add a guard to the error handler" is useful
 * without a clickable path — while `unknown_path` counts the claim that did not
 * hold.
 *
 * `command` is null unless the string is VERBATIM one of the commands this
 * repository already grounded for the "How to run" section. It is never
 * repaired and never truncated to fit; this is the one field of a task that a
 * reader pastes into a shell.
 */
export const OnboardingTaskStep = z.object({
  text: z.string(),
  /** Repo-relative, proven to exist. `null` when the step names no file. */
  path: z.string().nullable(),
  /** A command already grounded for this repository. `null` when the step names none. */
  command: z.string().nullable(),
});
export type OnboardingTaskStep = z.infer<typeof OnboardingTaskStep>;

export const OnboardingTask = z.object({
  title: z.string(),
  path: z.string(),
  why: z.string(),
  complexity: OnboardingTaskComplexity,
  /**
   * The ordered actions, at most `MAX_TASK_STEPS`. The cap is applied after the
   * parse, in grounding, never as a Zod `.max()` — see the note on
   * `OnboardingDraft` below. Empty is a task the reader can still act on from
   * `why` alone, and the screen offers no window for it.
   */
  steps: z.array(OnboardingTaskStep).default([]),
  /**
   * What doing this task touches in this repository, in the model's own prose.
   *
   * NOT the blast radius `modules/repo-intel` calls `impact`. That one is a
   * graph fact — the dependents a changed file has, derived from the index and
   * countable. This one is a sentence about a task nobody has done yet, and
   * nothing verifies it beyond the length cut every single-line field takes. The
   * word is shared; the claim is not, and a reader who merges the two will trust
   * this field far more than it has earned.
   *
   * `''` when the model said nothing — see the default rule on `OnboardingDraft`.
   */
  impact: z.string().default(''),
  /** How the reader sees the task is done. `''` when the model said nothing. */
  verification: z.string().default(''),
});
export type OnboardingTask = z.infer<typeof OnboardingTask>;

export const OnboardingPackageManager = z.enum(['npm', 'pnpm', 'yarn', 'bun']);
export type OnboardingPackageManager = z.infer<typeof OnboardingPackageManager>;

/** One runnable command, tied to a `script` that exists in its package's manifest. */
export const OnboardingCommand = z.object({
  script: z.string(),
  command: z.string(),
  why: z.string(),
});
export type OnboardingCommand = z.infer<typeof OnboardingCommand>;

/**
 * One package's "how to run" block.
 *
 * `manager` is `null` when the lock files beside the manifest do not name one
 * manager — none, or two different ones. Null is the honest answer, not a
 * default: this block is copied off the screen and pasted into a shell, and the
 * root `AGENTS.md` says outright "do not mix". A block with `manager: null`
 * carries no install command and no commands at all.
 */
export const OnboardingPackageBlock = z.object({
  /** The manifest's `name`, or the directory when it has none. */
  name: z.string(),
  /** Repo-relative directory; `.` for the root package. */
  path: z.string(),
  manager: OnboardingPackageManager.nullable(),
  install_command: z.string().nullable(),
  commands: z.array(OnboardingCommand).default([]),
});
export type OnboardingPackageBlock = z.infer<typeof OnboardingPackageBlock>;

/**
 * One repo-level setup command: `cp .env.example .env`, `docker compose up -d …`.
 *
 * NOT a member of `OnboardingPackageBlock`, and that placement is the claim: these
 * are preconditions for EVERY package rather than a script of any one. An `.env`
 * is copied once per clone and a database is started once per clone, so a block
 * that repeated them per package would be telling a reader to do the same thing
 * five times. A repository with no `package.json` at all can still have setup
 * commands.
 *
 * `source_path` is THE FILE THAT AUTHORISES the command, and it is what makes the
 * command checkable rather than merely plausible: the `.env.example` a `cp` reads
 * from, the compose file a `docker compose` acts on. Grounding keeps the command
 * only when that file exists in the clone, and a compose command only when the
 * file declares every service the command names. Anything that cannot be
 * authorised is dropped and counted in `unknown_path`.
 *
 * This is the longest "someone else's text → a human's action" chain in the
 * feature: the command is shown with a copy control (AC-20) and the reader runs
 * it. So there is deliberately no `script` field — the whole point of this shape
 * is that a manifest key cannot authorise it and a file must — and no `order`
 * field: setup precedes the package blocks by the renderer's rule, and a number
 * stored here would be a second, staler copy of that decision.
 */
export const OnboardingSetupCommand = z.object({
  command: z.string(),
  why: z.string(),
  /** Repo-relative path of the authorising file. Proven to exist in the clone. */
  source_path: z.string(),
});
export type OnboardingSetupCommand = z.infer<typeof OnboardingSetupCommand>;

/** A variable named in a config file that this run actually read. */
export const OnboardingEnvVar = z.object({
  name: z.string(),
  source_path: z.string(),
});
export type OnboardingEnvVar = z.infer<typeof OnboardingEnvVar>;

/**
 * What the package walk did, so an incomplete list can say so.
 *
 * `found` counts packages the walk MATCHED, `shown` counts the ones that
 * survived the ceiling; `found - shown` is the number a reader is told about
 * rather than left to guess. `bounded` is the port's own signal that its file
 * limit cut the walk short.
 */
export const OnboardingPackageScan = z.object({
  depth: z.number().int().default(0),
  excluded_dirs: z.array(z.string()).default([]),
  found: z.number().int().default(0),
  shown: z.number().int().default(0),
  bounded: z.boolean(),
});
export type OnboardingPackageScan = z.infer<typeof OnboardingPackageScan>;

/**
 * Claims the model made that could not be confirmed, by reason. Exactly five,
 * and the five are the vocabulary: a counter with no name here does not exist.
 */
export const OnboardingDropped = z.object({
  /**
   * A path that failed sanitizing or was not found in the clone.
   *
   * It ALSO counts a setup command that could not be authorised: one whose
   * `source_path` does not exist, and a compose command naming a service the
   * compose file does not declare. Both are the same statement — the claim points
   * at something that is not there — which is what this counter has always meant.
   * A sixth counter would be the cleaner name and is not available: AC-40 fixes
   * these five, and the two sibling slices read exactly these five keys. Said
   * here in full rather than left implicit, because a counter that quietly covers
   * more than its name suggests is worse than one that says so.
   *
   * And a third statement of the same shape: an architecture diagram that is not
   * a drawing. `groundSections` accepts one grammar — a `flowchart`/`graph`
   * header and statements that draw a node or an edge — and drops anything else
   * whole. What that keeps out names a resource outside the clone: an image
   * mermaid fetches on paint, a link destination, CSS injected through a
   * directive.
   */
  unknown_path: z.number().int().default(0),
  /**
   * A command naming a script absent from the manifest of its own package.
   *
   * It ALSO counts a command inside a first task's step that is not one of this
   * repository's already-grounded commands — the step keeps its text and loses
   * the command. Same statement, one surface further on: the claim names
   * something this repository cannot run. The move `unknown_path`'s docstring
   * above already made for setup commands, made again here for the same reason
   * and with the same cost — five counters are fixed by AC-40 and two sibling
   * slices read exactly these names, so a sixth is not available.
   */
  unknown_script: z.number().int().default(0),
  /** A command whose manager is not the one that package's lock file dictates. */
  manager_mismatch: z.number().int().default(0),
  /** A task whose `complexity` was outside the three. */
  unknown_complexity: z.number().int().default(0),
  /** A section whose `kind` was outside the five. */
  unknown_section: z.number().int().default(0),
});
export type OnboardingDropped = z.infer<typeof OnboardingDropped>;

/**
 * Input blocks, in the priority order the budget walk drops them in reverse of.
 *
 * The order IS the priority, and this list is where it is stated: the record's
 * `inputs[]` is built by mapping over it, so the last row is always the one the
 * walk cuts first. A reader of "what went into this tour" can therefore explain a
 * `dropped` row from its position alone.
 *
 * `project_docs` sits ABOVE `file_samples` by a decision of 2026-08-18, which
 * reversed the pair D13 originally fixed. Measured on a real clone, twenty
 * samples took 17 964 of ~22 000 block tokens and the documents — last, and
 * offered whole — were `dropped` on every generation, so the tour was written
 * having read neither the repository's own README nor any package's. Divergence
 * from the spec, recorded rather than back-written into it.
 */
export const OnboardingInputId = z.enum([
  'repo_map',
  'package_configs',
  'critical_paths',
  'project_docs',
  'file_samples',
]);
export type OnboardingInputId = z.infer<typeof OnboardingInputId>;

/** `missing` is "there was nothing to include"; `dropped` is "it did not fit". */
export const OnboardingInputStatus = z.enum(['included', 'truncated', 'dropped', 'missing']);
export type OnboardingInputStatus = z.infer<typeof OnboardingInputStatus>;

export const OnboardingInput = z.object({
  id: OnboardingInputId,
  status: OnboardingInputStatus,
  tokens: z.number().int().default(0),
  detail: z.string().nullable(),
  /**
   * The items of a per-item input that did not ship, by label — a sample's path,
   * a document's path, a chain's label (AC-54).
   *
   * `detail` says HOW MANY arrived ("18 of 19 files"); this says WHICH did not,
   * and only a per-item input can answer it: an input offered whole is either
   * `included` or `dropped`, so both arrays stay empty for it.
   */
  omitted: z.array(z.string()).default([]),
  /**
   * The documents a per-document ceiling cut before fencing, by path (AC-55).
   *
   * Distinct from `omitted`: a shortened document DID ship, with its tail gone,
   * so a claim the tour makes about it may rest on text the model never saw.
   */
  shortened: z.array(z.string()).default([]),
});
export type OnboardingInput = z.infer<typeof OnboardingInput>;

/**
 * Which counter answered. `heuristic` means ceil(chars/4), not the encoder.
 *
 * A DELIBERATE DUPLICATE of `RiskBriefTokenizer` (`contracts/brief.ts`), not an
 * oversight and not a candidate for reuse-by-import: naming another feature's
 * type here would make this record's meaning depend on the Risk Brief's future.
 * One repository-wide `TokenizerId` is a real option, and it is a rename across
 * both records and both vendored copies — a separate change, not a side effect
 * of this one.
 */
export const OnboardingTokenizer = z.enum(['cl100k_base', 'heuristic']);
export type OnboardingTokenizer = z.infer<typeof OnboardingTokenizer>;

/** The tour itself: what a reader sees. Every path in here exists in the clone. */
export const Onboarding = z.object({
  /** Always five, in `OnboardingSectionKind` order, empty ones included. */
  sections: z.array(OnboardingSection).default([]),
  flows: z.array(OnboardingFlow).default([]),
  reading_path: z.array(OnboardingReadingStep).default([]),
  tasks: z.array(OnboardingTask).default([]),
  /**
   * Repo-level preconditions, each authorised by a file that exists. They are a
   * sibling of `packages`, not part of it: a clone is prepared once, then each
   * package is run. Empty when nothing in the clone authorised one — never a
   * guessed `npm install` (AC-24).
   */
  setup_commands: z.array(OnboardingSetupCommand).default([]),
  packages: z.array(OnboardingPackageBlock).default([]),
  env_vars: z.array(OnboardingEnvVar).default([]),
  /**
   * `true` when the env list was cut at its ceiling and the tail is not here.
   *
   * The FORM is borrowed, not invented: `sample_truncated` on `OnboardingDraft`
   * below makes exactly this claim about the file samples, and `package_scan`
   * makes a richer version of it with `found` against `shown`. All three serve
   * the one rule this feature holds about every ceiling — what was cut is SEEN,
   * never silently absent (AC-86, AC-90).
   *
   * It is required rather than optional, and that is the whole value of the
   * field: an absent boolean reads as "nothing was cut" to every consumer, so a
   * record that forgot to set it would be indistinguishable from a complete list
   * — which is the exact silence it exists to remove. It sits in the content half
   * because it is drawn for a reader, not logged for an operator; the list it
   * describes is the one someone copies into their own `.env`.
   */
  env_vars_truncated: z.boolean(),
});
export type Onboarding = z.infer<typeof Onboarding>;

/**
 * What one generation PRODUCES: the tour, what was dropped getting there, what
 * the model was shown, and the numbers of the one call it made.
 *
 * IT CARRIES NO STAMP, AND THAT IS THE DESIGN. There is no `generated_at` and no
 * `index_state` here, because the pipeline neither times nor gates: it does not
 * read the index state and it writes nothing. The slice that persists declares
 * `OnboardingRecord = OnboardingDraft.extend({ generated_at, index_state })` in
 * its own file, and that `.extend()` is collision-free BY CONSTRUCTION rather
 * than by agreement — this shape owns neither key, so there is nothing for the
 * extension to silently overwrite. Adding either key here would take that
 * property away without failing a type check anywhere, in either package.
 *
 * No bound is stated on any array or string in this file. Every cap this feature
 * has — links per section, tasks, flows, body characters — is a constant in
 * `modules/onboarding/constants.ts`, applied in code after the parse. Two
 * reasons, both load-bearing: `toJsonSchema` renders a Zod bound as
 * `maxItems`/`maximum` and Anthropic's structured-output subset rejects both
 * (`server/INSIGHTS.md`, "Anthropic's structured-output API rejects a Zod schema
 * that states a bound"), and a bound in the schema fails the WHOLE response
 * where a cap in code drops one item and counts it.
 *
 * EVERY COUNT AND EVERY ARRAY HERE CARRIES AN EMPTY `.default()` — `0` and
 * `[]` — and so does every one in the shapes above, which this one contains.
 * The obligation belongs to the READ path rather than the write: a tour is
 * stored in a `jsonb` column and re-parsed on the way back out
 * (`modules/onboarding/repository.ts`), so the day a field is ADDED here, every
 * document written before it stops parsing. Nothing crashes — the repository
 * degrades a failed parse to `null` — but `null` means "nothing saved yet,
 * press Generate", and it would mean it about a tour that is whole in the
 * database and was paid for once. With a default, the same addition reads as
 * zero on the old documents and true on the new ones (`server/INSIGHTS.md`, "A
 * jsonb column is untyped input: parse it on read, or `.default()` never
 * fires"; "Parsing a stored jsonb document on read makes every removed contract
 * field a 422").
 *
 * THE DEFAULT IS EMPTY, NEVER PLAUSIBLE. An absent counter is zero events, not
 * an estimate of how many there were. Strings, booleans and the nullable enums
 * take none, and that is the same rule rather than an exception to it: there is
 * no empty body, and `env_vars_truncated` above says at length why an absent
 * boolean reading as `false` is the one silence this feature cannot afford. A
 * defaulted `title` or `body` would turn a section that failed to generate into
 * one that generated nothing to say.
 *
 * `impact` and `verification` on `OnboardingTask` take `''` and do NOT break
 * that rule, which is worth stating because they look like the case it refuses.
 * The refusal is about a field the generation was ASKED for and failed to
 * produce; those two were never asked for at all in a tour written before
 * SPEC-04, so `''` is not a stand-in for a lost value — it IS the value, "this
 * task states nothing about what it touches". The window omits an empty one
 * rather than drawing a heading over nothing, which is the same distinction one
 * layer up.
 */
export const OnboardingDraft = Onboarding.extend({
  package_scan: OnboardingPackageScan,
  inputs: z.array(OnboardingInput).default([]),
  dropped: OnboardingDropped,
  sample_files: z.number().int().default(0),
  sample_truncated: z.boolean(),
  /** How many critical-path chains were offered to the model (AC-20). */
  chains_supplied: z.number().int().default(0),
  /** Files in the longest chain offered — the reach of the supply, not of the answer. */
  longest_chain_files: z.number().int().default(0),
  /** The budget this generation ran under: computed from `files_indexed`, not a constant. */
  budget: z.number().int().default(0),
  input_tokens_counted: z.number().int().default(0),
  /**
   * The system prompt's tokens, counted apart from the blocks' (AC-40).
   *
   * Separate because only one of the two is steerable: `input_tokens_counted`
   * moves when the budget walk drops a block, this moves only when the prompt
   * file is edited. Summed together they would hide which one grew.
   */
  system_tokens: z.number().int().default(0),
  /** Read AFTER counting: the encoder only learns it is broken by failing one. */
  tokenizer: OnboardingTokenizer,
  attempts: z.number().int().default(0),
  tokens_in: z.number().int().default(0),
  /** Wall-clock milliseconds of the model call, measured around it (AC-43). */
  duration_ms: z.number().int().default(0),
  provider: z.string(),
  model: z.string(),
  /**
   * `null`, not `0`, is this field's empty: the provider that reports no price
   * and the generation that was free are different facts, and only one of them
   * is worth `0.00` on a screen.
   */
  cost_usd: z.number().nullable().default(null),
});
export type OnboardingDraft = z.infer<typeof OnboardingDraft>;

// ---- Eval ----
export const EvalPerTrace = z.object({
  name: z.string(),
  pass: z.boolean(),
  expected: z.unknown(),
  actual: z.unknown(),
});
export type EvalPerTrace = z.infer<typeof EvalPerTrace>;

export const EvalRun = z.object({
  recall: z.number().min(0).max(1),
  precision: z.number().min(0).max(1),
  citation_accuracy: z.number().min(0).max(1),
  traces_passed: z.number().int(),
  traces_total: z.number().int(),
  duration_ms: z.number().int(),
  cost_usd: z.number().nullable(),
  per_trace: z.array(EvalPerTrace),
});
export type EvalRun = z.infer<typeof EvalRun>;

export const EvalOwnerKind = z.enum(['skill', 'agent']);
export type EvalOwnerKind = z.infer<typeof EvalOwnerKind>;

export const EvalCase = z.object({
  id: z.string(),
  owner_kind: EvalOwnerKind,
  owner_id: z.string(),
  name: z.string(),
  input_diff: z.string(),
  input_files: z.unknown(),
  input_meta: z.unknown(),
  expected_output: z.unknown(),
  notes: z.string().nullish(),
});
export type EvalCase = z.infer<typeof EvalCase>;

// ---- Memory ----
export const MemoryScope = z.enum(['repo', 'global', 'team']);
export type MemoryScope = z.infer<typeof MemoryScope>;

export const MemoryKind = z.enum([
  'decision',
  'convention',
  'preference',
  'fact',
  'learning',
]);
export type MemoryKind = z.infer<typeof MemoryKind>;

export const MemorySource = z.object({
  pr: z.number().int().nullish(),
  context: z.string(),
});
export type MemorySource = z.infer<typeof MemorySource>;

export const MemoryItem = z.object({
  content: z.string(),
  scope: MemoryScope,
  kind: MemoryKind,
  confidence: z.number().min(0).max(1),
  sources: z.array(MemorySource),
});
export type MemoryItem = z.infer<typeof MemoryItem>;

// ---- Skills ----
export const SkillType = z.enum(['rubric', 'convention', 'security', 'custom']);
export type SkillType = z.infer<typeof SkillType>;

// Where a body came from. `imported_file` and `imported_url` are user uploads;
// `extracted` means the product derived the body from a repo, so do not reach
// for it just because an import happened.
export const SkillSource = z.enum([
  'manual',
  'imported_file',
  'imported_url',
  'extracted',
  'community',
]);
export type SkillSource = z.infer<typeof SkillSource>;

export const Skill = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  type: SkillType,
  source: SkillSource,
  body: z.string(),
  enabled: z.boolean(),
  version: z.number().int(),
  evidence_files: z.array(z.string()).nullish(),
});
export type Skill = z.infer<typeof Skill>;

export const CommunitySkill = z.object({
  name: z.string(),
  repo: z.string(),
  stars: z.number().int(),
  lang: z.string(),
  desc: z.string(),
});
export type CommunitySkill = z.infer<typeof CommunitySkill>;

// ---- Conventions ----

/**
 * Closed taxonomy. The extraction prompt hands the model this list and rejects
 * anything outside it, so two scans of the same repo group the same way and the
 * UI can filter without normalising free text.
 */
export const ConventionCategory = z.enum([
  'naming',
  'structure',
  'error-handling',
  'async',
  'typing',
  'testing',
  'api',
  'imports',
  'logging',
  'docs',
]);
export type ConventionCategory = z.infer<typeof ConventionCategory>;

export const ConventionStatus = z.enum(['pending', 'accepted', 'rejected']);
export type ConventionStatus = z.infer<typeof ConventionStatus>;

/** One place in the repo that backs a rule, verified against the clone. */
export const ConventionEvidence = z.object({
  path: z.string(),
  line: z.number().int(),
  end_line: z.number().int(),
  snippet: z.string(),
});
export type ConventionEvidence = z.infer<typeof ConventionEvidence>;

/**
 * A candidate house rule. `evidence` is the site shown on the card; the rest
 * sit in `extra_evidence`. Both are verified — a claimed site that could not be
 * found in the clone never reaches this shape.
 *
 * `head_sha` is the commit the evidence was read at, which is what lets the UI
 * build a GitHub blob link whose line numbers still mean something.
 */
export const ConventionCandidate = z.object({
  id: z.string(),
  repo_id: z.string().nullable(),
  scan_id: z.string().nullable(),
  category: ConventionCategory,
  rule: z.string(),
  evidence_path: z.string().nullable(),
  evidence_snippet: z.string().nullable(),
  evidence_line: z.number().int().nullable(),
  evidence_end_line: z.number().int().nullable(),
  extra_evidence: z.array(ConventionEvidence),
  head_sha: z.string().nullable(),
  confidence: z.number().min(0).max(1).nullable(),
  status: ConventionStatus,
  created_at: z.string(),
});
export type ConventionCandidate = z.infer<typeof ConventionCandidate>;

/** One extraction run: what it read, what it cost, what survived grounding. */
export const ConventionScan = z.object({
  id: z.string(),
  repo_id: z.string(),
  head_sha: z.string().nullable(),
  model: z.string(),
  sample_files: z.number().int(),
  candidates_returned: z.number().int(),
  candidates_kept: z.number().int(),
  created_at: z.string(),
});
export type ConventionScan = z.infer<typeof ConventionScan>;

/** `GET /repos/:id/conventions` and the body of a finished extraction. */
export const ConventionsResponse = z.object({
  scan: ConventionScan.nullable(),
  candidates: z.array(ConventionCandidate),
});
export type ConventionsResponse = z.infer<typeof ConventionsResponse>;

// ---- Agents ----
// 'openrouter' routes through the OpenAI-compatible API (OpenAIProvider with a
// custom baseURL) — used by the CI runner for cheap models (DeepSeek/GLM/MiniMax).
export const Provider = z.enum(['openai', 'anthropic', 'openrouter']);
export type Provider = z.infer<typeof Provider>;

// Review execution strategy (matches @devdigest/reviewer-core's ReviewStrategy):
//  - single-pass: send the WHOLE diff in ONE model call (default)
//  - map-reduce:  one model call PER changed file (for very large diffs)
//  - auto:        single-pass, switching to map-reduce when the diff is large
export const ReviewStrategy = z.enum(['single-pass', 'map-reduce', 'auto']);
export type ReviewStrategy = z.infer<typeof ReviewStrategy>;

// CI gate policy — when a review should BLOCK (REQUEST_CHANGES + fail the check)
// vs just comment. Deterministic from finding severities, NOT the model's verdict:
//  - never:    never block, always comment (advisory only)
//  - critical: block iff >=1 CRITICAL finding (default)
//  - warning:  block iff >=1 WARNING or CRITICAL finding
//  - any:      block iff >=1 finding of any severity
export const CiFailOn = z.enum(['never', 'critical', 'warning', 'any']);
export type CiFailOn = z.infer<typeof CiFailOn>;

export const Agent = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  provider: Provider,
  model: z.string(),
  system_prompt: z.string(),
  output_schema: z.unknown().nullish(),
  enabled: z.boolean(),
  version: z.number().int(),
  strategy: ReviewStrategy.default('single-pass'),
  ci_fail_on: CiFailOn.default('critical'),
  // Inject repo-intel context (repo skeleton + callers + rank note) into this
  // agent's review prompt. Default on; gated again by the global flag.
  repo_intel: z.boolean().default(true),
});
export type Agent = z.infer<typeof Agent>;

/**
 * A row in the Agents list: an agent plus how many skills it binds.
 *
 * The mirror image of `SkillListItem.agent_count`, and derived the same way —
 * counted from `agent_skills` on every read rather than stored. A binding moves
 * in the agent's Skills tab, and a persisted counter would be a second source of
 * truth to keep in step with the link table.
 *
 * `GET /agents/:id` still returns a plain `Agent`: only the card shows the
 * count, and the card is always rendered from the list.
 */
export const AgentListItem = Agent.extend({ skill_count: z.number().int() });
export type AgentListItem = z.infer<typeof AgentListItem>;

export const AgentSkillLink = z.object({
  agent_id: z.string(),
  skill_id: z.string(),
  order: z.number().int(),
});
export type AgentSkillLink = z.infer<typeof AgentSkillLink>;

// The immutable config snapshot captured in `agent_versions` whenever an agent's
// config changes (everything but `enabled`). Mirrors the shape written by the
// agents repository — provider/model/prompt/output_schema/strategy/gate/repo_intel
// plus the ordered skill ids linked at snapshot time. Used for reproducibility
// (eval replays a past version) and for surfacing an agent's edit history.
export const AgentVersionConfig = z.object({
  provider: Provider,
  model: z.string(),
  system_prompt: z.string(),
  output_schema: z.unknown().nullish(),
  strategy: ReviewStrategy,
  ci_fail_on: CiFailOn,
  repo_intel: z.boolean(),
  skills: z.array(z.string()),
});
export type AgentVersionConfig = z.infer<typeof AgentVersionConfig>;

export const AgentVersion = z.object({
  agent_id: z.string(),
  version: z.number().int(),
  config: AgentVersionConfig,
  created_at: z.string(),
});
export type AgentVersion = z.infer<typeof AgentVersion>;
