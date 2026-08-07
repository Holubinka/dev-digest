import type { FindingRecord, SmartDiffRole } from "@devdigest/shared";
import { severityColor } from "@/components/severity-badge";
import { MAX_FINDING_LINE_SPAN } from "./constants";

/** Worst-first, so a line cited twice takes the louder colour and chip order. */
const SEVERITY_RANK: Record<string, number> = { CRITICAL: 3, WARNING: 2, SUGGESTION: 1 };

/**
 * Boilerplate is collapsed however small it is: the acceptance criterion is
 * about the role, not the size, and a two-line lock diff still deserves to stay
 * out of the way. Core and wiring fall through to the card's own size rule.
 */
export function defaultOpenFor(role: SmartDiffRole): boolean | undefined {
  return role === "boilerplate" ? false : undefined;
}

/**
 * file → (new-side line → the findings citing it, worst first).
 *
 * Built from the reviews the page already holds rather than from the SmartDiff
 * contract, which carries line numbers but neither severity nor finding id —
 * and the id is what the chip needs to navigate to the Agent runs tab.
 * A multi-line finding claims every line in its range, so a chip appears
 * wherever the reader's eye lands inside it.
 */
export function findingsByFileLine(
  findings: readonly FindingRecord[],
): Map<string, Map<number, FindingRecord[]>> {
  const byFile = new Map<string, Map<number, FindingRecord[]>>();
  for (const f of findings) {
    if (f.dismissed_at != null) continue;
    if (f.end_line < f.start_line) continue;
    let lines = byFile.get(f.file);
    if (!lines) {
      lines = new Map<number, FindingRecord[]>();
      byFile.set(f.file, lines);
    }
    // See MAX_FINDING_LINE_SPAN: end_line is model-written and clamped, not
    // validated, so the loop bound is untrusted input.
    const last = Math.min(f.end_line, f.start_line + MAX_FINDING_LINE_SPAN - 1);
    for (let line = f.start_line; line <= last; line += 1) {
      const held = lines.get(line);
      if (held) held.push(f);
      else lines.set(line, [f]);
    }
  }
  for (const lines of byFile.values()) {
    for (const list of lines.values()) {
      list.sort((a, b) => (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0));
    }
  }
  return byFile;
}

/**
 * How many DISTINCT findings a file carries, and the first line to scroll to.
 *
 * Not `finding_lines.length` from the contract: that counts LINES, so one
 * finding spanning three of them would badge "3 findings". Derived from the same
 * map the chips render from, so the badge and the chips can never disagree.
 */
export function fileFindingSummary(
  lines: ReadonlyMap<number, FindingRecord[]>,
): { count: number; firstLine: number } | null {
  const ids = new Set<string>();
  let firstLine = Number.POSITIVE_INFINITY;
  for (const [line, list] of lines) {
    if (line < firstLine) firstLine = line;
    for (const f of list) ids.add(f.id);
  }
  return ids.size === 0 ? null : { count: ids.size, firstLine };
}

/**
 * Gutter colour per line, from the worst finding on it.
 *
 * `severityColor` rather than a local lookup: `severity` is a plain `text`
 * column, and indexing the SEV table directly with an unvetted string is the
 * prototype-chain bug recorded in `components/severity-badge/helpers.ts`.
 */
export function gutterColours(
  lines: ReadonlyMap<number, FindingRecord[]>,
): Map<number, string> {
  const out = new Map<number, string>();
  for (const [line, list] of lines) {
    const worst = list[0];
    if (worst) out.set(line, severityColor(worst.severity));
  }
  return out;
}
