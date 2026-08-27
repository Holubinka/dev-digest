/**
 * P3 — the module's pure transforms.
 *
 * Three of these guard mistakes no gate in this repository can see: a unit
 * conversion between two `number`s, an enum value dropped rather than stored,
 * and a YAML scanner that must refuse invalid text without refusing valid text.
 */
import { describe, it, expect } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import {
  parseRepoRef,
  readArtifactJson,
  runStatusFromArtifact,
  toCiRun,
  toInstallationListItem,
  zipFiles,
  type CiRunRowLike,
} from '../src/modules/ci/helpers.js';
import { findYamlProblem } from '../src/modules/ci/generate/yaml-lint.js';
import { ValidationError } from '../src/platform/errors.js';

const ROW: CiRunRowLike = {
  id: 'row-1',
  ciInstallationId: 'inst-1',
  prNumber: 42,
  ranAt: new Date('2026-08-26T10:00:00.000Z'),
  status: 'succeeded',
  findingsCount: 3,
  costUsd: 0.012,
  githubUrl: 'https://github.com/acme/api/actions/runs/9',
  source: 'ci',
  repo: 'acme/api',
  workflowRunId: 9,
  agent: 'Security Reviewer',
  durationMs: 42_000,
  headSha: 'de50d5c',
  bundleVersion: '0.1.0',
  verdict: 'comment',
};

describe('toCiRun — the column is milliseconds, the contract is seconds', () => {
  it('converts duration_ms to duration_s', () => {
    // Both sides are `number`, so typecheck, lint and the response schema are
    // all blind to this: writing the column straight through shows a 42-second
    // run as 42 000 seconds and nothing fails.
    expect(toCiRun(ROW).duration_s).toBe(42);
  });

  it('keeps an unknown duration unknown rather than turning it into zero', () => {
    expect(toCiRun({ ...ROW, durationMs: null }).duration_s).toBeNull();
  });

  it('renders timestamps as ISO strings and carries the verdict through', () => {
    const dto = toCiRun(ROW);
    expect(dto.ran_at).toBe('2026-08-26T10:00:00.000Z');
    expect(dto.verdict).toBe('comment');
    expect(dto.workflow_run_id).toBe(9);
  });
});

describe('runStatusFromArtifact (AC-118, AC-131, AC-132)', () => {
  it('maps the three artifact states one-to-one', () => {
    expect(runStatusFromArtifact('succeeded')).toEqual({ status: 'succeeded', unrecognised: null });
    expect(runStatusFromArtifact('failed')).toEqual({ status: 'failed', unrecognised: null });
    // NEVER `failed` and never `no_findings`: a run that was deliberately not
    // performed is not a broken one, and not one that found nothing.
    expect(runStatusFromArtifact('skipped')).toEqual({ status: 'skipped', unrecognised: null });
  });

  it('treats a missing state as unknown, not as a default', () => {
    expect(runStatusFromArtifact(null)).toEqual({ status: null, unrecognised: null });
    expect(runStatusFromArtifact(undefined)).toEqual({ status: null, unrecognised: null });
  });

  it('drops a state this build does not carry, and hands back the value to log', () => {
    expect(runStatusFromArtifact('cancelled')).toEqual({
      status: null,
      unrecognised: 'cancelled',
    });
  });

  it('is not fooled by a prototype key', () => {
    // The value arrives as a free string from a file written inside someone
    // else's repository; `{}['__proto__']` is not undefined, which is why the
    // mapping is a Map.
    expect(runStatusFromArtifact('__proto__').status).toBeNull();
    expect(runStatusFromArtifact('constructor').status).toBeNull();
  });
});

describe('parseRepoRef (§ Untrusted inputs)', () => {
  it('accepts owner/name', () => {
    expect(parseRepoRef('acme/payments-api')).toEqual({ owner: 'acme', name: 'payments-api' });
  });

  it.each([
    ['../../etc/passwd', 'traversal'],
    ['acme/../other', 'traversal in the second segment'],
    ['acme/api/extra', 'more than one slash'],
    ['acme', 'no slash'],
    ['acme /api', 'whitespace'],
    ['acme/api?x=1', 'a query string'],
    ['', 'empty'],
  ])('refuses %s (%s)', (repo) => {
    expect(() => parseRepoRef(repo)).toThrow(ValidationError);
  });
});

