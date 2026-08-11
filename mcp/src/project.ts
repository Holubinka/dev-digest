/**
 * Compact projections (spec 06 step 5).
 *
 * The API contract is not the MCP surface. A tool result is read by a model with
 * a token budget, so each projection keeps the fields that carry meaning and
 * drops identifiers, action timestamps and nested objects no tool consumes.
 *
 * Pure: values in, values out. No I/O, no clock, no `this`.
 */

import type {
  AgentSummary,
  BlastCallerSummary,
  BlastPayload,
  BlastSymbolSummary,
  ConventionSummary,
  FindingSummary,
} from './api/schemas.js';

export const FINDINGS_DEFAULT_LIMIT = 20;
export const FINDINGS_MAX_LIMIT = 100;
export const CONVENTIONS_DEFAULT_LIMIT = 50;
export const CONVENTIONS_MAX_LIMIT = 200;
export const RATIONALE_CHARS = 500;
export const SUGGESTION_CHARS = 500;
export const AGENT_DESCRIPTION_CHARS = 200;
/** The review's own prose summary, as `get_findings` returns it (spec 06 step 7). */
export const SUMMARY_CHARS = 600;

/**
 * `get_blast_radius` caps (spec 07 step 13). The API already caps callers at 20
 * per symbol; these are tighter because a tool result is read by a model, and a
 * PR touching 30 symbols would otherwise spend the whole budget on call sites
 * nobody asked for. Every cap that bites is stated in the result — `caller_count`
 * for callers, a `note` for the rest — so a trimmed answer never reads as a
 * complete one.
 */
export const BLAST_SYMBOLS_LIMIT = 25;
export const BLAST_CALLERS_PER_SYMBOL = 5;
export const BLAST_ENDPOINTS_PER_SYMBOL = 5;
export const BLAST_CHANGED_FILES_LIMIT = 20;
export const BLAST_REASON_CHARS = 300;
export const BLAST_LABEL_CHARS = 100;

/**
 * Cap `text` at `max` CODE POINTS, not UTF-16 units.
 *
 * `String.slice` cuts astral characters in half and leaves a lone surrogate
 * (server/INSIGHTS.md §"Truncating text for an API response with `String.slice`
 * corrupts emoji"). Same rule and same shape as `truncateChars` in
 * `server/src/modules/pulls/status.ts:65`.
 *
 * Note the limit of this rule: a code point is not a grapheme cluster, so a ZWJ
 * emoji sequence can still be split between its parts. It never produces an
 * invalid string, which is what the cited failure was about.
 */
export function truncate(text: string, max: number): string {
  const chars = [...text];
  return chars.length > max ? `${chars.slice(0, max).join('')}…` : text;
}

export interface ProjectedFinding {
  severity: FindingSummary['severity'];
  category: string;
  title: string;
  file: string;
  line: number;
  /** Only when the finding spans more than one line. */
  end_line?: number;
  confidence: number;
  why: string;
  /** Only when the agent proposed one. */
  fix?: string;
}

export interface ProjectedFindings {
  findings: ProjectedFinding[];
  note?: string;
}

export interface ProjectedAgent {
  name: string;
  description: string;
  model: string;
  enabled: boolean;
}

const SEVERITY_RANK: Record<FindingSummary['severity'], number> = {
  CRITICAL: 0,
  WARNING: 1,
  SUGGESTION: 2,
};

/**
 * CRITICAL → WARNING → SUGGESTION, then confidence descending, then file, then
 * line, then title.
 *
 * `title` is the plan's four keys plus one. Without it the order is not total:
 * the source query has no ORDER BY, equal confidences are common, and the
 * finding id that breaks the tie in the server's own ranker
 * (`modules/pulls/status.ts`) is dropped by this projection. A partial order over
 * an unordered input is not deterministic, which is what the pinning test exists
 * to guarantee.
 *
 * This is a THIRD ranker in the repo and does not claim to match the other two
 * (root INSIGHTS.md §"The two findings rankers must sort identically…").
 * Comparison uses raw confidence, not the 2-dp value shown in the result.
 */
export function compareFindings(a: FindingSummary, b: FindingSummary): number {
  const bySeverity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
  if (bySeverity !== 0) return bySeverity;
  if (a.confidence !== b.confidence) return b.confidence - a.confidence;
  if (a.file !== b.file) return a.file < b.file ? -1 : 1;
  if (a.start_line !== b.start_line) return a.start_line - b.start_line;
  if (a.title === b.title) return 0;
  return a.title < b.title ? -1 : 1;
}

