import type { Finding, UnifiedDiff } from '@devdigest/shared';

/**
 * Citation grounding — the mandatory mechanical gate for diff-findings.
 *
 * A diff-finding is kept ONLY if its [start_line, end_line] range intersects a
 * real hunk in the unified diff for the same file. Findings that fail are
 * dropped (the model "hallucinated" a location).
 *
 * EXCEPTION: findings from full-file scanners (hooks / blast / onboarding) are
 * not tied to a diff hunk — they ground against the file existing in the diff
 * (or are exempted entirely). We treat `kind` in {secret_leak, lethal_trifecta,
 * phantom, hook} as full-file: they only require the file to be present.
 *
 * QUOTE SELF-CHECK: when a finding carries `quote`, the declared line number is
 * no longer taken on faith even when it happens to land inside a hunk — copying
 * text is a far easier task for a model than counting lines, and a real case
 * was measured where the model quoted the exact right line verbatim while
 * naming the line above it. `locateQuote` finds every verbatim occurrence of
 * the quote in the diff's new-side text — POSSIBLY SPANNING SEVERAL LINES, a
 * `for` loop or an object literal copied whole rather than one line of it in
 * isolation — searched only within CONTIGUOUS runs of covered lines, never
 * across the gap between two hunks; if the declared range already lands on
 * one, nothing changes; if it does not but exactly one candidate range does,
 * the finding is KEPT with its `start_line`/`end_line` corrected to that range
 * (D5a followed one step further: the citation is self-healed, not just
 * filtered); if the quote matches nowhere, the finding is dropped — a quote
 * naming text that is not in the diff at all is a stronger red flag than a
 * bare wrong number; if it matches more than once, the match is ambiguous and
 * grounding falls back to the plain number check, exactly as when no quote was
 * given at all.
 */

/** Above this, a "quote" is not a short excerpt any more — skip verification. */
const MAX_QUOTE_CHARS = 500;

const FULL_FILE_KINDS = new Set(['secret_leak', 'lethal_trifecta', 'phantom', 'hook']);

export interface GroundingResult {
  kept: Finding[];
  dropped: { finding: Finding; reason: string }[];
}

/** Build a quick lookup of file → set of new-side line numbers covered by hunks. */
export function buildLineIndex(diff: UnifiedDiff): Map<string, Set<number>> {
  const idx = new Map<string, Set<number>>();
  for (const f of diff.files) {
    const set = new Set<number>();
    for (const h of f.hunks) {
      if (h.newLineNumbers && h.newLineNumbers.length > 0) {
        for (const n of h.newLineNumbers) set.add(n);
      } else {
        // fall back to the hunk's declared new range
        for (let n = h.newStart; n < h.newStart + Math.max(h.newLines, 1); n++) set.add(n);
      }
    }
    idx.set(f.path, set);
  }
  return idx;
}

/**
 * Map new-side line number → that line's own text (diff marker stripped), for
 * ONE file, re-derived from `diff.raw` on demand.
 *
 * Not sourced from `DiffHunk` — that shape carries only `newLineNumbers`
 * (`adapters/git/diff-parser.ts` discards the text once the number is known),
 * and re-parsing here keeps `reviewer-core` importing zero adapters (`core
 * stays pure`) rather than reaching into `server/src/adapters/git`. Cost is
 * O(size of `raw`), not of any model-declared range, so this does not reopen
 * the unbounded-`end_line` cost this file already guards against above.
 */
