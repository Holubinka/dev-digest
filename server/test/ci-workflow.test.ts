/**
 * P3.3 / P3.5 — the generated `devdigest-review-<slug>.yml`.
 *
 * Every assertion here is a security property of a file that will run inside
 * SOMEONE ELSE'S repository, which is why they are asserted on the TEXT rather
 * than on the generator's inputs: what GitHub executes is the string, and a
 * refactor that keeps the inputs and changes the string is exactly the change
 * that must not pass.
 */
import { describe, it, expect } from 'vitest';
import { PINNED_ACTIONS } from '../src/modules/ci/constants.js';
import { renderWorkflow, type PostAs } from '../src/modules/ci/generate/workflow.js';
import { findYamlProblem } from '../src/modules/ci/generate/yaml-lint.js';

const TRIGGERS = ['opened', 'synchronize'];
const render = (postAs: PostAs = 'github_review', triggers = TRIGGERS) =>
  renderWorkflow({
    triggers,
    postAs,
    agentSlug: 'security-reviewer',
    agentName: 'Security Reviewer',
  });

/** Every `run:` line's body, block scalars included. */
function runLines(text: string): string[] {
  return text
    .split('\n')
    .filter((l) => /^\s*(- )?run:/.test(l))
    .map((l) => l.replace(/^\s*(- )?run:\s*/, ''));
}

describe('the trigger block (AC-34, AC-35, AC-46)', () => {
  it('never uses pull_request_target', () => {
    for (const postAs of ['github_review', 'pr_comment', 'none'] as PostAs[]) {
      expect(render(postAs)).not.toContain('pull_request_target');
    }
  });

  it('holds only pull_request, with exactly the chosen types', () => {
    const yml = render('github_review', ['opened', 'reopened']);
    expect(yml).toContain('on:\n  pull_request:\n    types: [opened, reopened]');
    expect(yml).not.toContain('synchronize');
    // No second event sneaks in beside it.
    expect(yml.match(/^on:$/gm)).toHaveLength(1);
    expect(yml).not.toMatch(/^\s{2}(push|schedule|workflow_dispatch|issue_comment):/m);
  });
});

describe('permissions (AC-33)', () => {
  it('is contents:read + pull-requests:write when the run publishes', () => {
    for (const postAs of ['github_review', 'pr_comment'] as PostAs[]) {
      expect(render(postAs)).toContain(
        'permissions:\n  contents: read\n  pull-requests: write\n',
      );
    }
  });

  it('is contents:read alone when nothing is published', () => {
    const yml = render('none');
    expect(yml).toContain('permissions:\n  contents: read\n');
    expect(yml).not.toContain('pull-requests: write');
  });

  it('grants nothing else, whatever the publication', () => {
    for (const postAs of ['github_review', 'pr_comment', 'none'] as PostAs[]) {
      const block = /permissions:\n((?:  \S+: \S+\n)+)/.exec(render(postAs))?.[1] ?? '';
      const granted = block.trim().split('\n').map((l) => l.trim());
      expect(granted.every((l) => ['contents: read', 'pull-requests: write'].includes(l))).toBe(
        true,
      );
    }
  });
});