function projectFinding(finding: FindingSummary): ProjectedFinding {
  const hasFix = finding.suggestion != null && finding.suggestion !== '';
  // Conditional spread rather than assignment, so an absent field is absent from
  // the JSON (not `undefined`) AND the keys stay in reading order.
  return {
    severity: finding.severity,
    category: finding.category,
    title: finding.title,
    file: finding.file,
    line: finding.start_line,
    ...(finding.end_line !== finding.start_line ? { end_line: finding.end_line } : {}),
    confidence: Math.round(finding.confidence * 100) / 100,
    why: truncate(finding.rationale, RATIONALE_CHARS),
    ...(hasFix ? { fix: truncate(finding.suggestion as string, SUGGESTION_CHARS) } : {}),
  };
}

/**
 * Sort, trim, project. When the result was trimmed it says so and names the two
 * ways to see the rest, because a silently truncated list reads as a complete
 * one.
 */
export function projectFindings(
  findings: readonly FindingSummary[],
  options: { limit?: number } = {},
): ProjectedFindings {
  const limit = Math.min(
    Math.max(Math.trunc(options.limit ?? FINDINGS_DEFAULT_LIMIT), 1),
    FINDINGS_MAX_LIMIT,
  );
  const ordered = [...findings].sort(compareFindings);
  const kept = ordered.slice(0, limit).map(projectFinding);

  if (ordered.length <= limit) return { findings: kept };
  return {
    findings: kept,
    note:
      `showing ${kept.length} of ${ordered.length} — call get_findings with ` +
      `severity="CRITICAL" or a higher limit`,
  };
}

/**
 * `system_prompt` is dropped — the largest field on `Agent`, thousands of tokens
 * each, and no tool consumes it. Disabled agents are projected, not filtered:
 * "disabled" is usually the explanation for a review that will not start.
 */
export function projectAgent(agent: AgentSummary): ProjectedAgent {
  return {
    name: agent.name,
    description: truncate(agent.description, AGENT_DESCRIPTION_CHARS),
    model: agent.model,
    enabled: agent.enabled,
  };
}

export function projectAgents(agents: readonly AgentSummary[]): ProjectedAgent[] {
  return agents.map(projectAgent);
}

export interface ProjectedConvention {
  category: string;
  rule: string;
  /** `"path:line"`, or just the path when the line is unknown. Absent when unevidenced. */
  evidence?: string;
  /** 2 dp. Absent when the extractor recorded none. */
  confidence?: number;
}

export interface ProjectedConventions {
  conventions: ProjectedConvention[];
  note?: string;
}

/**
 * Confidence descending (unscored last), then category, then rule.
 *
 * The API already returns candidates confidence-first
 * (`conventions/repository.ts:107`), but that order is not total — equal
 * confidences fall back to `created_at`, which this projection drops — and this
 * tool TRIMS to a limit, which makes the order decide what the model never sees.
 * So it is re-sorted here and pinned by a test, exactly as the finding order is.
 */
export function compareConventions(a: ConventionSummary, b: ConventionSummary): number {
  const ac = a.confidence ?? -1;
  const bc = b.confidence ?? -1;
  if (ac !== bc) return bc - ac;
  if (a.category !== b.category) return a.category < b.category ? -1 : 1;
  if (a.rule === b.rule) return 0;
  return a.rule < b.rule ? -1 : 1;
}

/**
 * `evidence_path` + `evidence_line` collapse to one `"path:line"` string — the
 * shape a model can paste straight into a file open, and one field instead of
 * two. `evidence_snippet` and `extra_evidence` are dropped: the snippet is a
 * copy of code the agent can read from the file itself, and `extra_evidence` is
 * an array of nested objects that would dominate the response.
 */
function projectConvention(candidate: ConventionSummary): ProjectedConvention {
  const evidence =
    candidate.evidence_path == null
      ? undefined
      : candidate.evidence_line == null
        ? candidate.evidence_path
        : `${candidate.evidence_path}:${candidate.evidence_line}`;

  return {
    category: candidate.category,
    rule: candidate.rule,
    ...(evidence !== undefined ? { evidence } : {}),
    ...(candidate.confidence != null
      ? { confidence: Math.round(candidate.confidence * 100) / 100 }
      : {}),
  };
}

/**
 * Sort, trim, project. `status` is not projected onto a row: `get_conventions`
 * filters by exactly one status, so it is already in the caller's argument and
 * repeating it per row is a token spent on a constant.
 */
export function projectConventions(
  candidates: readonly ConventionSummary[],
  options: { limit?: number } = {},
): ProjectedConventions {
  const limit = Math.min(
    Math.max(Math.trunc(options.limit ?? CONVENTIONS_DEFAULT_LIMIT), 1),
    CONVENTIONS_MAX_LIMIT,
  );
  const ordered = [...candidates].sort(compareConventions);
  const kept = ordered.slice(0, limit).map(projectConvention);

  if (ordered.length <= limit) return { conventions: kept };
  return {
    conventions: kept,
    note: `showing ${kept.length} of ${ordered.length} — call get_conventions with a higher limit`,
  };
}

