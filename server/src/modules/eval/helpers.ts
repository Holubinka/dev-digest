/**
 * eval — pure transforms. No container, no I/O, no clock beyond what is handed
 * in. Everything here is a function of its arguments.
 */

import {
  EvalBatchAggregate,
  EvalExpectations,
  FindingCategory,
  Severity,
  type EvalBatchSummary,
  type EvalCase,
  type EvalCaseRow,
  type EvalRunRecord,
  type EvalTrendPoint,
  type SkillEvalCaseRow,
} from '@devdigest/shared';
import type {
  BatchRow,
  EvalCaseDbRow,
  LatestRunRow,
  RunWithCaseRow,
  SkillCaseRow,
} from './repository.js';
import { FINDING_MARKER } from './repository.js';
import { MAX_CASE_NAME_CHARS } from './constants.js';

/**
 * Cut to `max` CODE POINTS, not UTF-16 units.
 *
 * `String.slice` counts units, so a fixed offset can land between the halves of
 * a surrogate pair and emit a lone half — and reviewer text, PR bodies above
 * all, routinely carry emoji. Same approach as `modules/pulls/status.ts`.
 */
export function truncateCodePoints(text: string, max: number): string {
  const chars = [...text];
  return chars.length > max ? `${chars.slice(0, max).join('')}…` : text;
}

/** A case name from a finding title (AC-7). ASCII slug, never empty. */
export function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_CASE_NAME_CHARS);
  return slug.length > 0 ? slug : 'eval-case';
}

/**
 * `base`, or `base-2`, `base-3`, … — the smallest free numeric suffix in this
 * agent's set (AC-8). Uniqueness is per owner, which is why `taken` is the
 * owner's names rather than the workspace's.
 */
export function uniqueName(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!used.has(candidate)) return candidate;
  }
}

/**
 * The provenance line written into `notes` (AC-9).
 *
 * PLAIN TEXT and no foreign key, because D11 forbids one: a finding cascades
 * away with its review and its PR, and a dataset that vanishes with the PR it
 * came from is not a regression guard. `FINDING_MARKER` is what
 * `caseByFindingId` matches, so the second click opens the existing case
 * instead of creating a twin (AC-10).
 */
export function provenanceNote(args: {
  findingId: string;
  repo: string;
  prNumber: number;
  decision: 'accepted' | 'dismissed';
  decidedAt: Date;
}): string {
  return (
    `Created from ${FINDING_MARKER}${args.findingId} — ` +
    `${args.repo} PR #${args.prNumber}, ` +
    `${args.decision} on ${args.decidedAt.toISOString()}.`
  );
}

