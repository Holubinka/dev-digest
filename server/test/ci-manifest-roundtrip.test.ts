/**
 * The manifest survives a real YAML parser, not only this repo's own scanner.
 *
 * `manifestToYaml` is hand-rolled — `yamlScalar` / `yamlBlock` / `yamlField` in
 * `generate/manifest.ts` — and until this file the only thing standing behind
 * it was `findYamlProblem`, which is a LINEAR SANITY SCAN, not a parser: it
 * answers "would GitHub refuse this file", and it accepts plenty of YAML that
 * parses to something other than what was written. The other assertions were
 * `toContain` over the rendered string, which cannot see a round trip either.
 *
 * So the property that actually matters was never tested: the runner reads this
 * file back with `yaml` (`agent-runner/src/inputs.ts` → `parse`), and what it
 * gets must be what the studio put in. This file parses with **the same
 * library at the same major version** the runner uses, and compares objects.
 *
 * A failure here is not a test bug. It means an agent whose name, prompt or
 * skill slug contains the offending shape is exported into someone else's
 * repository and reviewed under a different configuration from the one on the
 * screen — silently, because every other gate is green.
 */
import { describe, it, expect } from 'vitest';
import { parse } from 'yaml';
import { AgentManifest } from '@devdigest/shared';
import { buildManifest, manifestToYaml } from '../src/modules/ci/generate/manifest.js';

/** A manifest with one field replaced, built through the real constructor. */
function manifestWith(over: Partial<Parameters<typeof buildManifest>[0]> = {}) {
  return buildManifest({
    name: 'Security Reviewer',
    model: 'anthropic/claude-sonnet-4',
    systemPrompt: 'Review for security.',
    strategy: 'single-pass',
    ciFailOn: 'critical',
    skillSlugs: ['secret-leaks'],
    ...over,
  });
}

/** Render, parse with the runner's own library, and validate against the contract. */
function roundTrip(manifest: ReturnType<typeof buildManifest>) {
  const text = manifestToYaml(manifest);
  const parsed = parse(text);
  return { text, parsed, validated: AgentManifest.safeParse(parsed) };
}

describe('the manifest round-trips through the parser the runner uses', () => {
  it('returns the same object for an ordinary agent', () => {
    const manifest = manifestWith();
    const { parsed, validated } = roundTrip(manifest);
    expect(validated.success).toBe(true);
    expect(parsed).toEqual(manifest);
  });

  // Each of these is a shape that a hand-rolled serialiser gets wrong in a
  // different way, and every one is reachable from the agent editor: a name is
  // free text, and a system prompt is a textarea.
  const HOSTILE: [string, string][] = [
    ['a colon and a space', 'Reviewer: security'],
    ['a leading hash', '#1 Reviewer'],
    ['a trailing space', 'Reviewer '],
    ['a leading space', ' Reviewer'],
    ['a single quote', "O'Brien's Reviewer"],
    ['a double quote', 'The "strict" Reviewer'],
    ['a backslash', 'C:\\reviewers\\security'],
    ['a YAML boolean', 'yes'],
    ['a YAML null', 'null'],
    ['a number-like value', '1.20'],
    ['a leading dash', '- Reviewer'],
    ['an opening brace', '{ Reviewer }'],
    ['an opening bracket', '[Reviewer]'],
    ['an ampersand', '&anchor Reviewer'],
    ['an asterisk', '*alias Reviewer'],
    ['a tab', 'Reviewer\tsecurity'],
    ['an em dash and emoji', 'Reviewer — 🔥 fast'],
  ];

  it.each(HOSTILE)('keeps a name containing %s', (_label, name) => {
    const manifest = manifestWith({ name });
    const { parsed, validated } = roundTrip(manifest);
    expect(validated.success).toBe(true);
    expect((parsed as { name: string }).name).toBe(name);
  });

  it.each(HOSTILE)('keeps a system prompt containing %s', (_label, prompt) => {
    const manifest = manifestWith({ systemPrompt: prompt });
    const { parsed } = roundTrip(manifest);
    expect((parsed as { system_prompt: string }).system_prompt).toBe(prompt);
  });

  it('keeps a multi-line prompt exactly, including its indentation and blank lines', () => {
    const prompt = ['  indented first line', '', 'second line', '\ttabbed', 'trailing:'].join('\n');
    const manifest = manifestWith({ systemPrompt: prompt });
    const { parsed } = roundTrip(manifest);
    expect((parsed as { system_prompt: string }).system_prompt).toBe(prompt);
  });

  it('keeps every skill slug, and an empty list stays a list', () => {
    const skills = ['secret-leaks', 'no', 'null', '1.0', '- dash'];
    expect((roundTrip(manifestWith({ skillSlugs: skills })).parsed as { skills: string[] }).skills).toEqual(
      skills,
    );
    expect((roundTrip(manifestWith({ skillSlugs: [] })).parsed as { skills: string[] }).skills).toEqual(
      [],
    );
  });
});
