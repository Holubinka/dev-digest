/**
 * The prompt log must carry NO prompt content — ever.
 *
 * This is the test the feature exists for. `PromptAssembly` holds the full text
 * of every section (the diff, the PR body, spec prose, whatever a skill body
 * happens to contain); `PromptAssemblyLog` is the view an operator can read and
 * an ops pipeline can ship. Every sentinel below is planted in a DIFFERENT
 * section, so a leak from any one of them fails here rather than in production.
 *
 * It discriminates: replacing buildPromptAssemblyLog's body with a spread of the
 * assembly fails it on the first sentinel.
 */
import { describe, it, expect } from 'vitest';
import { assemblePrompt, sliceDiff } from '@devdigest/reviewer-core';
import type { UnifiedDiff } from '@devdigest/shared';
import {
  buildPromptAssemblyLog,
  promptLogDetail,
  sectionDigest,
} from '../src/modules/reviews/prompt-log.js';

const SENTINELS = {
  secret: 'sk-live-DEADBEEF0123456789abcdefSENTINEL',
  // No double quotes in any sentinel: JSON.stringify escapes them, so a
  // toContain() on the serialised log would pass for the wrong reason.
  diff: '+const apiKey = hunter2-in-the-diff-SENTINEL;',
  spec: 'The billing service must never expose the tenant ledger to a viewer SENTINEL.',
  prBody: 'This PR rotates the production credentials SENTINEL and updates the runbook.',
  intent: 'Intent: rotate credentials SENTINEL; scope: billing only.',
  skill: 'Skill rule SENTINEL: always inspect the credential store first.',
  memory: 'Memory SENTINEL: the last review missed a leaked token here.',
  callers: 'callers SENTINEL — billing.ts calls chargeCard(token)',
  repoMap: 'repo map SENTINEL — src/billing/ledger.ts: class Ledger',
  task: 'Review pull request #1 — Rotate credentials SENTINEL — by octocat.',
} as const;

const DIFF: UnifiedDiff = {
  raw: [
    'diff --git a/src/billing/ledger.ts b/src/billing/ledger.ts',
    '--- a/src/billing/ledger.ts',
    '+++ b/src/billing/ledger.ts',
    '@@ -1,2 +1,3 @@',
    ' const x = 1;',
    SENTINELS.diff,
    `+const other = ${SENTINELS.secret};`,
  ].join('\n'),
  files: [
    {
      path: 'src/billing/ledger.ts',
      additions: 2,
      deletions: 0,
      hunks: [
        {
          file: 'src/billing/ledger.ts',
          oldStart: 1,
          oldLines: 2,
          newStart: 1,
          newLines: 3,
          newLineNumbers: [2, 3],
        },
      ],
    },
  ],
};

const PARTS = {
  system: `You are a reviewer. The operator key is ${SENTINELS.secret}.`,
  task: SENTINELS.task,
  prDescription: SENTINELS.prBody,
  intent: SENTINELS.intent,
  skills: [SENTINELS.skill],
  memory: [SENTINELS.memory],
  specs: [SENTINELS.spec],
  repoMap: SENTINELS.repoMap,
  callers: SENTINELS.callers,
  diff: DIFF.raw,
};

function logJson(verbose: boolean): string {
  const assembled = assemblePrompt(PARTS);
  return JSON.stringify(
    buildPromptAssemblyLog({
      correlationId: 'run-1',
      provider: 'openrouter',
      model: 'deepseek/deepseek-v4-flash',
      sections: assembled.sections,
      ...(verbose
        ? {
            detail: promptLogDetail({
              mode: 'single-pass',
              chunk: 'all files',
              diff: DIFF,
              assembly: assembled.assembly,
              task: SENTINELS.task,
            }),
          }
        : {}),
    }),
  );
}

describe('PromptAssemblyLog — carries no prompt content', () => {
  it('the sentinels really are in the assembly (so the assertions below mean something)', () => {
    const { assembly } = assemblePrompt(PARTS);
    const raw = JSON.stringify(assembly);
    for (const [name, sentinel] of Object.entries(SENTINELS)) {
      expect(raw, `${name} must be present in the assembly this test redacts`).toContain(sentinel);
    }
  });

  for (const verbose of [false, true]) {
    it(`leaks no section text, diff, spec prose, PR body or secret (verbose=${verbose})`, () => {
      const json = logJson(verbose);
      for (const [name, sentinel] of Object.entries(SENTINELS)) {
        expect(json, `${name} leaked into the prompt log`).not.toContain(sentinel);
      }
      // Not just the sentinels: no untrusted delimiter, no diff marker, no
      // fragment of the guard — nothing that only text could have put there.
      expect(json).not.toContain('<untrusted');
      expect(json).not.toContain('diff --git');
      expect(json).not.toContain('SECURITY — read carefully');
      expect(json).not.toContain('SENTINEL');
    });
  }

  it('still describes every section that went in, and only paths in verbose detail', () => {
    const quiet = JSON.parse(logJson(false)) as { sections: { section: string }[] };
    expect(quiet.sections.map((s) => s.section)).toEqual([
      'system',
      'task',
      'pr_description',
      'intent',
      'skills',
      'memory',
      'repo_map',
      'specs',
      'callers',
      'diff',
    ]);
    const verbose = JSON.parse(logJson(true)) as { sections: { section: string }[] };
    // A path is not a secret (it is already in pr_files.path); its content is.
    expect(verbose.sections.map((s) => s.section)).toContain('diff:src/billing/ledger.ts');
  });
});

