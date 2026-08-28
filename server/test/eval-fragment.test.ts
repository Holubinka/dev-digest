/**
 * L06 — the case's input fragment and the guards over it (AC-4, AC-6, AC-12, AC-23).
 *
 * Hermetic: `parseUnifiedDiff` is a pure function and nothing here reaches a
 * container, a database or a provider.
 */
import { describe, it, expect } from 'vitest';
import { parseUnifiedDiff } from '../src/adapters/git/diff-parser.js';
import {
  assertRunnableFragment,
  filesIn,
  fragmentFor,
  intersectsAHunk,
} from '../src/modules/eval/diff-fragment.js';
import { AppError } from '../src/platform/errors.js';

const TWO_FILES = [
  'diff --git a/src/a.ts b/src/a.ts',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1,3 +1,4 @@',
  ' const x = 1;',
  '+const y = 2;',
  ' const z = 3;',
  'diff --git a/src/b.ts b/src/b.ts',
  '--- a/src/b.ts',
  '+++ b/src/b.ts',
  '@@ -10,3 +10,4 @@',
  ' a',
  '+b',
  ' c',
].join('\n');

describe('fragmentFor — AC-4', () => {
  it('cuts exactly the cited file, with its hunks', () => {
    const diff = parseUnifiedDiff(TWO_FILES);
    expect(diff.files.map((f) => f.path)).toEqual(['src/a.ts', 'src/b.ts']);

    const fragment = fragmentFor(diff, 'src/a.ts');
    expect(filesIn(fragment)).toEqual(['src/a.ts']);
    expect(fragment).toContain('+const y = 2;');
    expect(fragment).not.toContain('src/b.ts');
  });

  it('refuses an absent path instead of returning the WHOLE diff', () => {
    // `sliceDiff` falls back to `diff.raw` when the path is not in the diff
    // (`reviewer-core/src/review/reduce.ts:70`). Without the guard this call
    // would store the entire pull-request diff as a one-file case input.
    const diff = parseUnifiedDiff(TWO_FILES);
    let thrown: unknown;
    try {
      fragmentFor(diff, 'src/never-touched.ts');
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(AppError);
    expect((thrown as AppError).code).toBe('diff_unavailable');
    expect((thrown as AppError).statusCode).toBe(409);
  });
});

describe('filesIn — AC-12 (`input_files` is derived, never edited)', () => {
  it('returns the paths the fragment actually carries', () => {
    expect(filesIn(TWO_FILES)).toEqual(['src/a.ts', 'src/b.ts']);
  });
});

describe('assertRunnableFragment — AC-23', () => {
  it('accepts a fragment with a hunk carrying new-side lines', () => {
    const diff = assertRunnableFragment(fragmentFor(parseUnifiedDiff(TWO_FILES), 'src/a.ts'));
    expect(diff.files).toHaveLength(1);
  });

  it('refuses text that is not a unified diff at all', () => {
    expect(() => assertRunnableFragment('just some prose')).toThrowError(
      /not a unified diff/,
    );
  });

  it('refuses a `--stat`-style summary — files named, no @@ hunks', () => {
    const stat = [
      'diff --git a/src/a.ts b/src/a.ts',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
    ].join('\n');
    expect(() => assertRunnableFragment(stat)).toThrowError(/carries no @@ hunks/);
  });

  it('refuses an over-claiming hunk header — the 1345 ms / 478 MB guard', () => {
    // The measured payload from `_shared/diff-guards.ts`: one file, one hunk,
    // `newLineNumbers: []`, and a header claiming 16 000 000 new-side lines.
    const crafted = 'diff --git a/x b/x\n+++ b/x\n@@ -1,1 +1,16000000 @@';
    const started = Date.now();
    let thrown: unknown;
    try {
      assertRunnableFragment(crafted);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(AppError);
    expect((thrown as AppError).code).toBe('invalid_diff');
    expect((thrown as AppError).statusCode).toBe(422);
    expect((thrown as AppError).message).toContain('16000000');
    // It has to fail FAST — the whole point is that no 16-million-entry Set is
    // ever built. Blocking the event loop for 1.3 s is the bug, not the fix.
    expect(Date.now() - started).toBeLessThan(500);
  });

  it('refuses a diff whose every hunk only removes lines', () => {
    const deletionOnly = [
      'diff --git a/src/a.ts b/src/a.ts',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -1,2 +0,0 @@',
      '-const x = 1;',
      '-const z = 3;',
    ].join('\n');
    expect(() => assertRunnableFragment(deletionOnly)).toThrowError(/removes lines and adds none/);
  });
});

describe('intersectsAHunk — AC-6', () => {
  const fragment = fragmentFor(parseUnifiedDiff(TWO_FILES), 'src/a.ts');
  const diff = parseUnifiedDiff(fragment);

  it('is true for a range the fragment covers', () => {
    expect(intersectsAHunk(diff, 'src/a.ts', 1, 4)).toBe(true);
  });

  it('is false for a range past every hunk', () => {
    expect(intersectsAHunk(diff, 'src/a.ts', 900, 950)).toBe(false);
  });

  it('is false for a file the fragment does not carry', () => {
    expect(intersectsAHunk(diff, 'src/b.ts', 10, 12)).toBe(false);
  });

  it('walks the covered lines, not the declared range — an unbounded end is instant', () => {
    // `end_line` is unbounded model/user input. Iterating the DECLARED range is
    // the 13-second block `reviewer-core/src/grounding.ts:44-49` records.
    const started = Date.now();
    expect(intersectsAHunk(diff, 'src/a.ts', 1, 2_000_000_000)).toBe(true);
    expect(Date.now() - started).toBeLessThan(200);
  });

  it('normalises an inverted range', () => {
    expect(intersectsAHunk(diff, 'src/a.ts', 4, 1)).toBe(true);
  });
});
