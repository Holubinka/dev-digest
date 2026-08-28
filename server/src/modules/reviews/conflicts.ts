/**
 * "Where agents disagree" — the POSITIONS of one multi-run.
 *
 * Core ring: pure over its arguments, no `this`, no I/O, no clock, and above all
 * NO MODEL CALL (SPEC-05 § AC-65, § D2). The grouping rule is deterministic
 * while its input is not, which is why the tests hand it fixed findings rather
 * than running an agent.
 *
 * Nothing here decides whether a position is a CONFLICT. AC-126 is stated
 * entirely over the takes, so it stays one function on the client and the
 * contract gains no `is_conflict` field that could disagree with the takes sat
 * beside it in the same response.
 */

import type { AgentColumnStatus, Conflict, ConflictTake, FindingRecord, Severity } from '@devdigest/shared';

/**
 * Jaccard similarity at or above which two titles count as the same claim
 * (AC-67). 0.5 = half the surviving tokens shared; "Hardcoded Stripe secret key"
 * and "Stripe secret key hardcoded here" score 1.0, and two unrelated findings
 * on the same lines score 0.
 */
export const DEFAULT_TITLE_SIMILARITY = 0.5;

/**
 * Words carrying no claim, removed before comparing two titles (AC-67).
 *
 * A FIXED list, and a fixed splitter beside it: neither may be derived from a
 * title. Finding titles are model output written against an untrusted diff, and
 * `new RegExp(thatText)` is a ReDoS on exactly that path
 * (`SPEC-05 § Untrusted inputs`, `security` § "RegExp(userInput) enables ReDoS").
 *
 * Function words only. A domain word — "missing", "unbounded", "hardcoded" — is
 * what makes two titles the same claim, so removing any of them would merge
 * findings that share nothing but grammar.
 */
export const DEFAULT_TITLE_STOP_WORDS: ReadonlySet<string> = new Set([
  'an', 'and', 'are', 'as', 'at', 'be', 'been', 'being', 'but', 'by', 'can',
  'could', 'do', 'does', 'for', 'from', 'has', 'have', 'if', 'in', 'into', 'is',
  'it', 'its', 'may', 'might', 'must', 'not', 'of', 'on', 'or', 'should', 'so',
  'than', 'that', 'the', 'their', 'then', 'there', 'these', 'they', 'this',
  'those', 'to', 'was', 'were', 'when', 'which', 'will', 'with', 'would',
]);

/** The one splitter, a literal, compiled once and never built from an input. */
const NON_ALPHANUMERIC = /[^a-z0-9]+/;

/** Heavier severity wins a tie-break; the numbers are ranks, not scores. */
const SEVERITY_RANK: Record<Severity, number> = { CRITICAL: 3, WARNING: 2, SUGGESTION: 1 };

/** One agent's slot in the multi-run, in the order the columns are drawn. */
export interface ConflictAgent {
  runId: string;
  agentId: string | null;
  agentName: string;
  /**
   * What decides `not_reviewed`, and the reason it is a required field: a caller
   * that forgets the run's state cannot compile, rather than producing invented
   * silence from an agent that never looked (AC-119, § D22).
   */
  status: AgentColumnStatus;
}

/** One persisted finding, tagged with the run that produced it. */
export interface ConflictFinding {
  runId: string;
  finding: FindingRecord;
}

export interface ConflictOptions {
  threshold?: number;
  stopWords?: ReadonlySet<string>;
}

/**
 * A title reduced to the tokens that carry its claim: lowercased, split on the
 * literal pattern above, single characters and stop-words dropped, deduped and
 * sorted. Sorted so the result is a set with a stable printed form, which is
 * what makes the similarity below independent of word order.
 */
export function normalizeTitle(
  title: string,
  stopWords: ReadonlySet<string> = DEFAULT_TITLE_STOP_WORDS,
): string[] {
  const tokens = title
    .toLowerCase()
    .split(NON_ALPHANUMERIC)
    .filter((tok) => tok.length > 1 && !stopWords.has(tok));
  return [...new Set(tokens)].sort();
}