describe('toInstallationListItem — staleness (AC-90)', () => {
  const base = {
    id: 'i',
    agentId: 'a',
    agentName: 'Security Reviewer',
    repo: 'acme/api',
    targetType: 'gha' as const,
    installedAt: new Date('2026-08-01T00:00:00.000Z'),
    lastRunStatus: null,
    lastRunAt: null,
    lastPolledAt: new Date('2026-08-26T00:00:00.000Z'),
    workflowPresent: true,
    observedAgent: null,
  };

  it('marks an installation below the agent’s current version', () => {
    expect(toInstallationListItem({ ...base, agentVersion: 2, currentAgentVersion: 3 }).stale).toBe(
      true,
    );
  });

  it('does not mark one at the current version', () => {
    expect(toInstallationListItem({ ...base, agentVersion: 3, currentAgentVersion: 3 }).stale).toBe(
      false,
    );
  });

  it('does not guess about a row that predates the column', () => {
    // A row with no recorded version is UNKNOWN, not old. A marker on it would
    // tell someone to republish a bundle that may already be current.
    expect(
      toInstallationListItem({ ...base, agentVersion: null, currentAgentVersion: 3 }).stale,
    ).toBe(false);
  });
});

describe('readArtifactJson (AC-71)', () => {
  const zipOf = (entries: Record<string, string>) =>
    zipSync(Object.fromEntries(Object.entries(entries).map(([k, v]) => [k, strToU8(v)])));

  it('reads the one document inside the archive', () => {
    const bytes = zipOf({ 'devdigest-result.json': '{"findings_count":2}' });
    expect(readArtifactJson(bytes)).toEqual({ findings_count: 2 });
  });

  it('refuses an archive holding more than one file', () => {
    const bytes = zipOf({ 'a.json': '{}', 'b.json': '{}' });
    expect(() => readArtifactJson(bytes)).toThrow(/more than one file|exactly one file/);
  });

  it('refuses content that is not JSON', () => {
    const bytes = zipOf({ 'devdigest-result.json': 'not json' });
    expect(() => readArtifactJson(bytes)).toThrow(/not valid JSON/);
  });

  it('refuses content over the unpacked ceiling before it is inflated', () => {
    // Highly compressible: a small archive that declares a large member is the
    // shape the budget inside fflate's `filter` exists for.
    const bytes = zipOf({ 'devdigest-result.json': 'a'.repeat(5 * 1024 * 1024) });
    expect(bytes.byteLength).toBeLessThan(1024 * 1024);
    expect(() => readArtifactJson(bytes)).toThrow(/exceeds/);
  });
});

describe('zipFiles (AC-44)', () => {
  it('writes every file at its own path', () => {
    const bytes = zipFiles([
      { path: '.devdigest/memory.jsonl', contents: '', editable: true, role: 'memory' },
      {
        path: '.github/workflows/devdigest-review-security-reviewer.yml',
        contents: 'name: x\n',
        editable: true,
        role: 'workflow',
      },
    ]);
    const text = new TextDecoder().decode(bytes);
    expect(text).toContain('.devdigest/memory.jsonl');
    expect(text).toContain('.github/workflows/devdigest-review-security-reviewer.yml');
  });
});

