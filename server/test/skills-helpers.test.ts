import { describe, it, expect } from 'vitest';
import {
  classifyEntry,
  draftFromMarkdown,
  parseFrontmatter,
  pickSkillCore,
  toSkillDto,
  toSkillListItemDto,
  toSkillVersionDto,
} from '../src/modules/skills/helpers.js';
import { MAX_BODY_CHARS, MAX_ENTRY_BYTES } from '../src/modules/skills/constants.js';
import type { SkillRow, SkillVersionRow } from '../src/db/rows.js';

const ROW: SkillRow = {
  id: 'sk-1',
  workspaceId: 'ws-1',
  name: 'Uncovered branch rubric',
  description: 'List every branch the diff adds and name the test covering it.',
  type: 'rubric',
  source: 'manual',
  body: '# Rubric\nList every branch…',
  enabled: true,
  version: 3,
  evidenceFiles: null,
  createdAt: new Date('2026-08-03T10:00:00.000Z'),
};

describe('toSkillDto', () => {
  it('maps the camelCase row onto the snake_case wire shape', () => {
    expect(toSkillDto({ ...ROW, evidenceFiles: ['docs/a.md'] })).toEqual({
      id: 'sk-1',
      name: 'Uncovered branch rubric',
      description: 'List every branch the diff adds and name the test covering it.',
      type: 'rubric',
      source: 'manual',
      body: '# Rubric\nList every branch…',
      enabled: true,
      version: 3,
      evidence_files: ['docs/a.md'],
    });
  });

  it('reports absent evidence as null rather than dropping the key', () => {
    expect(toSkillDto(ROW).evidence_files).toBeNull();
  });

  it('does not leak the workspace id to the client', () => {
    expect(toSkillDto(ROW)).not.toHaveProperty('workspaceId');
  });
});

describe('toSkillListItemDto', () => {
  it('carries the binding count alongside the skill', () => {
    expect(toSkillListItemDto({ skill: ROW, agentCount: 2 })).toMatchObject({
      id: 'sk-1',
      agents: 2,
    });
  });

  it('keeps a skill nobody has bound at zero', () => {
    expect(toSkillListItemDto({ skill: ROW, agentCount: 0 }).agents).toBe(0);
  });
});

describe('toSkillVersionDto', () => {
  it('serialises the snapshot with an ISO timestamp', () => {
    const row: SkillVersionRow = {
      skillId: 'sk-1',
      version: 2,
      body: '# Rubric v2',
      createdAt: new Date('2026-08-03T10:00:00.000Z'),
    };
    expect(toSkillVersionDto(row)).toEqual({
      skill_id: 'sk-1',
      version: 2,
      body: '# Rubric v2',
      created_at: '2026-08-03T10:00:00.000Z',
    });
  });
});

describe('classifyEntry', () => {
  it('reads markdown', () => {
    expect(classifyEntry('SKILL.md', 100)).toBe('read');
    expect(classifyEntry('docs/notes.markdown', 100)).toBe('read');
  });

  it.each([
    '../escape.md',
    'pack/../../escape.md',
    '/absolute.md',
    'C:/windows.md',
    'back\\..\\slash.md',
  ])('refuses %j as an unsafe path', (path) => {
    expect(classifyEntry(path, 10)).toBe('unsafe_path');
  });

  it.each(['run.sh', 'lint.py', 'tool.ps1', 'app.mjs', 'blob.wasm'])(
    'labels %j executable by extension',
    (path) => {
      expect(classifyEntry(path, 10)).toBe('executable');
    },
  );

  it.each(['scripts/check.md', 'bin/thing.md', '.git/config.md', 'node_modules/a/b.md'])(
    'labels %j executable by the directory it sits in',
    (path) => {
      expect(classifyEntry(path, 10)).toBe('executable');
    },
  );

  it('labels anything else not_markdown, including files with no extension', () => {
    expect(classifyEntry('logo.png', 10)).toBe('not_markdown');
    expect(classifyEntry('Makefile', 10)).toBe('not_markdown');
    expect(classifyEntry('.gitignore', 10)).toBe('not_markdown');
  });

  it('reserves too_large for markdown that really is too big', () => {
    expect(classifyEntry('huge.md', MAX_ENTRY_BYTES + 1)).toBe('too_large');
    // A big script is still reported as what it is, not as a size problem.
    expect(classifyEntry('huge.sh', MAX_ENTRY_BYTES + 1)).toBe('executable');
  });
});

