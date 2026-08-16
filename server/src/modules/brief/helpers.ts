import {
  BlastIndexStatus,
  IntentFreshness,
  ReviewFocusItem,
  Risk,
  RiskBriefInput,
  RiskBriefInputId,
  RiskBriefRefLine,
  RiskBriefTokenizer,
  type BlastRadiusView,
  type RiskBrief,
  type RiskBriefRecord,
  type RiskBriefRefLineSource,
} from '@devdigest/shared';
import { escapeUntrusted, wrapUntrusted } from '../../platform/prompt.js';
import { truncateCodePoints } from '../_shared/repo-paths.js';
import { selectWithinBudget } from '../_shared/budget.js';
import type { PrBriefRow } from '../../db/rows.js';
import type { BriefBlock, BriefFit, BriefSources } from './types.js';
import {
  MAX_BLAST_CALLERS,
  MAX_BLAST_ENDPOINTS,
  MAX_BLAST_FACT_CHARS,
  MAX_BLAST_PART_CHARS,
  MAX_BLAST_SYMBOLS,
  MAX_FILE_PATH_CHARS,
  MAX_DROPPED_REFS,
  MAX_INTENT_CHARS,
  MAX_ISSUE_BODY_CHARS,
  MAX_ISSUE_TITLE_CHARS,
  MAX_LINE_CHARS,
  MAX_PR_BODY_CHARS,
  MAX_PR_TITLE_CHARS,
  MAX_PROSE_CHARS,
  MAX_REVIEW_FOCUS,
  MAX_RISK_FILE_REFS,
  MAX_RISKS,
} from './constants.js';

/**
 * brief — pure transforms. Nothing here calls anything: no clock, no filesystem,
 * no database, no tokenizer. `count` is always a parameter, so every rule below
 * is unit-testable with `count: s => s.length`.
 */

/**
 * Bullets are `*`, never `-`, and no line ever starts with `+`.
 *
 * Not cosmetic. AC-17 says no hunk and no patch body reaches this prompt, and
 * the cheapest way to check that from the outside is "no line of the assembled
 * input looks like a diff line". A markdown `- ` bullet makes that check
 * impossible to write, so this file does not use one.
 */
const BULLET = '*';

/* ------------------------------------------------------------------ blocks */

/**
 * One block per PRESENT input, in priority order, each carrying the references
 * its own text puts in front of the model.
 *
 * `specs` is the one id that may appear on more than one block: the elastic
 * budget walk works per file, so each spec file is its own candidate and its own
 * `refs: [path]`. Every other input is included whole or dropped whole.
 *
 * EVERY cap is applied BEFORE `wrapUntrusted` (`modules/intent/helpers.ts:152-154`):
 * truncating a wrapped block cuts the closing `</untrusted>` fence, and untrusted
 * content that can close its own fence speaks as the prompt.
 */
export function buildBlocks(sources: BriefSources): BriefBlock[] {
  const blocks: BriefBlock[] = [];

  blocks.push(diffStatsBlock(sources));

  if (sources.intent) {
    const text = truncateCodePoints(renderIntent(sources.intent), MAX_INTENT_CHARS);
    blocks.push({
      id: 'intent',
      text: `## Derived intent\n${wrapUntrusted('derived-intent', text)}`,
      // Prose, not references: the intent names areas, not files we can vouch for.
      refs: [],
      detail: `derived ${sources.intent.computed_at}`,
    });
  }

  if (sources.blast) blocks.push(blastBlock(sources.blast));

  const prText = prTextBlock(sources);
  if (prText) blocks.push(prText);

  if (sources.linkedIssue) {
    const issue = sources.linkedIssue;
    const title = truncateCodePoints(issue.title, MAX_ISSUE_TITLE_CHARS);
    const body = truncateCodePoints(issue.body ?? '', MAX_ISSUE_BODY_CHARS);
    blocks.push({
      id: 'linked_issue',
      text: `## Linked issue\n${wrapUntrusted('linked-issue', `#${issue.number} (${issue.state}) ${title}\n${body}`)}`,
      refs: [],
      detail: `#${issue.number}`,
    });
  }

  for (const spec of sources.specs) {
    // ESCAPED HERE, per file, not by the section's own `wrapUntrusted`.
    //
    // The specs are the one input `fitToBudget` measures BEFORE wrapping — every
    // other block is wrapped in this function and counted afterwards — and the
    // escape is not length-preserving. Measured 2026-08-16 with the real encoder
    // and the real 914-token system prompt: three spec files of repeated
    // `</untrusted>` count 4521 tokens raw and ship as 6021, i.e. 9202 against a
    // budget of 8000. `escapeUntrusted` is idempotent, so the fence added after
    // the cut finds nothing left to rewrite and the walk counts what is sent.
    //
    // Both parts are escaped separately and composed afterwards, so `refs` holds
    // the string the block PRINTS whatever the path contains — the asymmetry
    // logged in `server/INSIGHTS.md` ("registered in one form and printed in
    // another") cannot arise for this input. In practice the path is unchanged:
    // `sanitizeMarkdownRepoPath`'s character class has no `<` or `>`.
    const path = escapeUntrusted(spec.path);
    blocks.push({
      id: 'specs',
      // INNER text: `fitToBudget` wraps the survivors in one `plan-spec` fence.
      // The path leads the section on purpose — a prefix cut keeps it, which is
      // what makes a truncated spec still able to vouch for its own path.
      text: `### ${path}\n${escapeUntrusted(spec.text)}`,
      refs: [path],
      detail: path,
    });
  }

  return blocks;
}

