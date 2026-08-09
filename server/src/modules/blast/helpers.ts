import type {
  BlastEndpoint,
  BlastIndexStatus,
  BlastRadiusView,
  BlastSymbol,
  BlastViewCaller,
} from '@devdigest/shared';
import type { BlastFacts, BlastFactsCaller, BlastIndexState, DownstreamFile } from './types.js';

/**
 * blast — the pure ring. Nothing here calls anything: no DB, no clock, no LLM,
 * no `Container`. Every input arrives as a parameter, which is what lets
 * `test/blast-service.test.ts` assert the whole shape with no doubles at all.
 */

/** Longest a single rendered fact line may get before it is clamped. */
const MAX_FACT_CHARS = 200;
/** Symbols carried into the summary prompt, most-impacted first. */
const MAX_PROMPT_SYMBOLS = 12;
/** Callers per symbol carried into the summary prompt. */
const MAX_PROMPT_CALLERS = 8;
/**
 * Endpoints per symbol carried into the summary prompt.
 *
 * The prompt caps every other input, and this was the hole: `symbol.endpoints`
 * is sized by REPOSITORY CONTENT, not by this file. `extractEndpoints`
 * (`adapters/codeindex/extract.ts:182`) emits one entry per matching line of a
 * file indexed up to `MAX_FILE_SIZE` (400 KB), and `endpointsForCallers` unions
 * that across a symbol's caller files — so a routes file with a thousand
 * registrations put a thousand lines into a paid prompt.
 */
const MAX_PROMPT_ENDPOINTS = 8;
/**
 * Endpoints per symbol carried over the WIRE, in `BlastSymbol.endpoints`.
 *
 * Applied here rather than declared as a `.max()` on the contract for a reason:
 * a `z.array().max()` on a response schema turns an over-cap answer into a 500
 * at serialization time, and this array is not the caller's input to fix. The
 * cap therefore lives where the array is built, and the CONTRACT carries the
 * fact that it was applied — `endpoint_count` and `endpoints_truncated`, the
 * same shape `caller_count` / `truncated` already uses for the caller list.
 *
 * 20 matches repo-intel's `MAX_CALLERS_PER_SYMBOL` and sits above both readers:
 * the prompt takes 8, and `mcp/src/project.ts` projects 5.
 */
const MAX_VIEW_ENDPOINTS = 20;

/**
 * Prose for the machine-readable reasons repo-intel reports. The card shows this
 * sentence verbatim, so it says what is missing and why — `no_data` alone is not
 * something a reviewer can act on.
 */
const REASON_PROSE: Record<string, string> = {
  flag_off: 'Code intelligence is switched off on this server, so nothing could be looked up.',
  index_failed: 'The last indexing run for this repository failed.',
  index_partial: 'This repository is only partly indexed.',
  repo_too_large: 'This repository is too large to index, so it was only sampled.',
  no_data: 'This repository has not been indexed yet.',
  no_clone: 'This repository has not been cloned yet.',
};

/**
 * `Object.hasOwn`, never a bare index or `in`: `REASON_PROSE` is an object
 * literal, so `REASON_PROSE['toString']` resolves to `Object.prototype.toString`
 * and the `?? null` guard never fires — the reason sentence would then read
 * "function toString() { [native code] } No call sites could be resolved."
 * `reason` is free-form text the indexer stamped (`types.ts:33`), so the string
 * is not ours to trust. Same defect class as `client/INSIGHTS.md:684-704`.
 */
function prose(reason: string | undefined): string | null {
  if (!reason || !Object.hasOwn(REASON_PROSE, reason)) return null;
  return REASON_PROSE[reason] ?? null;
}

/**
 * The pre-cap caller count for one symbol, read prototype-safely.
 *
 * `capCallersPerSymbol` builds `const counts: Record<string, number> = {}`
 * (`repo-intel/service.ts:872`), and ast-grep emits class methods under their
 * BARE name (`adapters/astgrep/index.ts:272`) with no kind filter downstream —
 * so `class X { toString() {} }` in a changed file really does reach this
 * lookup. Bare-indexed, it returned `Object.prototype.toString`:
 * `noUncheckedIndexedAccess` types that `number | undefined` and `??` never
 * fires, `caller_count` became a function, `JSON.stringify` dropped the key from
 * the response, the sort comparator went `NaN` and `totals.callers`
 * string-concatenated to `"0function toString() { [native code] }"`.
 */
