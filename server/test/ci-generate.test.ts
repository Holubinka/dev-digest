/**
 * P3.3 — the bundle and the agent manifest.
 *
 * The generator is a pure function of an agent row, its skills and the built
 * runner: it is handed no `SecretsProvider`, no `Db` and no container, which is
 * what makes "no generated file carries a secret's value" (AC-25) a property of
 * the code's shape. This file checks the SHAPE of what it produces; the
 * route-level suite checks that the real container still reaches it that way.
 */
import { describe, it, expect } from 'vitest';
import { AgentManifest, type RunnerBundleInfo } from '@devdigest/shared';
import {
  BUNDLE_AGENTS_DIR,
  BUNDLE_SKILLS_DIR,
  DEVDIGEST_ROOT,
} from '../src/modules/_shared/bundle-paths.js';
import { buildBundle, type BundleInput, type BundleSkill } from '../src/modules/ci/generate/bundle.js';
import { buildManifest, manifestToYaml } from '../src/modules/ci/generate/manifest.js';
import { findYamlProblem } from '../src/modules/ci/generate/yaml-lint.js';

/**
 * Built from `_shared/`, not spelled out, so this file cannot agree with a
 * renamed generator while `modules/context` still excludes the old names —
 * which is what two independent sets of literals bought until 2026-08-26.
 */
const AGENTS_DIR = `${DEVDIGEST_ROOT}/${BUNDLE_AGENTS_DIR}`;
const SKILLS_DIR = `${DEVDIGEST_ROOT}/${BUNDLE_SKILLS_DIR}`;

const RUNNER: RunnerBundleInfo = {
  contents: '// DevDigest agent-runner v0.1.0 — built from cafe1234\n// generated — do not edit\n',
  version: '0.1.0',
  sourceSha: 'cafe1234',
  bytes: 96,
};

const AGENT = {
  id: 'ba6ec5cf-0000-4000-8000-000000000001',
  name: 'Security Reviewer',
  provider: 'openrouter' as const,
  model: 'anthropic/claude-sonnet-4',
  systemPrompt: 'Review for security.',
  strategy: 'single-pass' as const,
  ciFailOn: 'critical' as const,
};

function bundle(over: Partial<BundleInput> = {}) {
  return buildBundle({
    agent: AGENT,
    skills: [],
    runner: RUNNER,
    triggers: ['opened', 'synchronize'],
    postAs: 'github_review',
    ...over,
  });
}

const skill = (name: string, body = 'Rule.'): BundleSkill => ({
  id: `id-${name}`,
  name,
  body,
});

describe('the file list (AC-16, AC-38)', () => {
  it('is exactly the six paths of AC-16 for one bound skill, in order', () => {
    const { files } = bundle({ skills: [skill('Secret Leaks')] });
    expect(files.map((f) => f.path)).toEqual([
      `${AGENTS_DIR}/security-reviewer.yaml`,
      `${SKILLS_DIR}/secret-leaks.md`,
      `${DEVDIGEST_ROOT}/memory.jsonl`,
      `${DEVDIGEST_ROOT}/runner.mjs`,
      `${DEVDIGEST_ROOT}/.gitattributes`,
      // AC-135: derived from the agent's slug, exactly as the manifest is.
      '.github/workflows/devdigest-review-security-reviewer.yml',
    ]);
  });

  /**
   * The ONE place the strings themselves are written down.
   *
   * Everything else here reads them from `_shared/bundle-paths.ts`, which is what
   * keeps this file and the scan exclusion the same fact. That leaves nothing
   * pinning the fact to the folders a committed bundle actually occupies in a
   * target repository — so it is pinned here, once, and a rename fails one named
   * test instead of none.
   */
  it('writes into `.devdigest`, `agents` and `skills` — the names the scan excludes', () => {
    expect(DEVDIGEST_ROOT).toBe('.devdigest');
    expect(AGENTS_DIR).toBe('.devdigest/agents');
    expect(SKILLS_DIR).toBe('.devdigest/skills');
  });

  it('is five files for an agent that binds none — the count follows the list', () => {
    const { files } = bundle({ skills: [] });
    expect(files).toHaveLength(5);
    expect(files.some((f) => f.path.startsWith(`${SKILLS_DIR}/`))).toBe(false);
  });

  it('grows by exactly one file per bound skill, with disambiguated names', () => {
    const { files } = bundle({ skills: [skill('Rules'), skill('rules!'), skill('Rules 2')] });
    expect(files.filter((f) => f.path.startsWith(`${SKILLS_DIR}/`)).map((f) => f.path)).toEqual([
      `${SKILLS_DIR}/rules.md`,
      `${SKILLS_DIR}/rules-2.md`,
      `${SKILLS_DIR}/rules-2-2.md`,
    ]);
    expect(files).toHaveLength(8);
  });
});