// ---------------------------------------------------------------------------
// get_blast_radius (spec 07 step 13)
// ---------------------------------------------------------------------------

export interface ProjectedBlastSymbol {
  /** The changed declaration's name. */
  symbol: string;
  /** Where it is declared, as `"file:line"`. */
  at: string;
  /** Callers BEFORE this server's cap — the length of `callers` may be smaller. */
  caller_count: number;
  /** Call sites as `"file:line"`, most important caller file first. */
  callers: string[];
  /** HTTP routes and crons downstream of the symbol. Absent when there are none. */
  endpoints?: string[];
}

export interface ProjectedBlast {
  status: BlastPayload['status'];
  /** Why the index is not `full`. Absent when the API sent none. */
  reason?: string;
  /**
   * The commit every `file:line` in this result was recorded at — `link_sha`,
   * renamed for a reader who has never seen the API contract. Absent when the
   * index knows no commit, which means the lines cannot be tied to a tree at all.
   */
  lines_at_commit?: string;
  totals: BlastPayload['totals'];
  changed_files: string[];
  symbols: ProjectedBlastSymbol[];
  /**
   * What the model must not misread: a non-`full` index, line numbers belonging
   * to a commit that is not the PR head, or a trimmed list. Each caveat that
   * applies is appended, so two of them survive together.
   */
  note?: string;
}