/** A finding's stored severity/category are plain `text` columns; keep only legal values. */
export function asSeverity(value: string): Severity | null {
  const parsed = Severity.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function asCategory(value: string): FindingCategory | null {
  const parsed = FindingCategory.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** `expected_output` is `z.unknown()` in the column's contract; read it defensively. */
export function readExpectations(value: unknown): EvalExpectations {
  const parsed = EvalExpectations.safeParse(value ?? []);
  return parsed.success ? parsed.data : [];
}

export function toEvalCase(row: EvalCaseDbRow): EvalCase {
  return {
    id: row.id,
    owner_kind: row.ownerKind,
    owner_id: row.ownerId,
    name: row.name,
    input_diff: row.inputDiff ?? '',
    input_files: row.inputFiles,
    input_meta: row.inputMeta,
    expected_output: row.expectedOutput,
    notes: row.notes,
  };
}

/**
 * `last.skills` is raw jsonb (`unknown`) from a column typed `z.unknown()` in
 * the contract — a row written before this field existed has it `undefined`,
 * and nothing guarantees a well-formed array even now. Malformed or absent
 * both read as "no skills recorded" rather than throwing: this is a display
 * value, not a security or scoring decision.
 */
function parseRunSkills(raw: unknown): { id: string; name: string }[] {
  if (!Array.isArray(raw)) return [];
  const out: { id: string; name: string }[] = [];
  for (const entry of raw) {
    if (
      entry &&
      typeof entry === 'object' &&
      typeof (entry as Record<string, unknown>).id === 'string' &&
      typeof (entry as Record<string, unknown>).name === 'string'
    ) {
      out.push({ id: (entry as { id: string }).id, name: (entry as { name: string }).name });
    }
  }
  return out;
}

export function toCaseRow(row: EvalCaseDbRow, last: LatestRunRow | undefined): EvalCaseRow {
  return {
    id: row.id,
    name: row.name,
    owner_kind: row.ownerKind,
    owner_id: row.ownerId,
    notes: row.notes,
    expected_count: readExpectations(row.expectedOutput).length,
    // `null` is the tab's THIRD state — never run — and is not the same as a
    // run that failed. Collapsing them would make a broken agent and an
    // untouched case look alike (AC-14).
    last_run:
      last === undefined
        ? null
        : {
            ran_at: new Date(last.ran_at).toISOString(),
            pass: last.pass,
            recall: last.recall,
            precision: last.precision,
            citation_accuracy: last.citation_accuracy,
            findings_count: Number(last.findings_count),
            skills: parseRunSkills(last.skills),
          },
  };
}

/**
 * `SkillCaseRow` → the row a skill's own Evals tab renders. `casesForSkill`
 * (repository) already filtered to runs that HAD this skill active, so
 * `skills` here is never empty — unlike `toCaseRow`, where it usually is.
 */
export function toSkillCaseRow(row: SkillCaseRow): SkillEvalCaseRow {
  return {
    id: row.case_id,
    name: row.case_name,
    owner_kind: 'agent',
    owner_id: row.agent_id,
    agent_name: row.agent_name,
    notes: row.notes,
    expected_count: readExpectations(row.expected_output).length,
    last_run: {
      ran_at: new Date(row.ran_at).toISOString(),
      pass: row.pass,
      recall: row.recall,
      precision: row.precision,
      citation_accuracy: row.citation_accuracy,
      findings_count: Number(row.findings_count),
      skills: parseRunSkills(row.skills),
    },
  };
}

export function toRunRecord(row: RunWithCaseRow): EvalRunRecord {
  return {
    id: row.run.id,
    case_id: row.run.caseId,
    case_name: row.caseName,
    ran_at: row.run.ranAt.toISOString(),
    actual_output: row.run.actualOutput,
    pass: row.run.pass,
    recall: row.run.recall,
    precision: row.run.precision,
    citation_accuracy: row.run.citationAccuracy,
    duration_ms: row.run.durationMs,
    cost_usd: row.run.costUsd,
  };
}

/**
 * A batch row → the summary every table and the comparison shows.
 *
 * `undefined` when the stored aggregate does not parse: `actual_output` is
 * `z.unknown()` in the contract, so a row hand-edited in the database must be
 * skipped rather than crash a dashboard read.
 */
export function toBatchSummary(
  row: BatchRow,
  agentName: string,
): EvalBatchSummary | undefined {
  const parsed = EvalBatchAggregate.safeParse(row.aggregate);
  if (!parsed.success) return undefined;
  const agg = parsed.data;
  return {
    batch_id: agg.batch_id,
    agent_id: row.owner_id,
    agent_name: agentName,
    agent_version: Number(row.agent_version),
    ran_at: new Date(row.ran_at).toISOString(),
    cases: agg.cases,
    passed: agg.passed,
    errored: agg.errored,
    recall: agg.recall,
    precision: agg.precision,
    citation_accuracy: agg.citation_accuracy,
    cost_usd: agg.cost_usd,
    duration_ms: agg.duration_ms,
  };
}

/** The stored `case_ids` of a batch — what makes `like_for_like` answerable. */
export function caseIdsOf(row: BatchRow): string[] {
  const parsed = EvalBatchAggregate.safeParse(row.aggregate);
  return parsed.success ? parsed.data.case_ids : [];
}

/** One point of the trend chart, from a completed batch. */
export function toTrendPoint(summary: EvalBatchSummary): EvalTrendPoint {
  return {
    ran_at: summary.ran_at,
    recall: summary.recall,
    precision: summary.precision,
    citation_accuracy: summary.citation_accuracy,
    pass_rate: summary.cases > 0 ? summary.passed / summary.cases : 0,
    cost_usd: summary.cost_usd,
  };
}

/**
 * The banner (AC-57), generated FROM THE NUMBERS, in code, with no model call.
 *
 * `null` below two completed batches (AC-56): a delta is the difference of two
 * values, and inventing one from a single batch would be a claim about a
 * comparison that never happened.
 */
export function banner(
  latest: EvalBatchSummary | undefined,
  previous: EvalBatchSummary | undefined,
): string | null {
  if (!latest || !previous) return null;
  const metrics: { key: 'recall' | 'precision' | 'citation_accuracy'; label: string }[] = [
    { key: 'recall', label: 'Recall' },
    { key: 'precision', label: 'Precision' },
    { key: 'citation_accuracy', label: 'Citation accuracy' },
  ];
  let worst = metrics[0]!;
  let worstDelta = latest.recall - previous.recall;
  for (const m of metrics) {
    const delta = latest[m.key] - previous[m.key];
    if (delta < worstDelta) {
      worst = m;
      worstDelta = delta;
    }
  }
  const pct = (v: number) => `${Math.round(Math.abs(v) * 100)} pp`;
  if (worstDelta < 0) {
    return `${worst.label} fell ${pct(worstDelta)} in v${latest.agent_version} compared with v${previous.agent_version}.`;
  }
  let best = metrics[0]!;
  let bestDelta = latest.recall - previous.recall;
  for (const m of metrics) {
    const delta = latest[m.key] - previous[m.key];
    if (delta > bestDelta) {
      best = m;
      bestDelta = delta;
    }
  }
  if (bestDelta > 0) {
    return `${best.label} rose ${pct(bestDelta)} in v${latest.agent_version} compared with v${previous.agent_version}.`;
  }
  return `No metric moved between v${previous.agent_version} and v${latest.agent_version}.`;
}

/**
 * Ceiling above which the line diff falls back to prefix/suffix.
 *
 * The LCS below is O(n·m) in time AND memory. A system prompt is normally under
 * 200 lines, but it is user-supplied text with no line ceiling of its own, so
 * two 5 000-line prompts would allocate 25 million cells inside a request. The
 * fallback over-highlights; it does not hang.
 */
const LCS_CELL_LIMIT = 400_000;

/**
 * The 1-based line numbers of `next` that `prev` does not contain in the same
 * position of the longest common subsequence — i.e. what AC-61 highlights.
 *
 * Computed HERE rather than in the browser so both halves of the comparison are
 * one server answer, and so "the prompt did not change" (AC-62) is decided once.
 */
export function changedLines(prev: string, next: string): number[] {
  if (prev === next) return [];
  const a = prev.split('\n');
  const b = next.split('\n');

  if (a.length * b.length > LCS_CELL_LIMIT) {
    let head = 0;
    while (head < a.length && head < b.length && a[head] === b[head]) head++;
    let tail = 0;
    while (
      tail < a.length - head &&
      tail < b.length - head &&
      a[a.length - 1 - tail] === b[b.length - 1 - tail]
    ) {
      tail++;
    }
    const out: number[] = [];
    for (let i = head; i < b.length - tail; i++) out.push(i + 1);
    return out;
  }

  // Classic LCS length table, then a backward walk that marks every line of `b`
  // not on the common subsequence.
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dp = new Uint32Array(rows * cols);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      dp[i * cols + j] =
        a[i] === b[j]
          ? dp[(i + 1) * cols + (j + 1)]! + 1
          : Math.max(dp[(i + 1) * cols + j]!, dp[i * cols + (j + 1)]!);
    }
  }

  const changed: number[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
    } else if (dp[(i + 1) * cols + j]! >= dp[i * cols + (j + 1)]!) {
      i++;
    } else {
      changed.push(j + 1);
      j++;
    }
  }
  for (; j < b.length; j++) changed.push(j + 1);
  return changed;
}

/** The system prompt out of an `agent_versions.config_json` snapshot. */
export function promptFromSnapshot(configJson: unknown): string {
  const cfg = configJson as { system_prompt?: unknown } | null | undefined;
  return typeof cfg?.system_prompt === 'string' ? cfg.system_prompt : '';
}