/**
 * Counts and paths, never content (R17).
 *
 * `refs` is the list of paths this block PRINTS, which on a 400-file PR is the
 * first 40 and not the other 360. `pr_files.patch` is not read on this path at
 * all — the repository never selects it.
 *
 * `keep` is what makes this the ONE ELASTIC FIXED BLOCK. It is exempt from
 * `DROP_ORDER` — a brief with no idea what changed is a different answer, not a
 * degraded one — and until 2026-08-16 exempt also meant unbounded: the caps are
 * `MAX_FILE_PATHS` paths of `MAX_FILE_PATH_CHARS` CODE POINTS, and code points
 * are not tokens. 40 x 400 ASCII is 3167 tokens on the real encoder, 40 x 400
 * U+2A6B2 is 64949 — 8.1x a budget this feature states it holds, with every
 * other block already dropped and nothing left to refuse it. `fitToBudget`
 * therefore re-renders this block from fewer paths instead, and the `(N further
 * …)` line and `refs` follow the shorter list because both are computed from it.
 */
function diffStatsBlock(sources: BriefSources, keep = sources.filePaths.length): BriefBlock {
  const paths = sources.filePaths
    .slice(0, Math.max(keep, 0))
    .map((p) => truncateCodePoints(p, MAX_FILE_PATH_CHARS));
  const lines = [
    `${sources.diff.files} file(s) changed, ${sources.diff.additions} insertion(s), ${sources.diff.deletions} deletion(s).`,
  ];
  if (paths.length > 0) {
    lines.push('', 'Changed files:', ...paths.map((p) => `${BULLET} ${p}`));
  }
  if (sources.diff.files > paths.length) {
    lines.push('', `(${sources.diff.files - paths.length} further changed file(s) not listed.)`);
  }
  return {
    id: 'diff_stats',
    text: `## Changed files\n${wrapUntrusted('diff-stats', lines.join('\n'))}`,
    refs: paths,
    detail: `${paths.length} path(s) of ${sources.diff.files}`,
    shrink: (n: number) => diffStatsBlock(sources, n),
  };
}