describe('what each file is (AC-19, AC-21, AC-23, AC-95, AC-96)', () => {
  it('ships memory.jsonl EMPTY — zero lines, nothing from any database', () => {
    const memory = bundle().files.find((f) => f.path === `${DEVDIGEST_ROOT}/memory.jsonl`);
    expect(memory?.contents).toBe('');
  });

  it('marks the runner and .gitattributes generated, everything else editable', () => {
    const byPath = new Map(bundle().files.map((f) => [f.path, f.editable]));
    expect(byPath.get(`${DEVDIGEST_ROOT}/runner.mjs`)).toBe(false);
    expect(byPath.get(`${DEVDIGEST_ROOT}/.gitattributes`)).toBe(false);
    expect(byPath.get('.github/workflows/devdigest-review-security-reviewer.yml')).toBe(true);
    expect(byPath.get(`${AGENTS_DIR}/security-reviewer.yaml`)).toBe(true);
  });

  it('tells GitHub the runner is generated (AC-23)', () => {
    const attrs = bundle().files.find((f) => f.path === `${DEVDIGEST_ROOT}/.gitattributes`);
    expect(attrs?.contents).toBe('runner.mjs linguist-generated=true\n');
  });

  it('writes the port’s bytes verbatim, banner and all (AC-22)', () => {
    const runner = bundle().files.find((f) => f.path === `${DEVDIGEST_ROOT}/runner.mjs`);
    expect(runner?.contents).toBe(RUNNER.contents);
  });

  it('commits a hand-edited workflow instead of the generated one (AC-31)', () => {
    const edited = 'name: Mine\non:\n  pull_request:\n    types: [opened]\n';
    const wf = bundle({ workflowOverride: edited }).files.find((f) => f.path.endsWith('.yml'));
    expect(wf?.contents).toBe(edited);
  });

  it('labels a skill body that has no heading of its own', () => {
    const files = bundle({ skills: [skill('Secret Leaks', 'Never log a token.')] }).files;
    expect(files[1]?.contents).toBe('### Secret Leaks\nNever log a token.');
    const headed = bundle({ skills: [skill('Secret Leaks', '# Secret Leaks\nBody.')] }).files;
    expect(headed[1]?.contents).toBe('# Secret Leaks\nBody.');
  });
});

