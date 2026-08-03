import type {
  Skill,
  SkillListItem,
  SkillSkipReason,
  SkillType,
  SkillVersion,
} from '@devdigest/shared';
import type { SkillRow, SkillVersionRow } from '../../db/rows.js';
import { detectInjection } from '../../platform/skill-injection.js';
import {
  CORE_FILENAMES,
  EXECUTABLE_DIRS,
  EXECUTABLE_EXTENSIONS,
  MAX_BODY_CHARS,
  MAX_DESCRIPTION_CHARS,
  MAX_ENTRY_BYTES,
  READ_EXTENSIONS,
} from './constants.js';

/**
 * Pure helpers for the skills module — DB row ⇄ DTO mapping, and the parsing an
 * import needs. No I/O: an archive arrives as bytes and a document as a string,
 * so every rule below is testable without a filesystem, a network or a server.
 */

/**
 * A skill row plus how many agents bind it. Declared here rather than in the
 * repository so the mapper below does not have to import the data layer.
 */
export interface SkillWithUsage {
  skill: SkillRow;
  agentCount: number;
}

/**
 * Map a persisted skill row to the public `Skill` DTO. `type` and `source` are
 * passed through uncast on purpose: the Drizzle column and the Zod enum infer
 * the same union, so letting them drift becomes a compile error here.
 */
export function toSkillDto(row: SkillRow): Skill {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    type: row.type,
    source: row.source,
    body: row.body,
    enabled: row.enabled,
    version: row.version,
    evidence_files: row.evidenceFiles ?? null,
  };
}

/**
 * The shape both the list and the single-skill routes return. `injection` is
 * computed on read rather than stored, so sharpening the detector improves every
 * existing skill without a migration or a backfill.
 */
export function toSkillListItemDto(row: SkillWithUsage): SkillListItem {
  return {
    ...toSkillDto(row.skill),
    agent_count: row.agentCount,
    injection: detectInjection(row.skill.body),
  };
}

export function toSkillVersionDto(row: SkillVersionRow): SkillVersion {
  return {
    skill_id: row.skillId,
    version: row.version,
    body: row.body,
    created_at: row.createdAt.toISOString(),
  };
}

// ---- import parsing -----------------------------------------------------

/** What `classifyEntry` decided about one archive entry. */
export type EntryVerdict = 'read' | SkillSkipReason;

function extensionOf(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot <= 0 ? '' : base.slice(dot).toLowerCase();
}

/**
 * Decide whether one archive entry may be read, or why it may not.
 *
 * `unsafe_path` comes first, and it is not about zip-slip — nothing here is ever
 * written to disk. It is about honesty: the path is shown in the preview and
 * kept in `evidence_files`, so a `../../../etc/passwd` sitting in that list
 * would misdescribe what the archive actually contained.
 *
 * Kind is checked before size, so a 400 KB shell script reads as `executable`
 * rather than `too_large`. Both are skipped either way and only the explanation
 * differs — this way `too_large` is reserved for the case it actually explains,
 * a markdown file that genuinely is too big.
 */
export function classifyEntry(path: string, originalSize: number): EntryVerdict {
  const normalized = path.replaceAll('\\', '/');
  const segments = normalized.split('/');

  const unsafe =
    normalized.includes('\0') ||
    normalized.startsWith('/') ||
    /^[a-zA-Z]:/.test(normalized) ||
    segments.some((s) => s === '..');
  if (unsafe) return 'unsafe_path';

  const ext = extensionOf(normalized);
  if (EXECUTABLE_EXTENSIONS.includes(ext)) return 'executable';
  if (segments.slice(0, -1).some((s) => EXECUTABLE_DIRS.includes(s))) return 'executable';
  if (!READ_EXTENSIONS.includes(ext)) return 'not_markdown';
  if (originalSize > MAX_ENTRY_BYTES) return 'too_large';
  return 'read';
}

/**
 * Which readable entry becomes the body: `SKILL.md`, else `README.md`, else the
 * only markdown file when there is exactly one. Ties break shallowest-first then
 * alphabetically, so a nested pack still resolves to the same file every time.
 */
