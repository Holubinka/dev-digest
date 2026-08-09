import { describe, it, expect } from 'vitest';
import { SmartDiff } from '@devdigest/shared';
import {
  buildSmartDiff,
  classifyPath,
  findingLinesByFile,
  type SmartDiffInputFile,
} from '../src/modules/smart-diff/helpers.js';
import {
  MAX_FINDING_LINE_SPAN,
  MAX_REVIEWABLE_LINES,
  MIN_SPLIT_FILES,
} from '../src/modules/smart-diff/constants.js';

/**
 * Smart Diff classifier — hermetic. The route is covered in
 * `smart-diff.it.test.ts`; everything decided here is a pure function of a path
 * and two line counts.
 *
 * Expected values come from the contract and from the acceptance criteria, never
 * from re-reading the pattern lists: a test that restates `constants.ts` back to
 * itself would pass on any taxonomy, including a wrong one.
 */

const file = (
  path: string,
  additions = 1,
  deletions = 0,
): SmartDiffInputFile => ({ path, additions, deletions });

describe('classifyPath', () => {
  it('calls a lock file boilerplate from any directory depth', () => {
    for (const path of [
      'package-lock.json',
      'pnpm-lock.yaml',
      'yarn.lock',
      'client/pnpm-lock.yaml',
      'apps/web/nested/deep/package-lock.json',
      'Cargo.lock',
      'go.sum',
    ]) {
      expect(classifyPath(path), path).toBe('boilerplate');
    }
  });

  it('prefers boilerplate over wiring when a path matches both', () => {
    // Build output that is also a barrel. Reading it as wiring would lift
    // generated code above real logic, which is the whole point of the ordering.
    expect(classifyPath('dist/index.js')).toBe('boilerplate');
    expect(classifyPath('.next/server/app.js')).toBe('boilerplate');
  });

  it('calls barrels, entrypoints and configuration wiring', () => {
    for (const path of [
      'src/api/public/index.ts',
      'src/server.ts',
      'src/config.ts',
      'vitest.config.ts',
      'tsconfig.json',
      '.github/workflows/ci.yml',
      'src/types/global.d.ts',
    ]) {
      expect(classifyPath(path), path).toBe('wiring');
    }
  });

  it('falls back to core for anything no rule claims', () => {
    for (const path of [
      'src/middleware/ratelimit.ts',
      'src/api/public/webhooks.ts',
      'test/pricing.test.ts',
      'src/components/Button.tsx',
    ]) {
      expect(classifyPath(path), path).toBe('core');
    }
  });

  it('classifies a leading ./ the same as a bare path', () => {
    expect(classifyPath('./package.json')).toBe(classifyPath('package.json'));
  });
});

describe('findingLinesByFile', () => {
  it('expands a multi-line finding into every line it cites', () => {
    const lines = findingLinesByFile([{ file: 'a.ts', startLine: 4, endLine: 7 }]);
    expect(lines.get('a.ts')).toEqual([4, 5, 6, 7]);
  });

  it('sorts and de-duplicates lines two findings share', () => {
    const lines = findingLinesByFile([
      { file: 'a.ts', startLine: 9, endLine: 9 },
      { file: 'a.ts', startLine: 3, endLine: 4 },
      { file: 'a.ts', startLine: 4, endLine: 4 },
    ]);
    expect(lines.get('a.ts')).toEqual([3, 4, 9]);
  });

  it('caps a range at 200 lines instead of expanding it', () => {
    // Literals, not `MAX_FINDING_LINE_SPAN`: an expectation derived from the
    // constant it is testing holds for every value of it, including a value
    // that no longer bounds anything. Pin it once, then assert in numbers.
    expect(MAX_FINDING_LINE_SPAN).toBe(200);

    // start_line/end_line are model-written and clamped by toInt4, not validated,
    // so the loop bound here is untrusted input. Timed, because the failure mode
    // is a hung event loop rather than a wrong value.
    const started = process.hrtime.bigint();
    const lines = findingLinesByFile([{ file: 'a.ts', startLine: 1, endLine: 2_147_483_647 }]);
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;

    expect(lines.get('a.ts')).toHaveLength(200);
    expect(lines.get('a.ts')![0]).toBe(1);
    expect(lines.get('a.ts')!.at(-1)).toBe(200);
    expect(elapsedMs).toBeLessThan(100);
  });

  it('keeps a range that fits inside the cap whole', () => {
    const lines = findingLinesByFile([{ file: 'a.ts', startLine: 10, endLine: 209 }]);
    expect(lines.get('a.ts')).toHaveLength(200);
    expect(lines.get('a.ts')!.at(-1)).toBe(209);
  });

  it('drops a range whose end precedes its start instead of looping', () => {
    const lines = findingLinesByFile([{ file: 'a.ts', startLine: 8, endLine: 2 }]);
    expect(lines.has('a.ts')).toBe(false);
  });
});