describe('PromptAssemblyLog — digests', () => {
  const sections = (verbose: boolean) =>
    (JSON.parse(logJson(verbose)) as { sections: { section: string; digest: string | null }[] })
      .sections;

  it('are null when verbose is off', () => {
    expect(sections(false).every((s) => s.digest === null)).toBe(true);
  });

  it('are a 12-hex-character sha256 prefix on every section when verbose is on', () => {
    for (const s of sections(true)) {
      expect(s.digest, `${s.section} has no digest`).toMatch(/^[0-9a-f]{12}$/);
    }
  });

  it('change when the content changes and hold when it does not', () => {
    const digestOf = (parts: Parameters<typeof assemblePrompt>[0], text: string) => {
      const assembled = assemblePrompt(parts);
      const log = buildPromptAssemblyLog({
        correlationId: 'run-1',
        provider: null,
        model: 'm',
        sections: assembled.sections,
        detail: {
          digestSources: { pr_description: text },
          files: [],
        },
      });
      return log.sections.find((s) => s.section === 'pr_description')?.digest;
    };
    const a = digestOf({ system: 's', diff: 'd', prDescription: 'same body' }, 'same body');
    const b = digestOf({ system: 's', diff: 'd', prDescription: 'same body' }, 'same body');
    const c = digestOf({ system: 's', diff: 'd', prDescription: 'other body' }, 'other body');
    expect(a).toMatch(/^[0-9a-f]{12}$/);
    expect(b).toBe(a);
    expect(c).not.toBe(a);
  });

  it('digests a map-reduce chunk against ITS slice, not the whole diff', () => {
    // The case that would silently produce wrong fingerprints: in map-reduce
    // the server holds the WHOLE-diff assembly (reviewer-core run.ts keeps that
    // one for the trace) while each prompt carried one file's slice.
    const file = (path: string, body: string) =>
      [`diff --git a/${path} b/${path}`, `--- a/${path}`, `+++ b/${path}`, '@@ -1,1 +1,2 @@', ' x', `+${body}`].join('\n');
    const two: UnifiedDiff = {
      raw: `${file('src/a.ts', 'const a = 1;')}\n${file('src/b.ts', 'const bbbbbbbb = 2;')}`,
      files: ['src/a.ts', 'src/b.ts'].map((path) => ({
        path,
        additions: 1,
        deletions: 0,
        hunks: [{ file: path, oldStart: 1, oldLines: 1, newStart: 1, newLines: 2, newLineNumbers: [2] }],
      })),
    };
    const chunk = 'src/b.ts';
    const parts = { system: 'sys', task: 'T', prDescription: 'Body.' };
    const chunkPrompt = assemblePrompt({ ...parts, diff: sliceDiff(two, chunk) });
    const wholeDiffAssembly = assemblePrompt({ ...parts, diff: two.raw }).assembly;

    const log = buildPromptAssemblyLog({
      correlationId: 'run-1',
      provider: null,
      model: 'm',
      sections: chunkPrompt.sections,
      detail: promptLogDetail({
        mode: 'map-reduce',
        chunk,
        diff: two,
        assembly: wholeDiffAssembly,
        task: 'T',
      }),
    });

    expect(log.sections.every((s) => s.digest !== null)).toBe(true);
    expect(log.sections.find((s) => s.section === 'diff')!.digest).toBe(
      sectionDigest(sliceDiff(two, chunk)),
    );
    expect(log.sections.find((s) => s.section === 'diff')!.digest).not.toBe(
      sectionDigest(two.raw),
    );
    // The breakdown covers the files in THIS chunk — not every changed file.
    expect(log.sections.filter((s) => s.section.startsWith('diff:')).map((s) => s.section)).toEqual([
      'diff:src/b.ts',
    ]);
  });

  it('stays null rather than wrong when the held content is not this section’s', () => {
    // The guard that makes the map-reduce path safe: the server holds ONE
    // assembly, so a digest is only attached when the content it holds has the
    // same code-point length the engine reported for that section.
    const assembled = assemblePrompt({ system: 'sys', diff: 'DIFF', prDescription: 'body' });
    const log = buildPromptAssemblyLog({
      correlationId: 'run-1',
      provider: null,
      model: 'm',
      sections: assembled.sections,
      detail: { digestSources: { pr_description: 'a different body entirely' }, files: [] },
    });
    expect(log.sections.find((s) => s.section === 'pr_description')?.digest).toBeNull();
  });
});