function buildLineText(raw: string, file: string): Map<number, string> {
  const text = new Map<number, string>();
  let currentFile = '';
  let cursor = 0;
  let inFile = false;

  for (const line of raw.split('\n')) {
    if (line.startsWith('diff --git')) {
      inFile = false;
      continue;
    }
    if (line.startsWith('+++ ')) {
      currentFile = line.slice(4).replace(/^b\//, '').trim();
      inFile = currentFile === file;
      continue;
    }
    if (line.startsWith('--- ')) continue;
    const hh = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (hh) {
      cursor = Number(hh[3]);
      continue;
    }
    if (!inFile) continue;
    if (line.startsWith('-') && !line.startsWith('---')) continue; // removed: no new-side line
    // `\ No newline at end of file` is a marker, not content. It occupies no
    // new-side line, so counting it slides every later line in the file by one
    // and a quote then heals onto the wrong number — silently, because the text
    // still matches somewhere. Guarding every `\`-prefixed line rather than the
    // one known string keeps this true if the format ever grows another marker.
    if (line.startsWith('\\')) continue;
    const content = line.startsWith('+') || line.startsWith(' ') ? line.slice(1) : line;
    text.set(cursor, content);
    cursor++;
  }
  return text;
}

/**
 * Every verbatim occurrence of `quote` in the diff's new-side text, as a
 * [start, end] line range — plural because a genuinely copy-pasted quote can
 * span more than one line (a `for` loop, an object literal), and a matcher
 * that only ever checked one line at a time could never find one, no matter
 * how exactly it was copied.
 *
 * Matched against CONTIGUOUS runs of covered lines only, never across a gap
 * between two hunks: `lines` only holds the lines a hunk actually shows, so
 * joining line 1 straight to line 50 across 48 lines neither side carries
 * would let a quote match text that is never actually adjacent in the file.
 */
function locateQuote(quote: string, lines: Map<number, string>): { start: number; end: number }[] {
  const q = quote.trim();
  if (!q) return [];

  const sorted = [...lines.entries()].sort((a, b) => a[0] - b[0]);
  const blocks: { startLine: number; text: string; lineCount: number }[] = [];
  for (const [lineNo, text] of sorted) {
    const last = blocks[blocks.length - 1];
    if (last && lineNo === last.startLine + last.lineCount) {
      last.text += '\n' + text;
      last.lineCount++;
    } else {
      blocks.push({ startLine: lineNo, text, lineCount: 1 });
    }
  }

  const span = q.split('\n').length - 1;
  const matches: { start: number; end: number }[] = [];
  for (const block of blocks) {
    let from = 0;
    for (;;) {
      const idx = block.text.indexOf(q, from);
      if (idx === -1) break;
      const before = block.text.slice(0, idx).split('\n').length - 1;
      matches.push({ start: block.startLine + before, end: block.startLine + before + span });
      from = idx + 1;
    }
  }
  return matches;
}

/**
 * Walks the lines the diff actually covers, NOT the range the model declared.
 * Both formulations answer the same question — "is any covered line inside
 * [lo, hi]" — but `start_line`/`end_line` are unbounded model output
 * (`Finding` declares them `z.number().int()`), so iterating the declared range
 * lets one finding with `end_line: 2e9` block the event loop for ~13 s.
 */
function rangeIntersects(lines: Set<number>, start: number, end: number): boolean {
  const lo = Math.min(start, end);
  const hi = Math.max(start, end);
  for (const n of lines) if (n >= lo && n <= hi) return true;
  return false;
}

/**
 * Apply the grounding gate to a set of findings against a unified diff.
 * Returns the kept findings and the dropped ones with reasons (for the trace).
 */
export function groundFindings(findings: Finding[], diff: UnifiedDiff): GroundingResult {
  const lineIndex = buildLineIndex(diff);
  const filesInDiff = new Set(diff.files.map((f) => f.path));
  const kept: Finding[] = [];
  const dropped: { finding: Finding; reason: string }[] = [];
  const lineTextByFile = new Map<string, Map<number, string>>();

  for (const finding of findings) {
    const isFullFile = finding.kind ? FULL_FILE_KINDS.has(finding.kind) : false;

    if (!filesInDiff.has(finding.file)) {
      dropped.push({ finding, reason: `file '${finding.file}' not present in diff` });
      continue;
    }

    if (isFullFile) {
      // full-file scanners only need the file to be in the diff
      kept.push(finding);
      continue;
    }

    const lines = lineIndex.get(finding.file) ?? new Set<number>();
    const quote = finding.quote?.trim();

    if (!quote || quote.length > MAX_QUOTE_CHARS) {
      // No quote to check against, or too long to be "a short excerpt" —
      // unchanged behaviour, the plain number check decides alone.
      if (rangeIntersects(lines, finding.start_line, finding.end_line)) {
        kept.push(finding);
      } else {
        dropped.push({
          finding,
          reason: `lines ${finding.start_line}-${finding.end_line} do not intersect any diff hunk in '${finding.file}'`,
        });
      }
      continue;
    }

    // A quote is present and short enough to trust — it decides, in place of
    // (not merely alongside) the plain hunk-level check. That check only asks
    // "is this number anywhere in the hunk", which the config.ts case that
    // motivated this passed while still naming the wrong line: 9 and 10 are
    // both covered by the same hunk, so the number alone could never catch it.
    let lineText = lineTextByFile.get(finding.file);
    if (!lineText) {
      lineText = buildLineText(diff.raw, finding.file);
      lineTextByFile.set(finding.file, lineText);
    }
    const matches = locateQuote(quote, lineText);

    if (matches.length === 1) {
      // Unique correction: the model counted wrong but copied right. Heal the
      // citation rather than discard a finding whose quote proves it is real.
      // A no-op when the declared range was already the match.
      kept.push({ ...finding, start_line: matches[0]!.start, end_line: matches[0]!.end });
    } else if (matches.length === 0) {
      dropped.push({
        finding,
        reason: `the quote was not found anywhere in '${finding.file}' — citation unverifiable`,
      });
    } else {
      // Ambiguous — the quote appears more than once, so it cannot disambiguate
      // on its own. Fall back to the plain number check, exactly as if no
      // quote had been given.
      if (rangeIntersects(lines, finding.start_line, finding.end_line)) {
        kept.push(finding);
      } else {
        dropped.push({
          finding,
          reason: `lines ${finding.start_line}-${finding.end_line} do not intersect any diff hunk in '${finding.file}', and the quote matches ${matches.length} lines, too ambiguous to relocate`,
        });
      }
    }
  }

  return { kept, dropped };
}

/** Human-readable summary, e.g. "3/3 passed" used in run-trace stats. */
export function groundingSummary(result: GroundingResult): string {
  const total = result.kept.length + result.dropped.length;
  return `${result.kept.length}/${total} passed`;
}
