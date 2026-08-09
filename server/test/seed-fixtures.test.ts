import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * The fixture patches in `db/seed-fixtures.ts` are hand-written unified diffs
 * with their `additions` / `deletions` declared separately, and nothing derives
 * one from the other. Typecheck cannot see a mismatch, and neither can any
 * runtime path: the numbers go straight into `pr_files` and are summed by
 * `GET /pulls/:id/smart-diff` into `split_suggestion.total_lines`, so a wrong
 * pair silently makes the PR look a different size than the diff it renders.
 *
 * Nine mismatches were introduced by hand and caught by a throwaway script while
 * PR #104 was written. This is that script, kept.
 *
 * It parses the source rather than importing it, because `FIXTURE_PRS` is not
 * exported and exporting it only for a test would widen the module's surface
 * for no other reason.
 */

const SOURCE = readFileSync(
  fileURLToPath(new URL('../src/db/seed-fixtures.ts', import.meta.url)),
  'utf8',
);

interface Patch {
  name: string;
  header: string;
  additions: number;
  deletions: number;
  context: number;
}

/**
 * `const NAME = \`@@ …\`;`
 *
 * The body may contain escaped backticks — `API_SNAP` holds a Vitest snapshot,
 * which is written with them — so consume `\X` as a unit. A lazy `[\s\S]*?`
 * stops at the first one and reports the patch as empty, which reads as a
 * passing zero-line diff.
 */
function parsePatches(src: string): Map<string, Patch> {
  const out = new Map<string, Patch>();
  const re = /const (\w+) = `(@@(?:[^`\\]|\\[\s\S])*)`;/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const [header = '', ...body] = m[2]!.split('\n');
    out.set(m[1]!, {
      name: m[1]!,
      header,
      additions: body.filter((l) => l.startsWith('+')).length,
      deletions: body.filter((l) => l.startsWith('-')).length,
      context: body.filter((l) => !l.startsWith('+') && !l.startsWith('-')).length,
    });
  }
  return out;
}

interface Entry {
  path: string;
  additions: number;
  deletions: number;
  patch: string;
}

function parseEntries(src: string): Entry[] {
  const out: Entry[] = [];
  const re = /\{ path: '([^']+)', additions: (\d+), deletions: (\d+), patch: (\w+) \}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    out.push({
      path: m[1]!,
      additions: Number(m[2]),
      deletions: Number(m[3]),
      patch: m[4]!,
    });
  }
  return out;
}

const PATCHES = parsePatches(SOURCE);
const ENTRIES = parseEntries(SOURCE);

describe('seed fixture patches', () => {
  it('finds every fixture file, so a parse failure cannot read as a pass', () => {
    // Both parsers returning nothing would make every `it.each` below vacuous.
    expect(ENTRIES.length).toBeGreaterThanOrEqual(15);
    expect(PATCHES.size).toBeGreaterThanOrEqual(ENTRIES.length);
    for (const e of ENTRIES) expect(PATCHES.has(e.patch), `${e.path} → ${e.patch}`).toBe(true);
  });

  it.each(ENTRIES.map((e) => [e.path, e] as const))(
    'declares the real +/- counts for %s',
    (_path, entry) => {
      const patch = PATCHES.get(entry.patch)!;
      expect({ additions: patch.additions, deletions: patch.deletions }).toEqual({
        additions: entry.additions,
        deletions: entry.deletions,
      });
    },
  );

  it.each(ENTRIES.map((e) => [e.path, e] as const))(
    'has a hunk header that matches its body for %s',
    (_path, entry) => {
      const patch = PATCHES.get(entry.patch)!;
      // `@@ -oldStart,oldLen +newStart,newLen @@` — a length is 1 when omitted.
      const h = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(patch.header);
      expect(h, `unparseable hunk header: ${patch.header}`).not.toBeNull();
      const oldLen = h![2] === undefined ? 1 : Number(h![2]);
      const newLen = h![4] === undefined ? 1 : Number(h![4]);
      expect({ oldLen, newLen }).toEqual({
        oldLen: patch.context + patch.deletions,
        newLen: patch.context + patch.additions,
      });
    },
  );

  it('never seeds a finding — every one shown must come from a real run', () => {
    // The rule at the top of seed-fixtures.ts, and the reason acme/payments-api
    // #482 is the cautionary tale in INSIGHTS.md.
    expect(SOURCE).not.toMatch(/t\.findings/);
    expect(SOURCE).not.toMatch(/t\.reviews/);
  });
});