/**
 * The fact list, and its own refs.
 *
 * Every name the block prints is a member: each listed symbol's file, each
 * listed caller's file, and each listed endpoint's file AND label. The label is
 * a member because `ReviewFocusItem.kind` has an `endpoint` branch — a focus
 * item may legitimately name `POST /pulls/:id/brief`, and it can only do so if
 * this block put that string in front of the model.
 *
 * `view.changed_files` is NOT a member, and that is the point. This block never
 * prints it — only status, commit, totals and the first `MAX_BLAST_SYMBOLS`
 * symbols — while `BlastRepository.getChangedFiles` has no limit at all. Seeding
 * from it licensed every changed path on a PR bigger than `MAX_FILE_PATHS`: 170
 * files against a 40-path cap on the one PR this feature has been run against,
 * i.e. 130 paths the model could name without ever having been shown them.
 * `diff_stats` prints its capped list and is the sole source of changed-file refs.
 *
 * EVERY VARIABLE PART IS CLAMPED BEFORE THE LINE IS ASSEMBLED, never after, and
 * `refs` holds the clamped string rather than the source one. That is what makes
 * the refs and the text unable to disagree, and until 2026-08-16 this comment
 * claimed it while the code did the opposite: `refs.add(symbol.file)` ran and
 * `clamp()` then cut the line the path sat in, so a view with one 500-code-point
 * symbol name licensed four names the prompt never printed. Two caps therefore,
 * not one — `MAX_BLAST_PART_CHARS` per part, and `MAX_BLAST_FACT_CHARS` as the
 * line ceiling their sum stays under. The count caps are the other half: a symbol
 * past `MAX_BLAST_SYMBOLS` contributes neither line nor refs.
 *
 * `test/brief-allowed-refs.test.ts` asserts the invariant itself over a hostile
 * view. It is not maintained by reading this paragraph.
 *
 * THE LINE NUMBERS COME FROM HERE AND FROM NOWHERE ELSE (R14). Each of the three
 * structures this function walks carries its own `line` on `BlastRadiusView`
 * (`contracts/blast.ts:41,54,77`), recorded by the indexer against `link_sha`, so
 * a number collected here is a number something measured. The model is shown none
 * of them — the rendered text is byte-identical to what it was before `refLines`
 * existed — and `RiskBrief` has no field one could arrive in (AC-57).
 *
 * FIRST OCCURRENCE OF A PATH WINS, in the order this block prints its facts, so
 * the number a reader is shown is the one carried by the first fact they read
 * about that file. A path that is both a caller and a symbol gets the symbol's
 * line, because the symbol line is printed first.
 *
 * An endpoint LABEL gets no entry. It is a member of the allowed set — a focus
 * item may legitimately name `POST /pulls/:id/brief` — but it is not a path, and
 * `POST /pulls/:id/brief:45` is not a thing that exists.
 *
 * A NON-POSITIVE LINE IS NOT A LINE, and this is the one rule the plan's step did
 * not name because nothing in a fixture carries one. Against the real index of
 * this repository on 2026-08-16, ALL 125 endpoints of the blast answer for PR #20
 * report `line: 0` — the indexer knows the file an endpoint is in and not the
 * offset, and it spells that `0`. Storing it would put `path:0` on the card, which
 * is a placeholder wearing a number: AC-62 admits a suffix only where the number
 * is "known and valid", AC-60 forbids a placeholder outright, and the client's own
 * definition of a usable line (`/^[1-9][0-9]{0,6}$/`) rejects it one layer later —
 * so the text would claim a line the jump then refuses to go to. A file whose
 * first fact carries no usable number may still get one from a LATER fact, which
 * is why the guard sits inside `noteLine` rather than around the loop.
 */
function blastBlock(view: BlastRadiusView): BriefBlock {
  const refs = new Set<string>();
  const refLines = new Map<string, RiskBriefRefLine>();
  const noteLine = (ref: string, line: number, source: RiskBriefRefLineSource) => {
    if (line > 0 && !refLines.has(ref)) refLines.set(ref, { ref, line, source });
  };
  const lines = [
    `Index status: ${view.status}${view.reason ? ` (${clamp(view.reason)})` : ''}`,
    `Index commit: ${view.link_sha ?? 'unknown'}${view.index_matches_head ? '' : ' (NOT the PR head)'}`,
    `Totals: ${view.totals.symbols} symbol(s), ${view.totals.callers} caller(s), ${view.totals.endpoints} endpoint(s), ${view.totals.crons} cron(s)`,
  ];

  if (view.symbols.length === 0) {
    lines.push('', 'No changed symbols were resolved in the index.');
  } else {
    lines.push('', 'Changed symbols and what reaches them:');
    for (const symbol of view.symbols.slice(0, MAX_BLAST_SYMBOLS)) {
      const file = part(symbol.file);
      refs.add(file);
      noteLine(file, symbol.line, 'blast_symbol');
      lines.push(
        `${BULLET} ${part(symbol.name)} (${part(symbol.kind)}) in ${file} — ${symbol.caller_count} caller(s)`,
      );
      for (const caller of symbol.callers.slice(0, MAX_BLAST_CALLERS)) {
        const callerFile = part(caller.file);
        refs.add(callerFile);
        noteLine(callerFile, caller.line, 'blast_caller');
        lines.push(`    called by ${part(caller.symbol)} in ${callerFile}`);
      }
      for (const endpoint of symbol.endpoints.slice(0, MAX_BLAST_ENDPOINTS)) {
        const label = part(endpoint.label);
        const endpointFile = part(endpoint.file);
        refs.add(endpointFile);
        refs.add(label);
        noteLine(endpointFile, endpoint.line, 'blast_endpoint');
        lines.push(
          `    reaches ${endpoint.kind === 'http' ? 'endpoint' : 'cron'} ${label} in ${endpointFile}`,
        );
      }
    }
    if (view.symbols.length > MAX_BLAST_SYMBOLS) {
      lines.push(`(${view.symbols.length - MAX_BLAST_SYMBOLS} further symbol(s) not listed.)`);
    }
  }

  return {
    id: 'blast',
    text: `## Blast radius\n${wrapUntrusted('blast-facts', lines.join('\n'))}`,
    refs: [...refs],
    refLines: [...refLines.values()],
    detail: view.status,
  };
}