/** Jaccard over two token sets. Two empty sets score 0 — an empty title is not
 *  evidence of agreement with another empty one. */
function similarity(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const left = new Set(a);
  let shared = 0;
  for (const token of new Set(b)) if (left.has(token)) shared += 1;
  const union = left.size + new Set(b).size - shared;
  return union === 0 ? 0 : shared / union;
}

interface Member {
  runId: string;
  finding: FindingRecord;
  /** Normalised so `start <= end`, whatever the model wrote. */
  start: number;
  end: number;
  tokens: string[];
}

/** AC-66, verbatim: same file, intersecting ranges, and same category OR similar titles. */
function related(a: Member, b: Member, threshold: number): boolean {
  if (a.finding.file !== b.finding.file) return false;
  if (!(a.start <= b.end && b.start <= a.end)) return false;
  return a.finding.category === b.finding.category || similarity(a.tokens, b.tokens) >= threshold;
}

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The named deterministic rule AC-73 and AC-74 both need: severity desc,
 * confidence desc, start line asc, then id asc as a string. A TOTAL order —
 * finding ids are unique — so "the heaviest" is never two answers.
 */
function heavier(a: Member, b: Member): number {
  const bySeverity = SEVERITY_RANK[b.finding.severity] - SEVERITY_RANK[a.finding.severity];
  if (bySeverity !== 0) return bySeverity;
  const byConfidence = b.finding.confidence - a.finding.confidence;
  if (byConfidence !== 0) return byConfidence;
  if (a.start !== b.start) return a.start - b.start;
  return compare(a.finding.id, b.finding.id);
}

const heaviestOf = (members: readonly Member[]): Member =>
  members.reduce((best, m) => (heavier(m, best) < 0 ? m : best));

/**
 * Connected components of `related` over one file's members (AC-68), by
 * union-find. Restricted to one file because `related` already requires the
 * files to match, so cross-file pairs cannot join a component — which turns the
 * quadratic pair scan into a per-file one and is the whole reason 500 findings
 * fit inside the 250 ms of § Non-functional requirements.
 */
function componentsWithinFile(members: Member[], threshold: number): Member[][] {
  const parent = members.map((_, i) => i);
  const find = (i: number): number => {
    let root = i;
    while (parent[root] !== root) root = parent[root]!;
    let walk = i;
    while (parent[walk] !== root) {
      const next = parent[walk]!;
      parent[walk] = root;
      walk = next;
    }
    return root;
  };
  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) {
      if (related(members[i]!, members[j]!, threshold)) parent[find(i)] = find(j);
    }
  }
  const groups = new Map<number, Member[]>();
  for (let i = 0; i < members.length; i++) {
    const root = find(i);
    const bucket = groups.get(root);
    if (bucket) bucket.push(members[i]!);
    else groups.set(root, [members[i]!]);
  }
  return [...groups.values()];
}

/**
 * Group one multi-run's findings into positions, each carrying one take per
 * agent (AC-70).
 *
 * `agents` is in multi-run order and the takes come back in that same order, so
 * the picker, the columns, the tabs and the takes all read alike (AC-46).
 */
