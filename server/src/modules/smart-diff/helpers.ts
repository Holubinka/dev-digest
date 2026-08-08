import type { SmartDiff, SmartDiffFile, SmartDiffGroup, SmartDiffRole } from '@devdigest/shared';
import {
  BOILERPLATE_PATTERNS,
  MAX_FINDING_LINE_SPAN,
  MAX_REVIEWABLE_LINES,
  MIN_SPLIT_FILES,
  ROLE_ORDER,
  SPLIT_NAMES,
  WIRING_PATTERNS,
} from './constants.js';

/**
 * Smart Diff assembly — pure (no DB, no `this`, no clock), like `pulls/status.ts`,
 * so the whole classifier unit-tests without a container.
 *
 * `patch` is deliberately absent from the input: the role of a file is decided by
 * its path and its size, never by its contents, and the client already holds the
 * patch text from `GET /pulls/:id`.
 */

/** The columns `buildSmartDiff` needs off a `pr_files` row. */
export interface SmartDiffInputFile {
  path: string;
  additions: number;
  deletions: number;
}

/** One finding's cited range, as the overlay needs it. */
export interface FindingRange {
  file: string;
  startLine: number;
  endLine: number;
}

/**
 * Path → role. Normalises a leading `./` first so `./package.json` and
 * `package.json` cannot disagree.
 */
export function classifyPath(path: string): SmartDiffRole {
  const normalised = path.replace(/^\.?\//, '');
  if (BOILERPLATE_PATTERNS.some((re) => re.test(normalised))) return 'boilerplate';
  if (WIRING_PATTERNS.some((re) => re.test(normalised))) return 'wiring';
  return 'core';
}

/**
 * Cited ranges → the line numbers to badge, per file.
 *
 * A finding spanning several lines contributes each of them: the badge counts
 * finding-LINES, which is what the contract field is called and what the i18n
 * string says.
 */
export function findingLinesByFile(findings: readonly FindingRange[]): Map<string, number[]> {
  const byFile = new Map<string, Set<number>>();
  for (const f of findings) {
    // A start beyond the end is bad data, not a reason to loop forever.
    if (f.endLine < f.startLine) continue;
    let lines = byFile.get(f.file);
    if (!lines) {
      lines = new Set<number>();
      byFile.set(f.file, lines);
    }
    // See MAX_FINDING_LINE_SPAN: end_line is model-written and clamped, not
    // validated, so the loop bound is untrusted input.
    const last = Math.min(f.endLine, f.startLine + MAX_FINDING_LINE_SPAN - 1);
    for (let line = f.startLine; line <= last; line += 1) lines.add(line);
  }
  const out = new Map<string, number[]>();
  for (const [file, lines] of byFile) out.set(file, [...lines].sort((a, b) => a - b));
  return out;
}

/** Most findings first, then the largest change, then alphabetical. */
function compareFiles(a: SmartDiffFile, b: SmartDiffFile): number {
  const byFindings = b.finding_lines.length - a.finding_lines.length;
  if (byFindings !== 0) return byFindings;
  const bySize = b.additions + b.deletions - (a.additions + a.deletions);
  if (bySize !== 0) return bySize;
  return a.path.localeCompare(b.path);
}

export function buildSmartDiff(
  files: readonly SmartDiffInputFile[],
  findingLines: ReadonlyMap<string, number[]>,
): SmartDiff {
  const byRole = new Map<SmartDiffRole, SmartDiffFile[]>();
  let totalLines = 0;

  for (const file of files) {
    totalLines += file.additions + file.deletions;
    const entry: SmartDiffFile = {
      path: file.path,
      // Deriving this would mean a model call, and Smart Diff makes none.
      pseudocode_summary: null,
      additions: file.additions,
      deletions: file.deletions,
      finding_lines: findingLines.get(file.path) ?? [],
    };
    const role = classifyPath(file.path);
    const bucket = byRole.get(role);
    if (bucket) bucket.push(entry);
    else byRole.set(role, [entry]);
  }

  const groups: SmartDiffGroup[] = [];
  for (const role of ROLE_ORDER) {
    const bucket = byRole.get(role);
    if (!bucket || bucket.length === 0) continue;
    bucket.sort(compareFiles);
    groups.push({ role, files: bucket });
  }

  const tooBig = totalLines > MAX_REVIEWABLE_LINES;
  return {
    groups,
    split_suggestion: {
      too_big: tooBig,
      total_lines: totalLines,
      proposed_splits: tooBig
        ? groups
            .filter((g) => g.files.length >= MIN_SPLIT_FILES)
            .map((g) => ({ name: SPLIT_NAMES[g.role], files: g.files.map((f) => f.path) }))
        : [],
    },
  };
}