/** Title and body are one input with two labels: they are two different kinds of author text. */
function prTextBlock(sources: BriefSources): BriefBlock | null {
  const parts: string[] = [];
  if (sources.title.trim().length > 0) {
    parts.push(wrapUntrusted('pr-title', truncateCodePoints(sources.title, MAX_PR_TITLE_CHARS)));
  }
  if (sources.body && sources.body.trim().length > 0) {
    parts.push(wrapUntrusted('pr-body', truncateCodePoints(sources.body, MAX_PR_BODY_CHARS)));
  }
  if (parts.length === 0) return null;
  return {
    id: 'pr_text',
    text: `## Pull request\n${parts.join('\n')}`,
    refs: [],
    detail: sources.body && sources.body.trim().length > 0 ? 'title and body' : 'title only',
  };
}

/** The whole line — only for a line that carries no reference. `view.reason` is the one. */
function clamp(line: string): string {
  return truncateCodePoints(line, MAX_BLAST_FACT_CHARS);
}

/** One interpolated part of a fact line, clamped BEFORE the line exists. */
function part(text: string): string {
  return truncateCodePoints(text, MAX_BLAST_PART_CHARS);
}

function renderIntent(intent: {
  intent: string;
  in_scope: string[];
  out_of_scope: string[];
  risk_areas: string[];
  confidence: string;
}): string {
  const bullets = (items: string[]) =>
    items.length > 0 ? items.map((item) => `${BULLET} ${item}`).join('\n') : `${BULLET} (none stated)`;
  return [
    `Goal: ${intent.intent}`,
    `Confidence: ${intent.confidence}`,
    `In scope:\n${bullets(intent.in_scope)}`,
    `Out of scope:\n${bullets(intent.out_of_scope)}`,
    `Risk areas:\n${bullets(intent.risk_areas)}`,
  ].join('\n\n');
}

/* ------------------------------------------------------------------ budget */

/** The section the surviving spec files are wrapped in — ONE fence, built after the cut. */
function renderSpecsSection(inner: string): string {
  return `## Linked plan / spec\n${wrapUntrusted('plan-spec', inner)}`;
}

/**
 * Reverse priority. Diff stats are absent on purpose: they are never dropped,
 * because a brief with no idea what changed is not a degraded brief, it is a
 * different answer. Exempt from DROPPING is not exempt from the budget — see
 * `shrinkToBudget`.
 */
const DROP_ORDER = ['linked_issue', 'pr_text', 'blast', 'intent'] as const;

/**
 * Fit the blocks to `budget`, and say what happened to each (R18, R20).
 *
 * THREE mechanisms, because AC-18 says the assembled input never exceeds the
 * budget and AC-20 says an over-budget input is cut before the call:
 *
 *   1. the four droppable fixed blocks go whole, in reverse priority — a block
 *      that is half present is a block whose references cannot be trusted;
 *   2. `diff_stats`, which the drop order may not touch, is re-rendered from a
 *      shorter path list. This is the step that makes the number a BOUND rather
 *      than an intention: without it the walk could drop every other block and
 *      still hand `run()` a diff-stats block of any size, and `run()` records
 *      the overflow without refusing it;
 *   3. the specs get the one cut point inside a document: `selectWithinBudget`
 *      takes them in order, stops at the first that does not fit, and truncates
 *      the first one only when it alone exceeds the remainder.
 *
 * `systemTokens` is subtracted first because AC-18 counts the whole first
 * assembled input — system and user together — not just the part this function
 * builds.
 */