describe('pickSkillCore', () => {
  it('prefers SKILL.md over README.md, whatever the case', () => {
    expect(pickSkillCore(['README.md', 'skill.md'])).toBe('skill.md');
  });

  it('prefers the shallowest match, then alphabetical order', () => {
    expect(pickSkillCore(['deep/nested/SKILL.md', 'pack/SKILL.md'])).toBe('pack/SKILL.md');
    expect(pickSkillCore(['b/SKILL.md', 'a/SKILL.md'])).toBe('a/SKILL.md');
  });

  it('falls back to README.md, then to the only markdown there is', () => {
    expect(pickSkillCore(['docs/README.md', 'other.md'])).toBe('docs/README.md');
    expect(pickSkillCore(['lonely.md'])).toBe('lonely.md');
  });

  it('gives up when several files compete and none is a known core name', () => {
    expect(pickSkillCore(['a.md', 'b.md'])).toBeUndefined();
    expect(pickSkillCore([])).toBeUndefined();
  });
});

describe('parseFrontmatter', () => {
  it('reads flat scalars and strips the block from the body', () => {
    const { attrs, body } = parseFrontmatter('---\nname: Flakiness\ndesc: "quoted"\n---\n# Body');
    expect(attrs).toEqual({ name: 'Flakiness', desc: 'quoted' });
    expect(body).toBe('# Body');
  });

  it('handles CRLF and a leading byte-order mark', () => {
    const { attrs, body } = parseFrontmatter('\uFEFF---\r\nname: X\r\n---\r\nBody');
    expect(attrs).toEqual({ name: 'X' });
    expect(body).toBe('Body');
  });

  it('skips an indented line — that is where nesting would be — and any line with no colon', () => {
    const { attrs } = parseFrontmatter('---\nname: X\n  nested: y\njust-a-line\n---\nB');
    expect(attrs).toEqual({ name: 'X' });
  });

  it('treats a document with no frontmatter, or an unclosed one, as all body', () => {
    expect(parseFrontmatter('# Just markdown')).toEqual({ attrs: {}, body: '# Just markdown' });
    const unclosed = parseFrontmatter('---\nname: X\nstill going');
    expect(unclosed.attrs).toEqual({});
    expect(unclosed.body).toContain('still going');
  });
});

describe('draftFromMarkdown', () => {
  it('prefers frontmatter for the name and description', () => {
    const draft = draftFromMarkdown(
      '---\nname: Flakiness patterns\ndescription: Flag real clocks in tests.\n---\n# Other\nText.',
      'whatever.md',
    );
    expect(draft).toMatchObject({
      name: 'Flakiness patterns',
      description: 'Flag real clocks in tests.',
      type: 'custom',
    });
  });

  it('falls back to the first heading, then to the filename', () => {
    expect(draftFromMarkdown('# From heading\nText.', 'x.md').name).toBe('From heading');
    expect(draftFromMarkdown('Just text.', 'my_skill-name.md').name).toBe('My Skill Name');
  });

  it('takes the description from the first real paragraph, not a heading', () => {
    const draft = draftFromMarkdown('# Title\n\nThe first real\nparagraph.\n\nMore.', 'x.md');
    expect(draft.description).toBe('The first real paragraph.');
  });

  it('leaves the description empty when there is nothing but a heading', () => {
    expect(draftFromMarkdown('# Only a title', 'x.md').description).toBe('');
  });

  it('truncates an oversized body and says so', () => {
    const draft = draftFromMarkdown('#\n' + 'x'.repeat(MAX_BODY_CHARS * 2), 'x.md');
    expect(draft.body).toHaveLength(MAX_BODY_CHARS);
    expect(draft.warnings).toContainEqual(expect.stringContaining('Body truncated'));
  });
});
