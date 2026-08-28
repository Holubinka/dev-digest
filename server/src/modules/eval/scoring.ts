import type { EvalExpectation, Finding } from '@devdigest/shared';

/**
 * eval — recall, precision and citation_accuracy, computed entirely in code.
 *
 * PURE, and that purity is the evidence for AC-38 rather than a matter of
 * taste: this file imports contracts and nothing else — no container, no port,
 * no clock, no provider — so `test/eval-scoring.test.ts` constructs none of
 * them, and "the metrics involve no model call" is provable by reading the
 * imports instead of by trusting a mock's call counter.
 *
 * Crediting is by FILE PATH + INTERSECTING LINE RANGE only (D5/AC-39).
 * `severity`, `category` and `title` are stored on an expectation and shown in
 * the editor, and are never consulted here — the moment they were, the scorer
 * would quietly become a text comparison and the harness would measure the
 * model's phrasing rather than its aim.
 *
 * Findings that overlap ONE ANOTHER on the same file are collapsed to one
 * before crediting (`dedupeOverlapping`) — a model reporting one real issue as
 * two or three adjacent citations should not be double-penalised as noise for
 * its own correct answer. Findings that do NOT touch each other are never
 * collapsed: that is still noise, and is what makes precision react to a
 * prompt told to report more (D7). `citation_accuracy` is computed from the
 * RAW (pre-dedup) count — it measures the citation gate, not this refinement.
 */

/** The raw numerators and denominators one case contributes to its batch. */
export interface ScoreCounters {
  /** `must_find` expectations of this case. */
  mustFindTotal: number;
  /** …of which a finding closed. */
  mustFindCredited: number;
  /** Findings that survived the citation gate, RAW — citation_accuracy's numerator. Unaffected by dedup. */
  keptTotal: number;
  /** Findings after collapsing mutually-overlapping duplicates (see `dedupeOverlapping`) — precision's denominator. */
  dedupedTotal: number;
  /** …of which closed a `must_find`. The rest are noise. */
  dedupedCredited: number;
  /** Findings the model returned INTO the gate (kept + dropped). */
  returnedTotal: number;
}

export interface CaseScore {
  pass: boolean;
  recall: number;
  precision: number;
  citation_accuracy: number;
  counters: ScoreCounters;
}

export interface CreditResult {
  /** For each expectation, the index of the finding that claimed it, or -1. */
  findingForExpectation: number[];
  /** For each finding, the index of the expectation it claimed, or -1. */
  expectationForFinding: number[];
}

/** Both endpoints are untrusted numbers; normalise before comparing. */
function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  const aLo = Math.min(aStart, aEnd);
  const aHi = Math.max(aStart, aEnd);
  const bLo = Math.min(bStart, bEnd);
  const bHi = Math.max(bStart, bEnd);
  // Interval intersection in O(1). Deliberately not "walk one range and test
  // membership": `end_line` is unbounded model output (`Finding` declares it
  // `z.number().int()`), and iterating a declared range is the 13-second block
  // `reviewer-core/src/grounding.ts:44-49` records.
  return Math.max(aLo, bLo) <= Math.min(aHi, bHi);
}

/**
 * Collapse findings that overlap ONE ANOTHER, on the same file, into one.
 *
 * A model frequently reports a single real issue as two or three findings
 * whose ranges are adjacent or overlapping — a route handler cited once for
 * its signature and once for its body, the same SSRF call cited three times
 * with a one-line difference in `start_line`. Scored individually, only the
 * first credits its expectation and the rest become "noise" a case can never
 * shed, even when every one of them points at the real issue. Two findings
 * whose ranges do not touch are NOT collapsed — that noise is exactly what
 * D7 wants surfaced, and is why `must_not_flag` regressions still get caught.
 *
 * The representative keeps the first finding's other fields (id, severity,
 * category, …) and takes the UNION of the cluster's line range, so the merged
 * citation honestly spans everything the model pointed at rather than
 * arbitrarily picking one sub-range.
 *
 * Transitive: if A overlaps B and B overlaps C, all three merge into one, even
 * when A and C do not directly touch — a simple union-find over one file's
 * findings, since a case's fragment is one file and this never runs at
 * PR-diff scale (D7 caps `input_diff` at one file's hunks).
 */
export function dedupeOverlapping(findings: Finding[]): Finding[] {
  const byFile = new Map<string, number[]>();
  for (let i = 0; i < findings.length; i++) {
    const file = findings[i]!.file;
    const idx = byFile.get(file);
    if (idx) idx.push(i);
    else byFile.set(file, [i]);
  }

  const parent = findings.map((_, i) => i);
  function find(i: number): number {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  }
  function union(a: number, b: number): void {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  }

  for (const idx of byFile.values()) {
    for (let a = 0; a < idx.length; a++) {
      for (let b = a + 1; b < idx.length; b++) {
        const fa = findings[idx[a]!]!;
        const fb = findings[idx[b]!]!;
        if (overlaps(fa.start_line, fa.end_line, fb.start_line, fb.end_line)) {
          union(idx[a]!, idx[b]!);
        }
      }
    }
  }

  const clusters = new Map<number, number[]>();
  for (let i = 0; i < findings.length; i++) {
    const root = find(i);
    const members = clusters.get(root);
    if (members) members.push(i);
    else clusters.set(root, [i]);
  }

  const result: Finding[] = [];
  for (const members of clusters.values()) {
    const first = findings[members[0]!]!;
    let lo = first.start_line;
    let hi = first.end_line;
    for (const m of members) {
      const f = findings[m]!;
      lo = Math.min(lo, f.start_line, f.end_line);
      hi = Math.max(hi, f.start_line, f.end_line);
    }
    result.push(members.length === 1 ? first : { ...first, start_line: lo, end_line: hi });
  }
  return result;
}