export function fitToBudget(
  blocks: BriefBlock[],
  systemTokens: number,
  budget: number,
  count: (text: string) => number,
): BriefFit {
  const fixed = blocks.filter((b) => b.id !== 'specs');
  const specs = blocks.filter((b) => b.id === 'specs');
  const joinCost = count('\n\n');

  // Each candidate mapped to the version that is actually SENT. Identity for
  // every block but an elastic one, which step 2 replaces with a shorter render
  // — text and `refs` together, never one without the other.
  const rendered = new Map<BriefBlock, BriefBlock>(fixed.map((b) => [b, b]));
  const tokens = new Map<BriefBlock, number>(fixed.map((b) => [b, count(b.text)]));

  const kept = new Set(fixed);
  const total = () =>
    [...kept].reduce((sum, b) => sum + (tokens.get(b) ?? 0) + joinCost, systemTokens);

  const dropped = new Set<BriefBlock>();
  for (const id of DROP_ORDER) {
    if (total() <= budget) break;
    for (const block of fixed) {
      if (block.id !== id || !kept.has(block)) continue;
      kept.delete(block);
      dropped.add(block);
    }
  }

  // The drop order is exhausted and the total may still be over: what is left is
  // inside the one block it may not remove. `headroom` is the budget minus
  // everything else still standing, so the block that comes back plus the rest
  // is <= budget by construction.
  const shrunk = new Set<BriefBlock>();
  for (const block of fixed) {
    if (!kept.has(block) || !block.shrink || total() <= budget) continue;
    const cut = shrinkToBudget(block, budget - (total() - (tokens.get(block) ?? 0)), count);
    if (cut === block) continue;
    rendered.set(block, cut);
    tokens.set(block, count(cut.text));
    shrunk.add(block);
  }

  const included: BriefBlock[] = [];
  const sections: string[] = [];
  const inputs: RiskBriefInput[] = [];
  for (const block of fixed) {
    if (!kept.has(block)) continue;
    // The SENT version, not the candidate: `included` is what `buildAllowedRefs`
    // reads, so a shrunk block must contribute its shortened `refs` there and
    // its shortened text here, or the allowed set outlives the prompt.
    const sent = rendered.get(block) ?? block;
    included.push(sent);
    sections.push(sent.text);
    inputs.push({
      id: block.id,
      // `truncated`, not `included`: some of this input did not reach the model,
      // and the card's four statuses already have the word for that.
      status: shrunk.has(block) ? 'truncated' : 'included',
      tokens: tokens.get(block) ?? 0,
      detail: sent.detail,
    });
  }
  for (const block of fixed) {
    if (!dropped.has(block)) continue;
    inputs.push({
      id: block.id,
      status: 'dropped',
      tokens: tokens.get(block) ?? 0,
      detail: block.detail,
    });
  }

  if (specs.length > 0) {
    // The fence is paid for BEFORE the walk, not after it. Measuring the inner
    // text and wrapping afterwards would put the assembled input over the ceiling
    // by exactly the overhead nobody counted.
    //
    // The fence has TWO costs and this line is only the first: the delimiters,
    // subtracted here, and the escape `wrapUntrusted` applies to the content,
    // which `buildBlocks` has already applied to each spec block so that the
    // strings measured below are the strings sent.
    //
    // The blank line BETWEEN two surviving spec blocks is the third thing added
    // after the measurement, and `selectWithinBudget` counts only the blocks. It
    // is reserved for every candidate rather than for the survivors, because the
    // survivor count is what the walk is about to decide: over-reserving costs
    // `joinCost` of headroom, and under-reserving is an assembled input over the
    // ceiling — measured at +2 with three spec files before this term existed.
    const innerJoins = (specs.length - 1) * joinCost;
    const remaining = budget - total() - count(renderSpecsSection('')) - joinCost - innerJoins;
    const selection =
      remaining > 0
        ? selectWithinBudget(
            specs.map((b) => ({ path: b.refs[0] ?? '', rendered: b.text })),
            remaining,
            count,
          )
        : { blocks: [] as string[], results: specs.map((b) => ({ path: b.refs[0] ?? '', tokens: count(b.text), status: 'dropped' as const })) };

    const survivors = selection.results.filter(
      (r) => r.status === 'included' || r.status === 'truncated',
    );
    if (selection.blocks.length > 0) {
      sections.push(renderSpecsSection(selection.blocks.join('\n\n')));
      for (const result of survivors) {
        const block = specs.find((b) => b.refs[0] === result.path);
        if (block) included.push(block);
      }
    }
    inputs.push(summariseSpecs(selection.results));
  }

  return { user: sections.join('\n\n'), inputs, included };
}

/**
 * The longest prefix of an elastic block's OWN references that `count` puts
 * within `headroom`, re-rendered as a whole block.
 *
 * Binary search over the item count, not over code points, and that is the
 * difference that matters: `truncateToBudget` would cut mid-path, and half a
 * path is a reference to a file that does not exist — printed inside the block
 * whose printed names are the allowed set. The search cuts whole entries, and
 * the re-render rebuilds `refs` from what is left, so the text and the set stay
 * the same list. At most ~6 probes for `MAX_FILE_PATHS`, and `lo` is only ever
 * moved to a count already proven to fit.
 *
 * ZERO IS A LEGITIMATE ANSWER, and it is the floor rather than a failure: the
 * block still reports how many files changed and how many it did not list, and
 * what it stops doing is licensing paths. If even that does not fit, there is
 * nothing left in this block to cut and the caller has already dropped
 * everything else — the remaining overrun is the system prompt's, which is a
 * repository file and not attacker-controlled.
 */