function ownCallerCount(
  counts: Record<string, number> | undefined,
  name: string,
): number | undefined {
  if (!counts || !Object.hasOwn(counts, name)) return undefined;
  return counts[name];
}

/**
 * Which of the three states the answer is served under, and why.
 *
 * `full` demands BOTH a full index AND facts the persistent path actually
 * backed: `getBlastRadius` degrades on its own (missing clone, unparseable
 * repo) while `repo_index_state` still says `full`, and serving that as `full`
 * would render an empty answer as "nothing is affected".
 *
 * `reason` is null ONLY under `full`. Under the other two it is one sentence,
 * because acceptance criterion 6 is that a degraded answer is a VISIBLE state —
 * a status the card can branch on but not explain is half of one.
 *
 * `facts` is null when the caller never asked for them, which is the whole point
 * of the gate in `service.ts`: an unindexed repo is classified here without the
 * clone-reading fallback ever running.
 */
export function deriveStatus(
  indexState: BlastIndexState,
  facts: BlastFacts | null,
): { status: BlastIndexStatus; reason: string | null } {
  if (indexState.status === 'full' && facts?.degraded !== true) {
    return { status: 'full', reason: null };
  }

  if (indexState.status === 'partial') {
    const why = prose(indexState.degradedReason ?? indexState.reason);
    return {
      status: 'partial',
      reason: `${why ?? 'This repository is only partly indexed.'} Some callers and endpoints are probably missing.`,
    };
  }

  // Everything else — `degraded`, `failed`, an unknown status, or a full index
  // whose lookup degraded anyway.
  const why =
    prose(indexState.degradedReason) ??
    prose(indexState.reason) ??
    prose(facts?.reason) ??
    `The code index for this repository is not usable (status: ${indexState.status}).`;
  return { status: 'degraded', reason: `${why} No call sites could be resolved.` };
}

interface ToViewInput {
  status: BlastIndexStatus;
  reason: string | null;
  repoFullName: string;
  headSha: string;
  /**
   * `repo_index_state.last_indexed_sha` — the commit the line numbers came from.
   * `''` and `null` both mean "no commit to link against".
   */
  linkSha: string | null | undefined;
  changedFiles: string[];
  /** null when the index gate short-circuited before asking for facts. */
  facts: BlastFacts | null;
  downstream: DownstreamFile[];
  summary?: string | null;
}

/**
 * Assemble the wire contract. Pure, total, and the only place the snake_case
 * shape is built.
 *
 * `caller_count` is `facts.callerCounts[name]`, NOT `callers.length`. The two
 * differ by exactly the point of the field: repo-intel caps the array at
 * MAX_CALLERS_PER_SYMBOL and reports the pre-cap size separately, so deriving
 * the count from the array here would make `truncated` false for every PR that
 * has ever been reviewed. The `?? callers.length` fallback is now only reached by
 * a facts object carrying no counts at all — both repo-intel paths cap and report.
 *
 * `endpoints` is capped here too, and `endpoint_count` carries the pre-cap size
 * so a short list never reads as a small blast radius. The distinct-key sets fed
 * to `totals` are collected BEFORE the cap: the stat row is what a reviewer reads
 * as "how much this reaches", and counting only the listed rows would shrink it.
 *
 * `link_sha` is the index's commit, never the PR head: every `line` below was
 * recorded by the indexer against that tree, so it is the only commit at which
 * they resolve. `index_matches_head` is the one bit a UI needs to say so.
 */