describe('the manifest (AC-25, AC-26)', () => {
  it('validates against AgentManifest and carries the agent’s current ci_fail_on', () => {
    const manifest = buildManifest({
      name: AGENT.name,
      provider: AGENT.provider,
      model: AGENT.model,
      systemPrompt: AGENT.systemPrompt,
      strategy: AGENT.strategy,
      // `any` is a value the CI tab's three-way control never sends, and the
      // manifest must still carry it: the gate the runner applies is the
      // COLUMN's, not the control's (AC-101).
      ciFailOn: 'any',
      skillSlugs: ['secret-leaks'],
    });
    expect(manifest.ci_fail_on).toBe('any');
    expect(() => AgentManifest.parse(manifest)).not.toThrow();
  });

  it('serialises to YAML that the module’s own scanner accepts', () => {
    const yaml = bundle({ skills: [skill('Secret Leaks')] }).files[0]!.contents;
    expect(findYamlProblem(yaml)).toBeNull();
    expect(yaml).toContain('name: Security Reviewer');
    expect(yaml).toContain('ci_fail_on: critical');
    expect(yaml).toContain('  - secret-leaks');
  });

  it('keeps a multi-line system prompt in an explicitly indented block scalar', () => {
    // Without the `|2-` indicator YAML infers the content indentation from the
    // first non-empty line, so a prompt whose first line is itself indented
    // would re-indent the whole block.
    const yaml = manifestToYaml(
      buildManifest({
        name: 'A',
        provider: 'openai',
        model: 'gpt-4.1',
        systemPrompt: '    indented first line\nsecond line',
        strategy: 'auto',
        ciFailOn: 'never',
        skillSlugs: [],
      }),
    );
    expect(yaml).toContain('system_prompt: |2-\n      indented first line\n  second line');
    expect(findYamlProblem(yaml)).toBeNull();
    expect(yaml).toContain('skills: []');
  });

  it('quotes a name YAML would otherwise read as something else', () => {
    const yaml = manifestToYaml(
      buildManifest({
        name: 'no',
        provider: 'openai',
        model: '4.1',
        systemPrompt: 'x',
        strategy: 'auto',
        ciFailOn: 'never',
        skillSlugs: [],
      }),
    );
    expect(yaml).toContain("name: 'no'");
    expect(yaml).toContain("model: '4.1'");
  });
});

describe('one workflow file per agent (AC-135, AC-136, AC-146)', () => {
  const workflowOf = (name: string, id = AGENT.id) =>
    bundle({ agent: { ...AGENT, name, id } }).files.find((f) => f.role === 'workflow')!;

  it('names the file after the agent slug, behind the fixed prefix', () => {
    expect(workflowOf('Security Reviewer').path).toBe(
      '.github/workflows/devdigest-review-security-reviewer.yml',
    );
  });

  it('gives two agents two paths, so neither bundle overwrites the other', () => {
    expect(workflowOf('Security Reviewer').path).not.toBe(workflowOf('General Reviewer').path);
  });

  it('keeps the prefix in front of the slug, whatever the agent is called', () => {
    // Without it, an agent named "Client" generates `.github/workflows/client.yml`
    // and publishing it overwrites a real, unrelated workflow in the target repo.
    expect(workflowOf('Client').path).toBe('.github/workflows/devdigest-review-client.yml');
  });

  it('falls back to the row id when the name slugifies to nothing (AC-105)', () => {
    expect(workflowOf('!!!').path).toBe(`.github/workflows/devdigest-review-${AGENT.id}.yml`);
  });

  it('asks the commit to remove the legacy shared file, and nothing else', () => {
    expect(bundle().removals).toEqual(['.github/workflows/devdigest-review.yml']);
  });

  it('never asks to remove a path it also writes', () => {
    const b = bundle({ skills: [skill('Secret Leaks')] });
    const written = new Set(b.files.map((f) => f.path));
    expect(b.removals.filter((r) => written.has(r))).toEqual([]);
  });
});

describe('a file says what it IS (AC-20, AC-31)', () => {
  it('labels every generated file with its role, in AC-16 order', () => {
    const { files } = bundle({ skills: [skill('Secret Leaks')] });
    expect(files.map((f) => f.role)).toEqual([
      'manifest',
      'skill',
      'memory',
      'runner',
      'gitattributes',
      'workflow',
    ]);
  });

  it('marks exactly one file the workflow, whatever the agent is called', () => {
    // The wizard selects the workflow by this and never by a path constant —
    // which is the whole reason the role exists (D23).
    for (const name of ['Security Reviewer', '!!!', 'Client']) {
      const { files } = bundle({ agent: { ...AGENT, name }, skills: [skill('A'), skill('B')] });
      expect(files.filter((f) => f.role === 'workflow')).toHaveLength(1);
    }
  });
});