describe('findYamlProblem (AC-55)', () => {
  it('accepts the shapes a workflow is actually written in', () => {
    const valid = [
      'name: x\non:\n  pull_request:\n    types: [opened]\n',
      // The BLOCK form of the same list — the style a person hand-editing the
      // file is most likely to reach for.
      'on:\n  pull_request:\n    types:\n      - opened\n      - synchronize\n',
      'jobs:\n  review:\n    steps:\n      - uses: actions/checkout@v4\n      - run: node x.mjs\n',
      '# just a comment\nname: x\n',
      'run: |\n  echo one\n  echo two\nname: after\n',
      "name: 'quoted: colon inside'\n",
    ];
    for (const text of valid) expect(findYamlProblem(text)).toBeNull();
  });

  it('names the line of a tab in the indentation', () => {
    expect(findYamlProblem('name: x\n\tbad: y\n')).toEqual({
      line: 2,
      message: 'a tab is used for indentation, which YAML forbids',
    });
  });

  it('names the line of an unterminated quote', () => {
    expect(findYamlProblem("name: x\nother: 'unclosed\n")?.line).toBe(2);
  });

  it('names the line of an indent that opens no block', () => {
    expect(findYamlProblem('a:\n  b: 1\n c: 2\n')?.line).toBe(3);
  });

  it('names a bare scalar sitting among mappings', () => {
    expect(findYamlProblem('name: x\nthis is not a pair\n')).toEqual({
      line: 2,
      message: 'expected a "key: value" pair',
    });
  });

  /**
   * The scan skips blank lines, so every one of these used to walk out as null
   * and `refuseBrokenWorkflow` — the one gate every export path goes through —
   * had nothing to throw. An empty document is legal YAML; it is not a legal
   * workflow, and this is the workflow gate.
   */
  it.each([
    ['zero bytes', ''],
    ['one newline', '\n'],
    ['spaces and tabs only', '   \t\n  \n'],
    ['CRLF only', '\r\n\r\n'],
  ])('refuses a workflow that is %s', (_label, text) => {
    expect(findYamlProblem(text)).toEqual({ line: 1, message: 'the file is empty' });
  });

  it('still accepts a file whose only content is a comment', () => {
    // The scanner is biased towards accepting, and a comment IS content — the
    // new check reads `trim()`, not "does it parse as a workflow".
    expect(findYamlProblem('# nothing here yet\n')).toBeNull();
  });
});

describe('toInstallationListItem — is this installation confirmed? (AC-85, AC-147…AC-149)', () => {
  const base = {
    id: 'i',
    agentId: 'ba6ec5cf-0000-4000-8000-000000000001',
    agentName: 'Security Reviewer',
    repo: 'acme/api',
    targetType: 'gha' as const,
    installedAt: new Date('2026-08-01T00:00:00.000Z'),
    agentVersion: 3,
    currentAgentVersion: 3,
    lastRunStatus: null,
    lastRunAt: null,
    lastPolledAt: new Date('2026-08-26T00:00:00.000Z'),
    workflowPresent: true as boolean | null,
    observedAgent: null as string | null,
  };

  it('names the workflow file the agent’s slug resolves to (AC-147)', () => {
    expect(toInstallationListItem(base).workflow_path).toBe(
      '.github/workflows/devdigest-review-security-reviewer.yml',
    );
  });

  it('falls back to the row id, exactly as the generator does (AC-105)', () => {
    expect(toInstallationListItem({ ...base, agentName: '!!!' }).workflow_path).toBe(
      `.github/workflows/devdigest-review-${base.agentId}.yml`,
    );
  });

  it('confirms an installation whose last poll found its file running its agent', () => {
    const item = toInstallationListItem(base);
    expect(item.unconfirmed_reason).toBeNull();
    expect(item.observed_agent).toBeNull();
  });

  it('says never_polled while no poll has returned (AC-148)', () => {
    // And says it even when the other two columns are empty, which they are: an
    // installation nobody has polled is not evidence of a missing workflow.
    expect(
      toInstallationListItem({ ...base, lastPolledAt: null, workflowPresent: null })
        .unconfirmed_reason,
    ).toBe('never_polled');
  });

  it('says workflow_missing when the poll found no such file (AC-147)', () => {
    expect(
      toInstallationListItem({ ...base, workflowPresent: false }).unconfirmed_reason,
    ).toBe('workflow_missing');
  });

  it('says other_agent, and names it, when the file runs someone else (AC-149)', () => {
    const item = toInstallationListItem({ ...base, observedAgent: 'general-reviewer' });
    expect(item.unconfirmed_reason).toBe('other_agent');
    expect(item.observed_agent).toBe('general-reviewer');
  });
});