export function pickSkillCore(paths: string[]): string | undefined {
  const depth = (p: string) => p.split('/').length;
  const shallowestFirst = (a: string, b: string) => depth(a) - depth(b) || a.localeCompare(b);

  for (const target of CORE_FILENAMES) {
    const matches = paths.filter((p) => p.slice(p.lastIndexOf('/') + 1).toLowerCase() === target);
    if (matches.length > 0) return [...matches].sort(shallowestFirst)[0];
  }
  return paths.length === 1 ? paths[0] : undefined;
}

export interface Frontmatter {
  attrs: Record<string, string>;
  body: string;
}

/**
 * Read a leading `---` block as FLAT `key: value` scalars.
 *
 * Deliberately NOT YAML. Nested maps, lists, anchors, multi-line scalars and
 * type coercion are all ignored, and an indented line is skipped precisely
 * because that is where nesting would live. A Claude-style SKILL.md carries
 * exactly `name:` and `description:`, which is the entire surface we consume —
 * a YAML parser would be many times this code and a new attack surface for a
 * format nothing else in the repo reads.
 */
export function parseFrontmatter(text: string): Frontmatter {
  const clean = text.replace(/^\uFEFF/, '');
  const lines = clean.split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return { attrs: {}, body: clean };

  const close = lines.findIndex((line, i) => i > 0 && line.trim() === '---');
  if (close === -1) return { attrs: {}, body: clean };

  const attrs: Record<string, string> = {};
  for (const line of lines.slice(1, close)) {
    if (line.trim() === '' || /^\s/.test(line)) continue;
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    attrs[line.slice(0, colon).trim()] = line
      .slice(colon + 1)
      .trim()
      .replace(/^(['"])(.*)\1$/, '$2');
  }
  return { attrs, body: lines.slice(close + 1).join('\n').replace(/^\n+/, '') };
}

export interface SkillDraft {
  name: string;
  description: string;
  type: SkillType;
  body: string;
  warnings: string[];
}

function titleFromFilename(filename: string): string {
  const base = filename.slice(filename.lastIndexOf('/') + 1);
  const spaced = base.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim();
  if (spaced === '') return 'Untitled skill';
  return spaced.replace(/\b\w/g, (c) => c.toUpperCase());
}

function firstHeading(body: string): string | undefined {
  for (const line of body.split(/\r?\n/)) {
    const match = /^\s{0,3}#{1,6}\s+(.*\S)\s*$/.exec(line);
    if (match) return match[1];
  }
  return undefined;
}

function firstParagraph(body: string): string | undefined {
  for (const block of body.split(/\n\s*\n/)) {
    const text = block.trim();
    if (text === '' || text.startsWith('#') || text.startsWith('---')) continue;
    return text.replace(/\s+/g, ' ');
  }
  return undefined;
}

/**
 * Turn one markdown document into an unsaved draft.
 *
 * `type` is always `custom`. Guessing it from keywords would be wrong often
 * enough to be worse than the user choosing it in the preview — which they have
 * to read anyway, because that body is about to become instructions.
 */
export function draftFromMarkdown(text: string, filename: string): SkillDraft {
  const { attrs, body: stripped } = parseFrontmatter(text);
  const warnings: string[] = [];

  const body = stripped.slice(0, MAX_BODY_CHARS);
  if (body.length < stripped.length) {
    warnings.push(`Body truncated to ${MAX_BODY_CHARS} characters.`);
  }

  const wanted = attrs.description?.trim() || firstParagraph(body) || '';
  const description = wanted.slice(0, MAX_DESCRIPTION_CHARS);
  if (description.length < wanted.length) {
    warnings.push(`Description truncated to ${MAX_DESCRIPTION_CHARS} characters.`);
  }

  return {
    name: attrs.name?.trim() || firstHeading(body) || titleFromFilename(filename),
    description,
    type: 'custom',
    body,
    warnings,
  };
}
