import type { UnifiedDiff, DiffHunk } from '@devdigest/shared';

/**
 * Minimal unified-diff parser. Extracts per-file hunks and the set of new-side
 * line numbers each hunk covers — exactly what the citation-grounding gate
 * needs (file:line must intersect a real hunk).
 *
 * Handles standard `git diff` output:
 *   diff --git a/path b/path
 *   --- a/path
 *   +++ b/path
 *   @@ -oldStart,oldLines +newStart,newLines @@
 */
export function parseUnifiedDiff(raw: string): UnifiedDiff {
  const files: UnifiedDiff['files'] = [];
  const lines = raw.split('\n');

  let current: UnifiedDiff['files'][number] | null = null;
  let hunk: DiffHunk | null = null;
  let newLineCursor = 0;

  const flushHunk = () => {
    if (current && hunk) current.hunks.push(hunk);
    hunk = null;
  };
  const flushFile = () => {
    flushHunk();
    if (current) files.push(current);
    current = null;
  };

  for (const line of lines) {
    if (line.startsWith('diff --git')) {
      flushFile();
      // path resolved from +++ line below; placeholder for now
      current = { path: '', additions: 0, deletions: 0, hunks: [] };
      continue;
    }
    if (line.startsWith('+++ ')) {
      if (!current) current = { path: '', additions: 0, deletions: 0, hunks: [] };
      const p = line.slice(4).replace(/^b\//, '').trim();
      current.path = p === '/dev/null' ? current.path : p;
      continue;
    }
    if (line.startsWith('--- ')) continue;
    const hh = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (hh) {
      flushHunk();
      const newStart = Number(hh[3]);
      const newLines = hh[4] ? Number(hh[4]) : 1;
      hunk = {
        file: current?.path ?? '',
        oldStart: Number(hh[1]),
        oldLines: hh[2] ? Number(hh[2]) : 1,
        newStart,
        newLines,
        newLineNumbers: [],
      };
      newLineCursor = newStart;
      continue;
    }
    if (!current || !hunk) continue;
    if (line.startsWith('+') && !line.startsWith('+++')) {
      current.additions++;
      hunk.newLineNumbers.push(newLineCursor);
      newLineCursor++;
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      current.deletions++;
      // deletion: no new-side line consumed
    } else {
      // context line: advances new-side cursor and counts as covered
      hunk.newLineNumbers.push(newLineCursor);
      newLineCursor++;
    }
  }
  flushFile();

  return { raw, files: files.filter((f) => f.path) };
}

/**
 * Rebuild a unified diff from per-file patches, then parse it.
 *
 * One reconstruction, because two callers depend on producing the SAME
 * new-side line numbers: `modules/reviews/diff-loader.ts` feeds a studio review
 * from persisted `pr_files`, and `agent-runner` feeds a CI review from the
 * GitHub API. The grounding gate checks findings against those line numbers, so
 * a review that reconstructed the diff differently would ground differently.
 */
export function diffFromPatches(files: { path: string; patch: string | null }[]): UnifiedDiff {
  const parts: string[] = [];
  for (const f of files) {
    if (!f.patch) continue;
    parts.push(`diff --git a/${f.path} b/${f.path}`);
    parts.push(`--- a/${f.path}`);
    parts.push(`+++ b/${f.path}`);
    parts.push(f.patch);
  }
  return parseUnifiedDiff(parts.join('\n'));
}
