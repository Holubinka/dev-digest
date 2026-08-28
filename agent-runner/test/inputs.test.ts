import { describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  MEMORY_MAX_BYTES,
  MEMORY_MAX_LINES,
  ManifestError,
  readManifest,
  readMemory,
  readSkillBodies,
  resolveBundlePath,
} from '../src/inputs.js';
import { VALID_MANIFEST, bundleDir } from './helpers.js';

describe('readManifest', () => {
  it('validates a bundle manifest and applies the contract defaults', () => {
    const root = bundleDir({ '.devdigest/agents/security.yaml': VALID_MANIFEST });
    const manifest = readManifest(root, 'security');
    expect(manifest.name).toBe('Security Reviewer');
    expect(manifest.model).toBe('deepseek/deepseek-v4-flash');
    expect(manifest.skills).toEqual(['secret-leakage']);
    expect(manifest.ci_fail_on).toBe('critical');
  });

  it('normalises a null `skills:` key to an empty list', () => {
    const root = bundleDir({
      '.devdigest/agents/a.yaml': 'name: A\nmodel: m\nsystem_prompt: p\nskills:\n',
    });
    expect(readManifest(root, 'a').skills).toEqual([]);
  });

  it('names the failing field when the manifest does not validate', () => {
    const root = bundleDir({
      '.devdigest/agents/a.yaml': 'name: A\nsystem_prompt: p\n',
    });
    try {
      readManifest(root, 'a');
      expect.unreachable('expected a ManifestError');
    } catch (err) {
      expect(err).toBeInstanceOf(ManifestError);
      expect((err as ManifestError).field).toBe('model');
    }
  });

  it('rejects a file that is not YAML', () => {
    const root = bundleDir({ '.devdigest/agents/a.yaml': 'name: [unclosed\n' });
    expect(() => readManifest(root, 'a')).toThrow(ManifestError);
  });

  it('reports a missing manifest rather than throwing an fs error', () => {
    const root = bundleDir();
    try {
      readManifest(root, 'absent');
      expect.unreachable('expected a ManifestError');
    } catch (err) {
      expect((err as ManifestError).field).toBe('<file>');
    }
  });

  it('does not let a slug leave the bundle directory', () => {
    const root = bundleDir();
    expect(() => readManifest(root, '../../etc/passwd')).toThrow(/not a usable slug/);
    expect(() => resolveBundlePath(root, 'skills', '..', '.md')).toThrow(/not a usable slug/);
  });

  it('keeps a `__proto__` key in the manifest off Object.prototype', () => {
    const root = bundleDir({
      '.devdigest/agents/a.yaml':
        '__proto__:\n  polluted: yes\nname: A\nmodel: m\nsystem_prompt: p\n',
    });
    const manifest = readManifest(root, 'a');
    expect(manifest.name).toBe('A');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.keys(manifest)).not.toContain('__proto__');
  });
});

describe('readSkillBodies', () => {
  it('resolves slugs to bundle bodies', () => {
    const root = bundleDir({ '.devdigest/skills/secret-leakage.md': '# Secrets\nbody' });
    const read = readSkillBodies(root, ['secret-leakage']);
    expect(read.bodies).toEqual(['# Secrets\nbody']);
    expect(read.notes).toEqual([]);
  });

  it('notes a skill missing from the bundle and reviews without it', () => {
    const root = bundleDir();
    const read = readSkillBodies(root, ['gone']);
    expect(read.bodies).toEqual([]);
    expect(read.notes[0]).toMatch(/"gone" not found/);
  });

  it('refuses a traversing slug and says so with the slug neutralised', () => {
    const root = bundleDir();
    const read = readSkillBodies(root, ['../../etc/passwd']);
    expect(read.bodies).toEqual([]);
    expect(read.notes[0]).toMatch(/not a usable slug/);
  });
});

describe('readMemory', () => {
  it('returns nothing and does not throw when the file is absent', () => {
    expect(readMemory(bundleDir())).toEqual({ items: [], notes: [] });
  });

  it('parses one item per line', () => {
    const root = bundleDir({
      '.devdigest/memory.jsonl': '"prefer const"\n{"note":"no fetch in components"}\n',
    });
    const read = readMemory(root);
    expect(read.items).toEqual(['prefer const', '{"note":"no fetch in components"}']);
    expect(read.notes).toEqual([]);
  });

  it('skips a line that is not JSON, naming its number', () => {
    const root = bundleDir({
      '.devdigest/memory.jsonl': '"one"\nnot json at all\n"three"\n',
    });
    const read = readMemory(root);
    expect(read.items).toEqual(['one', 'three']);
    expect(read.notes).toEqual(['memory.jsonl line 2 is not valid JSON — skipped']);
  });

  it('reads no more than the line ceiling', () => {
    const root = bundleDir({
      '.devdigest/memory.jsonl': Array.from({ length: 150 }, (_, i) => `"item ${i}"`).join('\n'),
    });
    const read = readMemory(root);
    expect(read.items).toHaveLength(MEMORY_MAX_LINES);
    expect(read.notes.join(' ')).toContain(`exceeds ${MEMORY_MAX_LINES} lines`);
  });

  it('reads no more than the byte ceiling, and drops the line the cut landed in', () => {
    const root = bundleDir();
    const line = `"${'x'.repeat(4000)}"`;
    writeFileSync(
      path.join(root, '.devdigest', 'memory.jsonl'),
      Array.from({ length: 40 }, () => line).join('\n'),
      'utf8',
    );
    const read = readMemory(root);
    expect(read.notes.join(' ')).toContain(`exceeds ${MEMORY_MAX_BYTES} bytes`);
    expect(read.items.length).toBeLessThan(40);
    for (const item of read.items) expect(item).toHaveLength(4000);
  });
});