export function toView(input: ToViewInput): BlastRadiusView {
  const facts = input.facts;
  const byDepth = new Map(input.downstream.map((d) => [d.file, d]));
  const callersBySymbol = groupCallers(facts?.callers ?? []);
  const factsByFile = facts?.factsByFile ?? {};
  const attributedEndpoints = new Set<string>();
  const attributedCrons = new Set<string>();

  const symbols: BlastSymbol[] = (facts?.changedSymbols ?? []).map((sym) => {
    const callers = callersBySymbol.get(sym.name) ?? [];
    const callerCount = ownCallerCount(facts?.callerCounts, sym.name) ?? callers.length;
    const endpoints = endpointsForCallers(callers, factsByFile, byDepth);
    for (const endpoint of endpoints) {
      const into = endpoint.kind === 'http' ? attributedEndpoints : attributedCrons;
      into.add(`${endpoint.file}|${endpoint.label}`);
    }
    return {
      name: sym.name,
      kind: sym.kind,
      file: sym.file,
      line: sym.line,
      callers: callers.map(toViewCaller),
      caller_count: callerCount,
      truncated: callerCount > callers.length,
      endpoints: endpoints.slice(0, MAX_VIEW_ENDPOINTS),
      endpoint_count: endpoints.length,
      endpoints_truncated: endpoints.length > MAX_VIEW_ENDPOINTS,
    };
  });

  // `getSymbolRows` has no ORDER BY, so without this two identical requests
  // answer in a different order (`server/INSIGHTS.md:69-80`). Most-called first
  // is also the order a reviewer wants to read.
  symbols.sort(
    (a, b) =>
      b.caller_count - a.caller_count ||
      cmpText(a.file, b.file) ||
      a.line - b.line ||
      cmpText(a.name, b.name),
  );

  // Empty string is what the synthesised degraded `IndexState` carries, and an
  // empty sha in a URL builds `/blob//path`, which is a 404 dressed as a link.
  const linkSha = input.linkSha ? input.linkSha : null;

  return {
    status: input.status,
    reason: input.reason,
    repo_full_name: input.repoFullName,
    head_sha: input.headSha,
    link_sha: linkSha,
    index_matches_head: linkSha !== null && linkSha === input.headSha,
    changed_files: input.changedFiles,
    symbols,
    totals: totals(symbols, attributedEndpoints, attributedCrons, input.downstream),
    summary: input.summary ?? null,
  };
}

function toViewCaller(caller: BlastFactsCaller): BlastViewCaller {
  return { file: caller.file, symbol: caller.symbol, line: caller.line, rank: caller.rank };
}

function groupCallers(callers: BlastFactsCaller[]): Map<string, BlastFactsCaller[]> {
  const out = new Map<string, BlastFactsCaller[]>();
  for (const caller of callers) {
    const group = out.get(caller.viaSymbol);
    if (group) group.push(caller);
    else out.set(caller.viaSymbol, [caller]);
  }
  return out;
}

/**
 * The endpoints and crons a symbol is ATTRIBUTABLY behind: the ones declared in
 * the files its callers live in. Anything further out is real blast radius but
 * cannot be pinned to one symbol, so it is counted in `totals` and not claimed
 * here.
 *
 * `depth` comes from the downstream walk when it saw the file, and falls back to
 * 1 — a file holding a resolved call site imports the changed file by
 * definition, so one hop is the floor, never 0.
 *
 * `line` is 0 on purpose: `file_facts.endpoints` is a `string[]` written by
 * `extractEndpoints`, which records no line. 0 means "this file, no particular
 * line" and must not be rendered as a `#L0` link.
 */