/** Lexicographic, matching the string comparisons in `compareFindings`. */
function byText(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/**
 * Rank descending, then file, then line.
 *
 * `rank` is the caller FILE's importance percentile, so every caller in one file
 * shares it and `(file, line)` decides the rest. There is no fourth key on
 * purpose: the projection collapses a caller to `"file:line"`, so two rows that
 * tie on all three produce the same string and the ORDER OF THE RESULT is total
 * even though the order of the input rows is not. Compare `compareFindings`,
 * which needs `title` precisely because it does project it.
 */
export function compareBlastCallers(a: BlastCallerSummary, b: BlastCallerSummary): number {
  if (a.rank !== b.rank) return b.rank - a.rank;
  if (a.file !== b.file) return byText(a.file, b.file);
  return a.line - b.line;
}

/**
 * A symbol's own importance is its best caller's rank: what a reviewer wants
 * first is the changed symbol reached from the most important file.
 *
 * `-1` rather than `0` for a symbol nobody calls — `rank` is a percentile in
 * `[0, 1]`, so `0` is a real rank and an uncalled symbol must sort below it.
 */
function topCallerRank(symbol: BlastSymbolSummary): number {
  let top = -1;
  for (const caller of symbol.callers) if (caller.rank > top) top = caller.rank;
  return top;
}

/** Top caller rank descending, then file, then line, then name — a total order. */
export function compareBlastSymbols(a: BlastSymbolSummary, b: BlastSymbolSummary): number {
  const byRank = topCallerRank(b) - topCallerRank(a);
  if (byRank !== 0) return byRank;
  if (a.file !== b.file) return byText(a.file, b.file);
  if (a.line !== b.line) return a.line - b.line;
  return byText(a.name, b.name);
}

/** Ends the reason with a full stop so it can be pasted into a sentence. */
function sentence(text: string): string {
  const trimmed = text.trim();
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

/**
 * The whole point of the `partial` / `degraded` states: without this sentence a
 * model reads a short `symbols` list as "almost nothing depends on this change",
 * when what it actually means is that the index could not answer. Said the way
 * `get_conventions` says an empty answer — what is wrong, and what to do next.
 */
function statusNote(status: BlastPayload['status'], reason: string | undefined): string {
  const word = status === 'partial' ? 'PARTIAL' : 'DEGRADED';
  return (
    `The code index for this repository is ${word}, so this answer is incomplete: ` +
    `${reason ? sentence(reason) : 'the API gave no reason.'} A short or empty list below means ` +
    `the index could not tell, NOT that nothing depends on the change — do not report it as ` +
    `"no impact". Ask the user to re-index the repository from its page in the DevDigest UI.`
  );
}

/**
 * The mirror image, and just as necessary: under a `full` index an empty list is
 * a real answer, and saying so is what stops a model hedging on a result that is
 * actually complete.
 */
function completeButEmptyNote(view: BlastPayload): string | undefined {
  if (view.symbols.length === 0) {
    return (
      'The index is complete for this repository and found no changed symbols in this pull ' +
      'request — the diff touches no indexed declaration.'
    );
  }
  if (view.totals.callers === 0) {
    return (
      'The index is complete for this repository and found no callers of the changed symbols — ' +
      'nothing else in the repository calls into this change.'
    );
  }
  return undefined;
}

/**
 * The second thing a short answer must not be read as: current.
 *
 * Every `line` in this payload was recorded by the indexer against `link_sha`, so
 * a `"file:line"` resolved against the PR head points at whatever sits on that
 * line NOW. On `Holubinka/dev-digest` PR #12 that was 7 of 20 caller lines landing
 * on a comment, a bare `try {` or a blank line, because ten lines had been deleted
 * from `server/src/app.ts` in between (`contracts/blast.ts` §TWO SHAS, ON PURPOSE).
 *
 * The commit itself travels in `lines_at_commit`, so this sentence names the field
 * rather than repeating forty characters of hex the model can already read.
 *
 * `link_sha === null` is a different statement, not a weaker one: there is no
 * commit to resolve against at all, and falling back to head is exactly the
 * mistake the contract forbids.
 */
function commitNote(view: BlastPayload): string | undefined {
  if (view.link_sha == null) {
    return (
      'The code index recorded no commit for this repository, so the line numbers below cannot ' +
      'be tied to any tree: treat every "file:line" as approximate and confirm the symbol by ' +
      'name before acting on it.'
    );
  }
  if (view.index_matches_head) return undefined;
  return (
    'The line numbers below were recorded when the index was built, at the commit in ' +
    'lines_at_commit — NOT at this pull request\'s head commit, which is a different commit. ' +
    'Resolve every "file:line" against lines_at_commit (git show <lines_at_commit>:<file>); ' +
    'read against the head tree, a line that moved since then points at the wrong code.'
  );
}

function projectBlastSymbol(symbol: BlastSymbolSummary): ProjectedBlastSymbol {
  const callers = [...symbol.callers]
    .sort(compareBlastCallers)
    .slice(0, BLAST_CALLERS_PER_SYMBOL)
    .map((caller) => `${caller.file}:${caller.line}`);

  // Deduplicated before the cap: the same route can be reached through two
  // different files, and spending the budget on the same label twice would push
  // a second, real endpoint out of the list.
  const labels = [...new Set(symbol.endpoints.map((endpoint) => endpoint.label))]
    .sort(byText)
    .slice(0, BLAST_ENDPOINTS_PER_SYMBOL)
    .map((label) => truncate(label, BLAST_LABEL_CHARS));

  return {
    symbol: symbol.name,
    at: `${symbol.file}:${symbol.line}`,
    caller_count: symbol.caller_count,
    callers,
    ...(labels.length > 0 ? { endpoints: labels } : {}),
  };
}

/**
 * Sort, trim, project — and say out loud whatever the trimming, the index status
 * and the indexed commit would otherwise leave a model to guess.
 *
 * `changed_files` is sorted here rather than trusted from the API: this function
 * TRIMS it, so its order decides which paths a model never sees.
 */
export function projectBlast(view: BlastPayload): ProjectedBlast {
  const ordered = [...view.symbols].sort(compareBlastSymbols);
  const symbols = ordered.slice(0, BLAST_SYMBOLS_LIMIT).map(projectBlastSymbol);

  const files = [...view.changed_files].sort(byText);
  const keptFiles = files.slice(0, BLAST_CHANGED_FILES_LIMIT);

  const reason = view.reason == null ? undefined : truncate(view.reason, BLAST_REASON_CHARS);

  const notes: string[] = [];
  if (view.status === 'full') {
    const empty = completeButEmptyNote(view);
    if (empty !== undefined) notes.push(empty);
  } else {
    notes.push(statusNote(view.status, reason));
  }
  // Appended, never substituted: a degraded index and a stale link commit are two
  // independent caveats and the live case for the second one is a FULL index that
  // is simply older than the head. Losing either leaves the model confident about
  // the half it was not told.
  const commit = commitNote(view);
  if (commit !== undefined) notes.push(commit);
  if (ordered.length > symbols.length) {
    notes.push(
      `Showing ${symbols.length} of ${ordered.length} changed symbols, the most called first.`,
    );
  }
  if (files.length > keptFiles.length) {
    notes.push(`Showing ${keptFiles.length} of ${files.length} changed files.`);
  }

  return {
    status: view.status,
    ...(reason !== undefined ? { reason } : {}),
    ...(view.link_sha != null ? { lines_at_commit: view.link_sha } : {}),
    totals: view.totals,
    changed_files: keptFiles,
    symbols,
    ...(notes.length > 0 ? { note: notes.join(' ') } : {}),
  };
}
