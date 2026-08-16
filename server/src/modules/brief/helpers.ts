import {
  BlastIndexStatus,
  IntentFreshness,
  ReviewFocusItem,
  Risk,
  RiskBriefInput,
  RiskBriefInputId,
  RiskBriefTokenizer,
  type BlastRadiusView,
  type RiskBrief,
  type RiskBriefRecord,
} from '@devdigest/shared';
import { wrapUntrusted } from '../../platform/prompt.js';
import { truncateCodePoints } from '../_shared/repo-paths.js';
import { selectWithinBudget } from '../_shared/budget.js';
import type { PrBriefRow } from '../../db/rows.js';
import type { BriefBlock, BriefFit, BriefSources } from './types.js';
import {
  MAX_BLAST_CALLERS,
  MAX_BLAST_ENDPOINTS,
  MAX_BLAST_FACT_CHARS,
  MAX_BLAST_SYMBOLS,
  MAX_FILE_PATH_CHARS,
  MAX_INTENT_CHARS,
  MAX_ISSUE_BODY_CHARS,
  MAX_ISSUE_TITLE_CHARS,
  MAX_PR_BODY_CHARS,
  MAX_PR_TITLE_CHARS,
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
    blocks.push({
      id: 'specs',
      // INNER text: `fitToBudget` wraps the survivors in one `plan-spec` fence.
      // The path leads the section on purpose — a prefix cut keeps it, which is
      // what makes a truncated spec still able to vouch for its own path.
      text: `### ${spec.path}\n${spec.text}`,
      refs: [spec.path],
      detail: spec.path,
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
 */
function diffStatsBlock(sources: BriefSources): BriefBlock {
  const paths = sources.filePaths.map((p) => truncateCodePoints(p, MAX_FILE_PATH_CHARS));
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
  };
}

/**
 * The fact list, and its own refs.
 *
 * Every name the block prints is a member: `changed_files`, each symbol's file,
 * each listed caller's file, and each listed endpoint's file AND label. The
 * label is a member because `ReviewFocusItem.kind` has an `endpoint` branch — a
 * focus item may legitimately name `POST /pulls/:id/brief`, and it can only do so
 * if this block put that string in front of the model.
 *
 * The caps are applied to what is LISTED, so the refs and the text cannot
 * disagree: a symbol past `MAX_BLAST_SYMBOLS` contributes neither.
 */
function blastBlock(view: BlastRadiusView): BriefBlock {
  const refs = new Set<string>(view.changed_files);
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
      refs.add(symbol.file);
      lines.push(
        clamp(
          `${BULLET} ${symbol.name} (${symbol.kind}) in ${symbol.file} — ${symbol.caller_count} caller(s)`,
        ),
      );
      for (const caller of symbol.callers.slice(0, MAX_BLAST_CALLERS)) {
        refs.add(caller.file);
        lines.push(clamp(`    called by ${caller.symbol} in ${caller.file}`));
      }
      for (const endpoint of symbol.endpoints.slice(0, MAX_BLAST_ENDPOINTS)) {
        refs.add(endpoint.file);
        refs.add(endpoint.label);
        lines.push(
          clamp(
            `    reaches ${endpoint.kind === 'http' ? 'endpoint' : 'cron'} ${endpoint.label} in ${endpoint.file}`,
          ),
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

function clamp(line: string): string {
  return truncateCodePoints(line, MAX_BLAST_FACT_CHARS);
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
 * different answer.
 */
const DROP_ORDER = ['linked_issue', 'pr_text', 'blast', 'intent'] as const;

/**
 * Fit the blocks to `budget`, and say what happened to each (R18, R20).
 *
 * Two mechanisms, because AC-20 asks for both. The five fixed-ceiling blocks are
 * dropped whole in reverse priority until the total fits — a block that is half
 * present is a block whose references cannot be trusted. The specs are the only
 * ELASTIC input, and they get the one cut point: `selectWithinBudget` takes them
 * in order, stops at the first that does not fit, and truncates the first one
 * only when it alone exceeds the remainder.
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
  const tokens = new Map<BriefBlock, number>(fixed.map((b) => [b, count(b.text)]));
  const joinCost = count('\n\n');

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

  const included: BriefBlock[] = fixed.filter((b) => kept.has(b));
  const sections = included.map((b) => b.text);
  const inputs: RiskBriefInput[] = included.map((b) => ({
    id: b.id,
    status: 'included',
    tokens: tokens.get(b) ?? 0,
    detail: b.detail,
  }));
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
    const remaining = budget - total() - count(renderSpecsSection('')) - joinCost;
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

/* --------------------------------------------------------------- grounding */

const SEVERITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };

export interface GroundedBrief {
  risks: Risk[];
  review_focus: ReviewFocusItem[];
  dropped_refs: string[];
  dropped_risks: number;
}

/**
 * Keep only what the input can vouch for (R10, R12, R14).
 *
 * A risk whose `file_refs` are all outside the set is dropped rather than shown
 * without them, and so is one that arrived with none at all (R9): the observable
 * end state is the same — a claim with nothing behind it — so it gets the same
 * answer. Both are counted, because a silent drop is indistinguishable from a
 * model that found nothing.
 *
 * The sort is `Array.prototype.sort` on a mapped index, which is stable in every
 * engine this runs on (ES2019+), so the model's order survives INSIDE a level
 * while the levels themselves descend.
 */
export function groundBrief(model: RiskBrief, allowed: Set<string>): GroundedBrief {
  const droppedRefs = new Set<string>();
  const risks: Risk[] = [];
  let droppedRisks = 0;

  for (const risk of model.risks) {
    const refs = risk.file_refs.filter((ref) => {
      if (allowed.has(ref)) return true;
      droppedRefs.add(ref);
      return false;
    });
    if (refs.length === 0) {
      droppedRisks += 1;
      continue;
    }
    risks.push({ ...risk, file_refs: refs });
  }

  const review_focus = model.review_focus.filter((item) => {
    if (allowed.has(item.ref)) return true;
    droppedRefs.add(item.ref);
    return false;
  });

  risks.sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 3) - (SEVERITY_ORDER[b.severity] ?? 3));

  return { risks, review_focus, dropped_refs: [...droppedRefs], dropped_risks: droppedRisks };
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