describe('the supply chain (AC-48, AC-49)', () => {
  it('pins every external action to a 40-character SHA with its version in a comment', () => {
    const yml = render();
    const uses = yml.split('\n').filter((l) => l.includes('uses:'));
    expect(uses.length).toBeGreaterThan(0);
    for (const line of uses) {
      expect(line).toMatch(/uses: [\w.-]+\/[\w.-]+@[0-9a-f]{40} # v[\d.]+$/);
    }
    // And the SHAs are the table's, not a literal typed into the generator.
    for (const action of Object.values(PINNED_ACTIONS)) {
      expect(action.sha).toMatch(/^[0-9a-f]{40}$/);
      expect(yml).toContain(`${action.name}@${action.sha} # ${action.version}`);
    }
  });

  it('installs nothing from the network', () => {
    const yml = render();
    for (const forbidden of ['npm install', 'npm ci', 'npx ', 'pnpm ', 'yarn ', 'curl ', 'wget ']) {
      expect(yml).not.toContain(forbidden);
    }
  });

  it('runs the committed bundle, not a published action (AC-53)', () => {
    const yml = render();
    expect(runLines(yml)).toContain('node .devdigest/runner.mjs');
    expect(yml).not.toContain('devdigest/review-action');
  });
});

describe('untrusted data never reaches a shell (AC-50)', () => {
  it('interpolates no expression into any run: line', () => {
    for (const postAs of ['github_review', 'pr_comment', 'none'] as PostAs[]) {
      for (const line of runLines(render(postAs))) {
        expect(line).not.toContain('${{');
      }
    }
  });

  it('hands the PR number to the runner through env:, as a variable', () => {
    const yml = render();
    expect(yml).toContain(
      '          DEVDIGEST_PR_NUMBER: ${{ github.event.pull_request.number }}',
    );
  });

  it('passes the fork flag, which is what makes the skip the runner’s (AC-52, AC-110)', () => {
    // NOT a step-level `if:`. A workflow that skipped the runner step would
    // also skip the artifact AC-110 requires by the same path as the size skip.
    const yml = render();
    // The cross-repository comparison, never `head.repo.fork` — see the comment
    // in `generate/workflow.ts`. A repository that is itself a fork reports
    // `fork: true` on its own internal PRs, which skipped every review.
    expect(yml).toContain(
      'DEVDIGEST_IS_FORK: ${{ github.event.pull_request.head.repo.full_name != github.repository }}',
    );
    expect(yml).not.toContain('head.repo.fork');
    expect(yml).not.toMatch(/if: .*fork/);
  });
});

describe('the secret (AC-47, AC-92)', () => {
  it('reaches the job on exactly one line, and that line is the env entry', () => {
    const yml = render();
    const mentions = yml.split('\n').filter((l) => l.includes('OPENROUTER_API_KEY'));
    expect(mentions).toHaveLength(1);
    // The name appears twice ON that line — once as the env key, once inside the
    // expression — and nowhere else. What AC-47 forbids is a SECOND site: a
    // `run:` line, an `env:` at job level, an input to a third-party action.
    expect(mentions[0]!.trim()).toBe('OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}');
    expect(runLines(yml).join('\n')).not.toContain('OPENROUTER_API_KEY');
  });
});

describe('the job frame (AC-51, AC-54)', () => {
  it('carries a timeout and a per-PR, per-AGENT concurrency group that cancels', () => {
    const yml = render();
    expect(yml).toMatch(/^    timeout-minutes: \d+$/m);
    // AC-139: the slug is inside the group. Without it, two agents on one pull
    // request share a group and `cancel-in-progress` kills the first agent's
    // run the moment the second starts.
    expect(yml).toContain(
      'concurrency:\n' +
        '  group: devdigest-review-security-reviewer-${{ github.event.pull_request.number }}\n' +
        '  cancel-in-progress: true',
    );
  });

  it('uploads devdigest-result with if: always(), holding one named file', () => {
    const yml = render();
    expect(yml).toContain('        if: always()');
    expect(yml).toContain('          name: devdigest-result');
    expect(yml).toContain('          path: devdigest-result.json');
  });
});

describe('the output is YAML', () => {
  it('passes the module’s own scanner for every publication choice', () => {
    for (const postAs of ['github_review', 'pr_comment', 'none'] as PostAs[]) {
      expect(findYamlProblem(render(postAs))).toBeNull();
    }
  });
});

describe('the check is named after the agent (AC-30, AC-138)', () => {
  const named = (agentName: string, agentSlug = 'security-reviewer') =>
    renderWorkflow({ triggers: TRIGGERS, postAs: 'github_review', agentSlug, agentName });

  it('puts the agent in the workflow name AND in the job name', () => {
    const yml = named('Security Reviewer');
    // Both, because a branch protection rule matches the JOB's name: a workflow
    // name alone leaves two agents' checks both called "review", and AC-138's
    // "each can be required separately" would be false.
    expect(yml).toContain('name: "DevDigest Review (Security Reviewer)"');
    expect(yml).toContain('    name: "DevDigest Review (Security Reviewer)"');
  });

  it('gives two agents two different check names', () => {
    const a = named('Security Reviewer', 'security-reviewer');
    const b = named('General Reviewer', 'general-reviewer');
    const nameLines = (yml: string) => yml.split('\n').filter((l) => /^\s*name: "/.test(l));
    expect(nameLines(a)).not.toEqual(nameLines(b));
  });

  it('quotes a name that would otherwise end the scalar, and stays YAML', () => {
    // The name is typed by a person and lands in a file GitHub EXECUTES. A `:`
    // plus a newline in an unquoted scalar is a new key in the workflow.
    const yml = named('Rm: -rf\nschedule:\n  - cron: "* * * * *"');
    expect(findYamlProblem(yml)).toBeNull();
    expect(yml).not.toMatch(/^schedule:/m);
    expect(yml.match(/^on:$/gm)).toHaveLength(1);
    expect(yml).toContain('\\n');
  });
});