function shrinkToBudget(
  block: BriefBlock,
  headroom: number,
  count: (text: string) => number,
): BriefBlock {
  const render = block.shrink;
  if (!render || block.refs.length === 0 || count(block.text) <= headroom) return block;

  let best: BriefBlock | null = null;
  let lo = 0;
  let hi = block.refs.length;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    const candidate = render(mid);
    if (count(candidate.text) <= headroom) {
      lo = mid;
      best = candidate;
    } else hi = mid;
  }
  return best ?? render(0);
}

/**
 * The six ids are what the card renders, so the several spec candidates collapse
 * to one row. Its status is the worst thing that happened to any of them, in the
 * order truncated → dropped → included, and its `detail` names each path with
 * what became of it so "which spec was cut" is answerable from the record.
 */
function summariseSpecs(
  results: { path: string; tokens: number; status: string }[],
): RiskBriefInput {
  const status = results.some((r) => r.status === 'truncated')
    ? 'truncated'
    : results.every((r) => r.status === 'dropped')
      ? 'dropped'
      : 'included';
  return {
    id: 'specs',
    status,
    tokens: results.reduce(
      (sum, r) => sum + (r.status === 'dropped' ? 0 : r.tokens),
      0,
    ),
    detail: results.map((r) => `${r.path} (${r.status})`).join(', '),
  };
}

/**
 * Every id the record must account for, in the contract's own order, with the
 * ones that never had a block reported `missing` and why.
 *
 * `missing` is not `dropped`: one says there was nothing to send, the other says
 * there was and it did not fit. Collapsing them would make "this PR has no
 * intent" and "the intent was crowded out" the same sentence on the card.
 */
export function mergeInputs(
  fitted: RiskBriefInput[],
  missing: { id: RiskBriefInputId; detail: string }[],
): RiskBriefInput[] {
  const rows = [
    ...fitted,
    ...missing.map(
      (m): RiskBriefInput => ({ id: m.id, status: 'missing', tokens: 0, detail: m.detail }),
    ),
  ];
  const order = RiskBriefInputId.options;
  return [...rows].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
}

/**
 * The allowed set: the union of `refs` over the blocks that ACTUALLY REACHED THE
 * PROMPT, and nothing else (R13).
 *
 * The parameter is `included` rather than the gathered sources, and that is the
 * correctness spine of this feature. AC-13 says the set is assembled from the
 * input of this same call. Building it from the sources assembles it from what we
 * *considered* sending: a blast answer the budget dropped would still license
 * every endpoint label it named, a dropped spec would still license its own path,
 * and on a 400-file PR the 360 paths that were never printed would be members
 * too. The model would then be able to hand back a reference to a document it
 * never saw, and grounding — the strongest control this feature has — would
 * confirm it.
 */
export function buildAllowedRefs(included: BriefBlock[]): Set<string> {
  const allowed = new Set<string>();
  for (const block of included) {
    for (const ref of block.refs) if (ref.length > 0) allowed.add(ref);
  }
  return allowed;
}

/**
 * The line numbers the same blocks licensed — the exact mirror of
 * `buildAllowedRefs`, over the same `included` list (R14, R15).
 *
 * Same parameter, same reason, and the reason is stronger here. A blast answer
 * the budget dropped licenses no reference; it must license no NUMBER either, or
 * a `path:line` would be rendered off facts that never reached the model while
 * the path beside it came from somewhere else entirely. Building this from the
 * gathered sources instead would do exactly that, and nothing downstream could
 * tell: a line looks equally plausible whichever block it came from.
 *
 * First occurrence wins across blocks as it does inside one, so this stays a
 * function of the printed order and of nothing else. Only `blast` sets `refLines`
 * today; the loop does not assume it, because a second producer would otherwise
 * silently depend on iteration order to decide whose number a reader sees.
 */
export function buildRefLines(included: BriefBlock[]): RiskBriefRefLine[] {
  const lines = new Map<string, RiskBriefRefLine>();
  for (const block of included) {
    for (const entry of block.refLines ?? []) {
      if (entry.ref.length > 0 && !lines.has(entry.ref)) lines.set(entry.ref, entry);
    }
  }
  return [...lines.values()];
}

/* --------------------------------------------------------------- grounding */

const SEVERITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };

/**
 * `src/x.ts:12` and `src/x.ts:12-18` → `src/x.ts`. The number is DISCARDED (R13).
 *
 * The prompt asks for paths and the model writes what it likes; a trailing line
 * suffix is the form it reaches for most often, because that is how a file:line
 * reads everywhere else. Without this the whole reference is dropped as ungrounded
 * — the correct path refused over a tail nothing was looking for.
 *
 * THE NUMBER IS NOT KEPT, and that is the point rather than a detail. A line the
 * model wrote is a line nobody measured (AC-57); the ones that are shown come off
 * the blast answer through `buildRefLines`, which never reads this function's
 * input. So this cut can only ever remove a claim, never introduce one.
 *
 * ANCHORED AT THE END AND APPLIED ONCE. `src/x.ts:12:34` loses only `:34` and is
 * then tested as `src/x.ts:12`, which is a member only if some block printed that
 * exact string. Anything else — stripping repeatedly, or matching anywhere in the
 * string — would let the cut manufacture a member out of a name that was not one,
 * and the allowed set is the only thing standing between a model's invention and
 * a rendered link. `\d` is ASCII-only in JavaScript, so a digit-shaped code point
 * from another script is not a line number here either.
 */
export function stripLineSuffix(ref: string): string {
  return ref.replace(/:\d+(?:-\d+)?$/, '');
}

export interface GroundedBrief {
  what: string;
  why: string;
  risks: Risk[];
  review_focus: ReviewFocusItem[];
  dropped_refs: string[];
  dropped_risks: number;
}

/**
 * Keep only what the input can vouch for, and only as much of it as a record may
 * carry (R10, R12, R14).
 *
 * A risk whose `file_refs` are all outside the set is dropped rather than shown
 * without them, and so is one that arrived with none at all (R9): the observable
 * end state is the same — a claim with nothing behind it — so it gets the same
 * answer. Both are counted, because a silent drop is indistinguishable from a
 * model that found nothing.
 *
 * Every reference is passed through `stripLineSuffix` FIRST, so a model that
 * writes `src/x.ts:12` is grounded on `src/x.ts` and the tail costs it nothing.
 * The set it is tested against is the same one, and the number is thrown away
 * where it stands — read that function for why both halves matter (R13).
 *
 * MEMBERSHIP IS NOT A BOUND, which is the second thing this function does.
 * Filtering by the allowed set says every name is one the model was shown; it
 * says nothing about how many times, and nothing about how much prose came with
 * them. The upstream of this answer — PR body, linked issue, spec files — is
 * attacker-controlled, its only injection defence is a paragraph of system
 * prompt, and everything below flows into jsonb and out of every GET. So the
 * counts are capped, the reference lists de-duplicated, and EVERY free string
 * truncated at the point its owner is kept. A cap on a list length bounds the
 * list and not the strings in it: until 2026-08-16 `kind`, `title`, `explanation`,
 * `reason` and each element of `dropped_refs` travelled through here at whatever
 * length the model chose, and `service.ts` sends no `max_tokens`, so nothing else
 * in the system bounded them either. What is NOT truncated here is what something
 * else already bounds: `severity` is an enum, and every surviving `ref` is a
 * member of the allowed set and therefore capped by the input caps.
 *
 * Every number lives in `constants.ts` beside the input caps, and none of them is
 * a Zod `.max()` — see the note there for why the schema cannot carry them.
 *
 * `dropped_risks` counts a risk the reviewer will not see, whichever bound
 * removed it: ungrounded and over-cap are different reasons for the same
 * observable end state, and a cap that hid risks silently would be the exact
 * failure this counter exists to prevent. The cap is applied AFTER the sort, so
 * what it takes is the least severe.
 *
 * The sort is `Array.prototype.sort` on a mapped index, which is stable in every
 * engine this runs on (ES2019+), so the model's order survives INSIDE a level
 * while the levels themselves descend.
 */