function endpointsForCallers(
  callers: BlastFactsCaller[],
  factsByFile: Record<string, { endpoints: string[]; crons: string[] }>,
  byDepth: Map<string, DownstreamFile>,
): BlastEndpoint[] {
  const out: BlastEndpoint[] = [];
  const seen = new Set<string>();
  for (const file of [...new Set(callers.map((c) => c.file))].sort(cmpText)) {
    // `Object.hasOwn` for the reason `prose` uses it: the keys are repository
    // paths, and a top-level file named `toString` made `factsByFile[file]`
    // resolve to `Object.prototype.toString`. The `if (!fileFacts)` guard passes
    // a function happily, and the loop below then threw "labels is not iterable"
    // — a 500 on `GET /pulls/:id/blast` from a file name.
    if (!Object.hasOwn(factsByFile, file)) continue;
    const fileFacts = factsByFile[file];
    if (!fileFacts) continue;
    const depth = clampDepth(byDepth.get(file)?.depth ?? 1);
    for (const [kind, labels] of [
      ['http', fileFacts.endpoints],
      ['cron', fileFacts.crons],
    ] as const) {
      for (const label of labels) {
        const key = `${kind}|${file}|${label}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ label, file, line: 0, depth, kind });
      }
    }
  }
  return out;
}

/**
 * The stat row. `callers` sums `caller_count`, so it reports what the change
 * actually reaches rather than what fitted under the per-symbol cap.
 *
 * `endpoints` / `crons` count the DISTINCT (file, label) pairs the whole answer
 * knows about — the per-symbol attributions plus everything the depth-2 walk
 * found. Under-reporting here would be the worse error: a change that lands two
 * hops from a route is exactly the case this feature exists to surface, and it
 * would show 0.
 *
 * Which is why the attributed keys arrive as PARAMETERS instead of being read
 * back off `symbols[].endpoints`: that array is capped at MAX_VIEW_ENDPOINTS, and
 * re-deriving the totals from it would silently apply the wire cap to the counts.
 * The sets are copied rather than mutated so this stays a pure function.
 */
function totals(
  symbols: BlastSymbol[],
  attributedEndpoints: ReadonlySet<string>,
  attributedCrons: ReadonlySet<string>,
  downstream: DownstreamFile[],
): BlastRadiusView['totals'] {
  const endpoints = new Set(attributedEndpoints);
  const crons = new Set(attributedCrons);
  for (const file of downstream) {
    for (const label of file.endpoints) endpoints.add(`${file.file}|${label}`);
    for (const label of file.crons) crons.add(`${file.file}|${label}`);
  }
  return {
    symbols: symbols.length,
    callers: symbols.reduce((sum, symbol) => sum + symbol.caller_count, 0),
    endpoints: endpoints.size,
    crons: crons.size,
  };
}

function clampDepth(depth: number): number {
  return Math.min(Math.max(Math.trunc(depth), 0), 2);
}

/** Code-unit order — deterministic across hosts, unlike `localeCompare`. */
function cmpText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Clamp by CODE POINT, never `String.slice`, which splits a surrogate pair and
 * emits a lone half (`server/INSIGHTS.md:164-176`).
 */
function clampCodePoints(text: string, max: number): string {
  const points = [...text];
  return points.length <= max ? text : `${points.slice(0, max).join('')}…`;
}

/**
 * The ONLY facts the summary model is given.
 *
 * Everything in here came out of the index; nothing came out of a diff, a PR
 * body or an issue. That matters twice over: it is what lets the system prompt
 * forbid naming anything absent from the list, and it means a hostile repository
 * cannot smuggle instructions in through a field the model treats as prose —
 * every value is rendered inside a labelled line and clamped.
 */
export function renderSummaryFacts(view: BlastRadiusView): string {
  const lines: string[] = [
    `Repository: ${clampCodePoints(view.repo_full_name, MAX_FACT_CHARS)}`,
    `Index status: ${view.status}${view.reason ? ` (${clampCodePoints(view.reason, MAX_FACT_CHARS)})` : ''}`,
    `Changed files: ${view.changed_files.length}`,
    `Totals: ${view.totals.symbols} symbols, ${view.totals.callers} callers, ${view.totals.endpoints} HTTP endpoints, ${view.totals.crons} crons`,
    '',
  ];

  if (view.symbols.length === 0) {
    lines.push('No changed symbols were resolved in the index.');
    return lines.join('\n');
  }

  lines.push('Changed symbols and their call sites:');
  for (const symbol of view.symbols.slice(0, MAX_PROMPT_SYMBOLS)) {
    lines.push(
      clampCodePoints(
        `- ${symbol.name} (${symbol.kind}) declared in ${symbol.file}:${symbol.line} — ${symbol.caller_count} caller(s)${symbol.truncated ? `, ${symbol.callers.length} listed` : ''}`,
        MAX_FACT_CHARS,
      ),
    );
    for (const caller of symbol.callers.slice(0, MAX_PROMPT_CALLERS)) {
      lines.push(
        clampCodePoints(`    called by ${caller.symbol} at ${caller.file}:${caller.line}`, MAX_FACT_CHARS),
      );
    }
    for (const endpoint of symbol.endpoints.slice(0, MAX_PROMPT_ENDPOINTS)) {
      lines.push(
        clampCodePoints(
          `    reaches ${endpoint.kind === 'http' ? 'endpoint' : 'cron'} ${endpoint.label} in ${endpoint.file} (${endpoint.depth} hop(s))`,
          MAX_FACT_CHARS,
        ),
      );
    }
    // Counted off `endpoint_count`, not off the array, so the sentence covers
    // BOTH caps: what this prompt dropped and what the wire dropped before it.
    if (symbol.endpoint_count > MAX_PROMPT_ENDPOINTS) {
      lines.push(
        `    (${symbol.endpoint_count - MAX_PROMPT_ENDPOINTS} further endpoint(s) or cron(s) not listed.)`,
      );
    }
  }
  if (view.symbols.length > MAX_PROMPT_SYMBOLS) {
    lines.push(`(${view.symbols.length - MAX_PROMPT_SYMBOLS} further symbol(s) not listed.)`);
  }
  return lines.join('\n');
}