export function buildConflicts(
  agents: readonly ConflictAgent[],
  findings: readonly ConflictFinding[],
  opts: ConflictOptions = {},
): Conflict[] {
  const threshold = opts.threshold ?? DEFAULT_TITLE_SIMILARITY;
  const stopWords = opts.stopWords ?? DEFAULT_TITLE_STOP_WORDS;

  // ONLY findings of runs that reached `done` enter the grouping at all. A run
  // that is queued, running, failed or cancelled persists no review on the real
  // path (`run-executor.ts` `persistFailure` writes no `reviews` row), so this
  // costs nothing in practice — and it is what keeps AC-119 and the membership
  // of a position from ever disagreeing about the same agent.
  const doneRunIds = new Set(agents.filter((a) => a.status === 'done').map((a) => a.runId));

  const byFile = new Map<string, Member[]>();
  for (const { runId, finding } of findings) {
    if (!doneRunIds.has(runId)) continue;
    const start = Math.min(finding.start_line, finding.end_line);
    const end = Math.max(finding.start_line, finding.end_line);
    const member: Member = {
      runId,
      finding,
      start,
      end,
      tokens: normalizeTitle(finding.title, stopWords),
    };
    const bucket = byFile.get(finding.file);
    if (bucket) bucket.push(member);
    else byFile.set(finding.file, [member]);
  }

  const positions: { position: Conflict; smallestId: string }[] = [];
  for (const members of byFile.values()) {
    for (const component of componentsWithinFile(members, threshold)) {
      // EVERY component is a position, one that a single run touched included.
      // The silence of a FINISHED agent is an opinion, and showing it is what
      // the section is for: the mockup's own example
      // (`specs/assets/SPEC-05-multi-agent-review-columns.png`, "Magic number
      // 3600") is one SUGGESTION beside two `did not flag`. Dropping the lone
      // component hid exactly that case — one agent flags, four finish silently,
      // and the section is empty — so the human chose the mockup over the spec
      // on 2026-08-27.
      //
      // `not_reviewed` is untouched: an agent whose run never reached `done`
      // still counts neither for nor against, because its findings never
      // entered the grouping above (AC-119, AC-120). AC-128 survives as a
      // special case of this rule rather than as the only exception to it.
      //
      // THE COST IS VOLUME, and it was weighed: five agents with ten findings
      // each and no overlap is fifty positions. The "Show only conflicts"
      // toggle is the filter for that, and the duplicates it does merge are the
      // reason the section beats reading five columns side by side.
      positions.push({
        position: toPosition(agents, component),
        // The last tiebreak of the sort below, carried beside the position
        // rather than on it: it is a sort key, not something the screen draws,
        // and a field on `Conflict` would put it on the wire for nobody.
        smallestId: component
          .map((m) => m.finding.id)
          .reduce((min, id) => (id < min ? id : min)),
      });
    }
  }

  // AC-69: the same finding set yields the same positions in the same order.
  // A TOTAL order, because each finding belongs to exactly one component, so
  // the smallest member id identifies the component uniquely.
  return positions
    .sort(
      (a, b) =>
        compare(a.position.file, b.position.file) ||
        a.position.start_line - b.position.start_line ||
        a.position.end_line - b.position.end_line ||
        compare(a.position.title, b.position.title) ||
        compare(a.smallestId, b.smallestId),
    )
    .map((p) => p.position);
}

function toPosition(agents: readonly ConflictAgent[], component: readonly Member[]): Conflict {
  const byRun = new Map<string, Member[]>();
  for (const member of component) {
    const bucket = byRun.get(member.runId);
    if (bucket) bucket.push(member);
    else byRun.set(member.runId, [member]);
  }

  const takes: ConflictTake[] = agents.map((agent) => {
    // ORDER IS THE RULE. The run's state is asked FIRST, before anything is
    // asked about findings, so AC-119's "iff" holds and a failed or cancelled
    // run cannot decay to `ignored` once the multi-run has ended (AC-120).
    // Swapping these two branches produces the same shape with a different
    // word, and the word is the whole criterion.
    if (agent.status !== 'done') {
      return base(agent, 'not_reviewed', null);
    }
    const mine = byRun.get(agent.runId);
    if (!mine) {
      // It reached `done` and stayed silent here: it looked and passed (AC-71).
      return base(agent, 'ignored', null);
    }
    const heaviest = heaviestOf(mine);
    // `null`, never `''`: an empty string is a note that is empty (AC-71).
    return base(agent, heaviest.finding.severity, heaviest.finding.rationale);
  });

  const heaviest = heaviestOf(component);
  return {
    file: heaviest.finding.file,
    start_line: Math.min(...component.map((m) => m.start)),
    end_line: Math.max(...component.map((m) => m.end)),
    // AC-74: derived from the members by the same deterministic rule, never
    // from a model — the heaviest member's own title.
    title: heaviest.finding.title,
    takes,
  };
}

const base = (
  agent: ConflictAgent,
  verdict: ConflictTake['verdict'],
  note: string | null,
): ConflictTake => ({
  run_id: agent.runId,
  agent_id: agent.agentId,
  persona: agent.agentName,
  verdict,
  note,
});
