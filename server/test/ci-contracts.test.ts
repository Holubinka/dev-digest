import { describe, it, expect } from 'vitest';
import {
  CiExportInput,
  CiResultArtifact,
  CiRunStatus,
  CiArtifactStatus,
  MAX_CI_WORKFLOW_CHARS,
} from '@devdigest/shared';

/**
 * The CI artifact is written inside someone else's repository by a bundle this
 * workspace may not have generated, so the parse has two jobs that pull against
 * each other: it must still REJECT a malformed artifact, and it must still
 * ACCEPT one whose vocabulary it does not recognise. The four cases below are
 * the corners of that, and collapsing any two of them loses one of the jobs.
 */
describe('CiResultArtifact tolerates what it does not recognise', () => {
  const older = {
    findings_count: 0,
    cost_usd: null,
    agent: 'Security Reviewer',
  };

  it('parses an artifact from a bundle that predates run state, leaving both fields undefined', () => {
    const parsed = CiResultArtifact.parse(older);

    // Reading back `undefined` is the assertion. A `.default()` here would make
    // "the runner wrote nothing" indistinguishable from "the runner wrote
    // 'succeeded'", and the row would report a state no run ever reached.
    expect(parsed.status).toBeUndefined();
    expect(parsed.verdict).toBeUndefined();
    expect('status' in parsed).toBe(false);
  });

  it('parses an artifact whose run state is in no enum', () => {
    const parsed = CiResultArtifact.parse({ ...older, status: 'cancelled' });

    // The unknown value survives the parse so the mapping can drop it and say
    // why. A closed enum here would fail the whole artifact, and a failed parse
    // is a rejected run — which is what an unrecognised state must NOT cause.
    expect(parsed.status).toBe('cancelled');
  });

  it('still rejects a field that is genuinely mistyped, naming it', () => {
    const result = CiResultArtifact.safeParse({ ...older, findings_count: 'many' });

    expect(result.success).toBe(false);
    const paths = result.success ? [] : result.error.issues.map((i) => i.path.join('.'));
    expect(paths).toContain('findings_count');
  });

  /**
   * The bound is the Postgres `integer` range, because `ci_runs.findings_count`
   * and `ci_runs.duration_ms` are `integer` columns fed straight from here. Past
   * it the driver throws `integer out of range` from inside `upsertRun` — not a
   * `ValidationError` — and the ingest treats a rejected run as a failed poll:
   * the repository's remaining runs are skipped and `last_polled_at` is never
   * stamped. `ci-ingest.test.ts` asserts that consequence; this pins the edge.
   */
  it.each([
    ['the largest value the column holds', 2_147_483_647, true],
    ['one past it', 2_147_483_648, false],
    ['a negative count', -1, false],
  ])('%s → accepted: %s', (_label, findings_count, accepted) => {
    const result = CiResultArtifact.safeParse({ ...older, findings_count });

    expect(result.success).toBe(accepted);
    if (!result.success) {
      expect(result.error.issues.map((i) => i.path.join('.'))).toContain('findings_count');
    }
  });

  it('carries five row states and three artifact states', () => {
    for (const value of ['succeeded', 'failed', 'no_findings', 'running', 'skipped']) {
      expect(CiRunStatus.parse(value)).toBe(value);
    }
    for (const value of ['succeeded', 'failed', 'skipped']) {
      expect(CiArtifactStatus.parse(value)).toBe(value);
    }

    // A skip is its own outcome: a fork PR and an over-sized diff both exit 0
    // having reviewed nothing, and reporting either as `succeeded` or as
    // `no_findings` would claim a review that never ran.
    expect(CiRunStatus.options).toContain('skipped');
    expect(CiArtifactStatus.options).not.toContain('no_findings');
  });
});

/**
 * The hand-edited workflow is the one field of this body that is written into
 * someone else's repository and then EXECUTED, so the contract is where its
 * floor lives, next to its ceiling (AC-55).
 *
 * The empty case had three chances to be caught and took none of them: this
 * schema had no `.min(1)`, `generate/bundle.ts` falls back with `??` (which
 * `''` passes), and `findYamlProblem('')` skipped its one blank line and
 * returned null. A zero-byte `.github/workflows/devdigest-review.yml` was
 * committed, GitHub reported an invalid workflow, and no review ever ran.
 */
describe('CiExportInput.workflow refuses an override with nothing in it (AC-55)', () => {
  const body = (workflow?: string) => ({
    repo: 'acme/payments-api',
    ...(workflow === undefined ? {} : { workflow }),
  });
  const messages = (input: unknown): string => {
    const result = CiExportInput.safeParse(input);
    expect(result.success).toBe(false);
    return result.success ? '' : result.error.issues.map((i) => i.message).join(' | ');
  };

  it('refuses the emptied textarea, saying which file it would have written', () => {
    // AC-55 refuses by NAME, so the reason has to identify the file: "Request
    // validation failed" alone leaves the reader looking at four editable files.
    // The contract says "the workflow file" and not a path — the path carries
    // the agent's slug now (AC-135) and a shared contract cannot know it. The
    // exact path is named by `CiService.refuseBrokenWorkflow`, which has it.
    expect(messages(body(''))).toContain('the workflow file');
  });

  it.each([
    ['a single space', ' '],
    ['spaces and newlines', '  \n\n\t\n'],
    ['a lone newline', '\n'],
  ])('refuses %s, which produces the same unusable file as zero bytes', (_label, workflow) => {
    expect(messages(body(workflow))).toContain('the workflow file');
  });

  it('leaves the field optional and does not touch a workflow that has content', () => {
    const kept = 'name: DevDigest Review\non:\n  pull_request:\n    types: [opened]\n';

    expect(CiExportInput.parse(body()).workflow).toBeUndefined();
    // Byte-for-byte: a contract that trimmed here would be repairing a file that
    // is about to be executed, which AC-55 refuses instead of doing.
    expect(CiExportInput.parse(body(kept)).workflow).toBe(kept);
    expect(CiExportInput.parse(body('  name: x\n')).workflow).toBe('  name: x\n');
  });

  it('still refuses one past the ceiling', () => {
    // The floor was added beside the ceiling; dropping the ceiling while adding
    // it would trade one unpublishable file for another.
    const result = CiExportInput.safeParse(body('x'.repeat(MAX_CI_WORKFLOW_CHARS + 1)));

    expect(result.success).toBe(false);
    expect(result.success ? [] : result.error.issues.map((i) => i.path.join('.'))).toContain(
      'workflow',
    );
  });
});