describe('buildSmartDiff', () => {
  it('returns a value the SmartDiff contract accepts', () => {
    const out = buildSmartDiff([file('src/a.ts')], new Map());
    expect(() => SmartDiff.parse(out)).not.toThrow();
  });

  it('orders groups core → wiring → boilerplate and drops empty ones', () => {
    const out = buildSmartDiff(
      [file('package-lock.json'), file('src/logic.ts'), file('src/index.ts')],
      new Map(),
    );
    expect(out.groups.map((g) => g.role)).toEqual(['core', 'wiring', 'boilerplate']);

    const coreOnly = buildSmartDiff([file('src/logic.ts')], new Map());
    expect(coreOnly.groups.map((g) => g.role)).toEqual(['core']);
  });

  it('puts the file carrying findings first, ahead of a larger file', () => {
    const out = buildSmartDiff(
      [file('src/big.ts', 500, 0), file('src/small.ts', 2, 0)],
      new Map([['src/small.ts', [3]]]),
    );
    expect(out.groups[0]!.files.map((f) => f.path)).toEqual([
      'src/small.ts',
      'src/big.ts',
    ]);
  });

  it('breaks a tie on size, then on path', () => {
    const out = buildSmartDiff(
      [file('src/c.ts', 1, 0), file('src/a.ts', 1, 0), file('src/b.ts', 9, 0)],
      new Map(),
    );
    expect(out.groups[0]!.files.map((f) => f.path)).toEqual([
      'src/b.ts',
      'src/a.ts',
      'src/c.ts',
    ]);
  });

  it('never derives a pseudocode summary — that would need a model call', () => {
    const out = buildSmartDiff([file('src/a.ts')], new Map());
    expect(out.groups[0]!.files[0]!.pseudocode_summary).toBeNull();
  });

  it('gives a file with no findings an empty finding_lines array', () => {
    const out = buildSmartDiff([file('src/a.ts')], new Map());
    expect(out.groups[0]!.files[0]!.finding_lines).toEqual([]);
  });

  it('totals additions and deletions across every role', () => {
    const out = buildSmartDiff(
      [file('src/a.ts', 10, 5), file('package-lock.json', 100, 20)],
      new Map(),
    );
    expect(out.split_suggestion.total_lines).toBe(135);
  });

  it('is not too_big exactly at 400 changed lines, and is at 401', () => {
    // Literals, not `MAX_REVIEWABLE_LINES`: a test that derives the boundary
    // from the constant it is testing passes for every value of it, and proves
    // only that `>` was not typed as `>=`. 400 is the documented threshold, so
    // moving it is a deliberate edit here as well as in constants.ts.
    expect(MAX_REVIEWABLE_LINES).toBe(400);

    const at = buildSmartDiff([file('src/a.ts', 250, 150)], new Map());
    expect(at.split_suggestion.total_lines).toBe(400);
    expect(at.split_suggestion.too_big).toBe(false);
    expect(at.split_suggestion.proposed_splits).toEqual([]);

    const over = buildSmartDiff([file('src/a.ts', 250, 151)], new Map());
    expect(over.split_suggestion.total_lines).toBe(401);
    expect(over.split_suggestion.too_big).toBe(true);
  });

  it('proposes a split per role group and skips one below MIN_SPLIT_FILES', () => {
    const out = buildSmartDiff(
      [file('src/a.ts', 401, 0), file('src/b.ts', 1, 0), file('src/index.ts', 1, 0)],
      new Map(),
    );
    expect(out.split_suggestion.too_big).toBe(true);

    // core has two files, wiring has one.
    expect(MIN_SPLIT_FILES).toBe(2);
    expect(out.split_suggestion.proposed_splits).toHaveLength(1);
    expect(out.split_suggestion.proposed_splits[0]!.files).toEqual([
      'src/a.ts',
      'src/b.ts',
    ]);
  });

  it('proposes nothing when every group is a single file, even though too_big', () => {
    // A 500-line PR of one-file groups is still too big to review in a sitting,
    // but "split this into three PRs of one file each" is not advice — so the
    // flag is true and the list is empty. Both halves matter to the UI: the
    // callout renders on `too_big`, the bullet list on `proposed_splits`.
    const out = buildSmartDiff(
      [file('src/a.ts', 401, 0), file('src/index.ts', 1, 0), file('package.json', 1, 0)],
      new Map(),
    );
    expect(out.groups.map((g) => g.role)).toEqual(['core', 'wiring', 'boilerplate']);
    expect(out.split_suggestion.too_big).toBe(true);
    expect(out.split_suggestion.proposed_splits).toEqual([]);
  });

  it('answers an unimported PR with empty groups rather than throwing', () => {
    expect(buildSmartDiff([], new Map())).toEqual({
      groups: [],
      split_suggestion: { too_big: false, total_lines: 0, proposed_splits: [] },
    });
  });
});