/**
 * Assign findings to expectations, one to one (AC-40).
 *
 * Deterministic greedy over ARRAY ORDER: walk expectations as the author wrote
 * them and take the first not-yet-claimed finding on the same path whose range
 * intersects. Determinism is what makes AC-26 checkable — the same inputs must
 * produce the same numbers on every run, and an assignment that depended on
 * iteration order of a map would not.
 *
 * `must_not_flag` expectations take part in the assignment. They must: a
 * finding that lands on one is noise (AC-43), and letting it stay unclaimed
 * would leave it free to close a later `must_find` it was never about.
 */
export function creditFindings(
  expectations: EvalExpectation[],
  findings: Finding[],
): CreditResult {
  const findingForExpectation = new Array<number>(expectations.length).fill(-1);
  const expectationForFinding = new Array<number>(findings.length).fill(-1);

  for (let e = 0; e < expectations.length; e++) {
    const exp = expectations[e]!;
    for (let f = 0; f < findings.length; f++) {
      if (expectationForFinding[f] !== -1) continue;
      const finding = findings[f]!;
      if (finding.file !== exp.file) continue;
      if (!overlaps(exp.start_line, exp.end_line, finding.start_line, finding.end_line)) continue;
      findingForExpectation[e] = f;
      expectationForFinding[f] = e;
      break;
    }
  }

  return { findingForExpectation, expectationForFinding };
}

/** A ratio whose empty denominator is 1 — "nothing was asked, nothing was missed". */
function ratio(numerator: number, denominator: number): number {
  if (denominator <= 0) return 1;
  return clamp01(numerator / denominator);
}

/** AC-51. The contract declares all three `.min(0).max(1)` and would throw otherwise. */
function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export interface ScoreCaseInput {
  expectations: EvalExpectation[];
  /** Findings that survived the citation gate. */
  kept: Finding[];
  /** How many findings the model returned INTO the gate (kept + dropped). */
  returned: number;
}

/**
 * Score one case.
 *
 * The rules, each with the criterion it encodes:
 *  - a finding on a `must_not_flag` credits nothing and is noise (AC-43);
 *  - a finding matching no expectation is noise too, even elsewhere in the same
 *    fragment (AC-44) — that is the price of D7, and it is what makes precision
 *    react to a prompt told to report more;
 *  - a finding the gate dropped credits nothing and is outside precision's
 *    denominator (AC-46) — it never appears in `kept`;
 *  - no `must_find` → recall 1, and nothing added to the pooled denominator (AC-47);
 *  - no findings at all → precision and citation_accuracy 1, and nothing added
 *    to theirs (AC-48);
 *  - pass only when every `must_find` is credited AND no noise remains (AC-49).
 */
export function scoreCase(input: ScoreCaseInput): CaseScore {
  const { expectations, kept, returned } = input;
  const deduped = dedupeOverlapping(kept);
  const { findingForExpectation, expectationForFinding } = creditFindings(expectations, deduped);

  let mustFindTotal = 0;
  let mustFindCredited = 0;
  for (let e = 0; e < expectations.length; e++) {
    if (expectations[e]!.polarity !== 'must_find') continue;
    mustFindTotal++;
    if (findingForExpectation[e] !== -1) mustFindCredited++;
  }

  let dedupedCredited = 0;
  for (let f = 0; f < deduped.length; f++) {
    const e = expectationForFinding[f]!;
    if (e !== -1 && expectations[e]!.polarity === 'must_find') dedupedCredited++;
  }

  const counters: ScoreCounters = {
    mustFindTotal,
    mustFindCredited,
    keptTotal: kept.length,
    dedupedTotal: deduped.length,
    dedupedCredited,
    returnedTotal: returned,
  };

  const noise = deduped.length - dedupedCredited;
  return {
    pass: mustFindCredited === mustFindTotal && noise === 0,
    recall: ratio(mustFindCredited, mustFindTotal),
    precision: ratio(dedupedCredited, deduped.length),
    citation_accuracy: ratio(kept.length, returned),
    counters,
  };
}

export interface PooledMetrics {
  recall: number;
  precision: number;
  citation_accuracy: number;
}

/**
 * Pool a batch: MICRO-average over merged counters (AC-50 / D14).
 *
 * Summing numerators and denominators, never averaging per-case ratios. A case
 * with one expectation would otherwise weigh as much as a case with ten, and
 * the harness would report improvements that are re-weightings of the set.
 *
 * Errored cases contribute no counters at all, so they are outside every
 * denominator (AC-33) — the caller simply does not pass them in.
 */
export function poolBatch(counters: ScoreCounters[]): PooledMetrics {
  let mustFindTotal = 0;
  let mustFindCredited = 0;
  let keptTotal = 0;
  let dedupedTotal = 0;
  let dedupedCredited = 0;
  let returnedTotal = 0;

  for (const c of counters) {
    mustFindTotal += c.mustFindTotal;
    mustFindCredited += c.mustFindCredited;
    keptTotal += c.keptTotal;
    dedupedTotal += c.dedupedTotal;
    dedupedCredited += c.dedupedCredited;
    returnedTotal += c.returnedTotal;
  }

  return {
    recall: ratio(mustFindCredited, mustFindTotal),
    precision: ratio(dedupedCredited, dedupedTotal),
    citation_accuracy: ratio(keptTotal, returnedTotal),
  };
}