export function groundBrief(model: RiskBrief, allowed: Set<string>): GroundedBrief {
  const droppedRefs = new Set<string>();
  const grounded: Risk[] = [];
  let droppedRisks = 0;

  for (const risk of model.risks) {
    const refs = new Set<string>();
    for (const ref of risk.file_refs) {
      // Cut, then test, then store the CUT form — three separate decisions (R13,
      // R17). The set is unchanged, so `src/x.ts:12` is admitted only because
      // `src/x.ts` is a member; the `Set` de-duplicates AFTER the cut, so
      // `a.ts` and `a.ts:3` are one reference and the card draws one control; and
      // what `dropped_refs` records below is the model's ORIGINAL string, because
      // that array is the evidence of what it said, not of what we made of it.
      const stripped = stripLineSuffix(ref);
      if (allowed.has(stripped)) refs.add(stripped);
      else droppedRefs.add(ref);
    }
    if (refs.size === 0) {
      droppedRisks += 1;
      continue;
    }
    // Truncated HERE, at the point the risk is kept, and not by the contract:
    // `severity` is an enum and `file_refs` are members of the allowed set, so
    // those two are already bounded by the input caps. The three free strings are
    // not bounded by anything at all before this line.
    grounded.push({
      ...risk,
      kind: truncateCodePoints(risk.kind, MAX_LINE_CHARS),
      title: truncateCodePoints(risk.title, MAX_LINE_CHARS),
      explanation: truncateCodePoints(risk.explanation, MAX_PROSE_CHARS),
      file_refs: [...refs].slice(0, MAX_RISK_FILE_REFS),
    });
  }

  grounded.sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 3) - (SEVERITY_ORDER[b.severity] ?? 3));
  const risks = grounded.slice(0, MAX_RISKS);
  droppedRisks += grounded.length - risks.length;

  // De-duplicated by `ref`: the card turns each item into one control, so a
  // repeated ref is a repeated button, and the first `reason` is the one the
  // prompt asked to be the most important.
  const seenFocus = new Set<string>();
  const review_focus: ReviewFocusItem[] = [];
  for (const item of model.review_focus) {
    // Cut before the membership test here too, and de-duplicate after it: two
    // items naming `a.ts` and `a.ts:3` are one place to look, and the first
    // reason is the one the prompt asked to be the most important.
    const ref = stripLineSuffix(item.ref);
    if (!allowed.has(ref)) {
      droppedRefs.add(item.ref);
      continue;
    }
    if (seenFocus.has(ref)) continue;
    seenFocus.add(ref);
    review_focus.push({ ...item, ref, reason: truncateCodePoints(item.reason, MAX_LINE_CHARS) });
  }

  return {
    what: truncateCodePoints(model.what, MAX_PROSE_CHARS),
    why: truncateCodePoints(model.why, MAX_PROSE_CHARS),
    risks,
    review_focus: review_focus.slice(0, MAX_REVIEW_FOCUS),
    // A dropped ref matched nothing in the allowed set, so nothing about it is
    // bounded: not how many there are, and not how long one is.
    dropped_refs: [...droppedRefs]
      .slice(0, MAX_DROPPED_REFS)
      .map((ref) => truncateCodePoints(ref, MAX_FILE_PATH_CHARS)),
    dropped_risks: droppedRisks,
  };
}

/**
 * How old the intent is relative to the state being briefed (R25).
 *
 * THREE-VALUED, and there is no fourth branch and no default to `fresh`. `unknown`
 * is what an absent intent produces and what an absent `pr_commits` row for the
 * head sha produces — the second is the one that matters, because resolving an
 * unknown commit date to "not stale" is a confidence the system does not have, in
 * the one field whose whole job is disclosing staleness.
 */
export function intentFreshness(
  intentComputedAt: Date | null,
  headCommittedAt: Date | null,
): IntentFreshness {
  if (!intentComputedAt || !headCommittedAt) return 'unknown';
  return intentComputedAt.getTime() < headCommittedAt.getTime() ? 'stale' : 'fresh';
}

/* ------------------------------------------------------------------- DTO */

/**
 * Row → DTO. A `*Row` never leaves this module.
 *
 * The jsonb columns are `unknown[]` because no `db/schema` file imports the
 * contracts, so they are parsed back through the contract's own schemas here
 * rather than cast. Anything that fails is dropped: the alternative is serving a
 * shape the client's own parse would reject, which turns a bad row into a broken
 * page instead of a short one. Same move as `toIntentRecord`'s evidence filter.
 */
export function toRiskBriefRecord(row: PrBriefRow): RiskBriefRecord {
  return {
    what: row.what,
    why: row.why,
    // `risk_level` and `intent_freshness` need no parse: `text(name, { enum })`
    // already gives Drizzle the exact union the contract declares.
    risk_level: row.riskLevel,
    risks: Risk.array().catch([]).parse(row.risks),
    review_focus: ReviewFocusItem.array().catch([]).parse(row.reviewFocus),
    head_sha: row.headSha,
    intent_computed_at: row.intentComputedAt?.toISOString() ?? null,
    intent_freshness: row.intentFreshness,
    blast_status: BlastIndexStatus.catch('degraded').parse(row.blastStatus),
    link_sha: row.linkSha,
    index_matches_head: row.indexMatchesHead,
    inputs: RiskBriefInput.array().catch([]).parse(row.inputs),
    ref_lines: RiskBriefRefLine.array().catch([]).parse(row.refLines),
    dropped_refs: row.droppedRefs,
    dropped_risks: row.droppedRisks,
    budget: row.budget,
    input_tokens_counted: row.inputTokensCounted,
    tokenizer: RiskBriefTokenizer.catch('heuristic').parse(row.tokenizer),
    attempts: row.attempts,
    tokens_in: row.tokensIn,
    provider: row.provider ?? '',
    model: row.model ?? '',
    cost_usd: row.costUsd,
    computed_at: row.computedAt.toISOString(),
  };
}
