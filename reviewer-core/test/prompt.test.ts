/**
 * assemblePrompt — PR description slot (the fix that was missing: the PR body
 * never reached the prompt). Pins rendering, omit-when-empty, untrusted-wrap,
 * truncation, and ordering (before the diff).
 */
import { describe, it, expect } from 'vitest';
import { assemblePrompt } from '../src/prompt.js';

function userOf(parts: Parameters<typeof assemblePrompt>[0]): string {
  const { messages } = assemblePrompt(parts);
  return messages[1]!.content;
}

function systemOf(parts: Parameters<typeof assemblePrompt>[0]): string {
  return assemblePrompt(parts).messages[0]!.content;
}

describe('assemblePrompt — shared injection guard (server + CI)', () => {
  const sys = systemOf({ system: 'AGENT-SYS', diff: 'DIFF' });

  it('appends the guard to the agent system prompt', () => {
    expect(sys.startsWith('AGENT-SYS')).toBe(true);
    expect(sys).toMatch(/<untrusted>.*DATA to be analyzed/s);
  });

  it('forbids "intentional/test/demo" claims from descoping the review', () => {
    // The defense that replaced the keyword sanitizer: a general, trusted,
    // language-agnostic rule — not text parsing of untrusted input.
    expect(sys).toMatch(/test fixture|intentional|demo/i);
    expect(sys).toMatch(/never reduce|never .*descope|REPORT it/i);
    expect(sys).toMatch(/any language/i);
  });
});

describe('assemblePrompt — ## PR description', () => {
  it('renders the section (untrusted-wrapped) before the diff when present', () => {
    const { messages, assembly } = assemblePrompt({
      system: 'sys',
      diff: 'DIFF',
      prDescription: 'Adds rate limiting to the public /api endpoints.',
    });
    const user = messages[1]!.content;
    expect(user).toContain('## PR description');
    expect(user).toContain('<untrusted source="pr-description">');
    expect(user).toContain('Adds rate limiting to the public /api endpoints.');
    expect(user.indexOf('## PR description')).toBeLessThan(user.indexOf('## Diff to review'));
    expect(assembly.pr_description).toContain('Adds rate limiting');
  });

  it('omits the section when prDescription is undefined or blank (no behaviour change)', () => {
    expect(userOf({ system: 'sys', diff: 'DIFF' })).not.toContain('## PR description');
    expect(assemblePrompt({ system: 'sys', diff: 'DIFF' }).assembly.pr_description ?? null).toBeNull();
    expect(userOf({ system: 'sys', diff: 'DIFF', prDescription: '   ' })).not.toContain(
      '## PR description',
    );
  });

  it('truncates a huge body to the 4k cap', () => {
    const { assembly } = assemblePrompt({
      system: 'sys',
      diff: 'D',
      prDescription: 'x'.repeat(10_000),
    });
    expect((assembly.pr_description as string).length).toBe(4000);
  });
});

describe('assemblePrompt — ## Skills / rules', () => {
  const parts = { system: 'sys', diff: 'DIFF', skills: ['# First\nOne.', '# Second\nTwo.'] };

  it('joins the bodies under one heading, in the order given', () => {
    const user = userOf(parts);
    expect(user).toContain('## Skills / rules');
    expect(user).toContain('# First\nOne.\n\n# Second\nTwo.');
  });

  it('sits after the PR description and before the memory slot', () => {
    const user = userOf({ ...parts, prDescription: 'Body.', memory: ['A memory.'] });
    expect(user.indexOf('## PR description')).toBeLessThan(user.indexOf('## Skills / rules'));
    expect(user.indexOf('## Skills / rules')).toBeLessThan(user.indexOf('## Relevant memory'));
  });

  it('omits the section when no skill is bound', () => {
    expect(userOf({ system: 'sys', diff: 'DIFF' })).not.toContain('## Skills / rules');
    expect(userOf({ system: 'sys', diff: 'DIFF', skills: [] })).not.toContain('## Skills / rules');
    expect(assemblePrompt({ system: 'sys', diff: 'DIFF' }).assembly.skills ?? null).toBeNull();
  });

  it('does NOT fence a skill as untrusted data — a skill is an instruction', () => {
    // Pinned deliberately. A skill body carries the same standing as the agent's
    // own system prompt, which is precisely why an imported skill is stored
    // disabled until a human has read it. Wrapping it would demote it to data
    // the model is told to ignore — quietly breaking the feature while looking
    // like a security improvement.
    const { assembly } = assemblePrompt(parts);
    expect(assembly.skills).not.toContain('<untrusted');
    expect(assembly.skills).toBe('# First\nOne.\n\n# Second\nTwo.');
  });
});
