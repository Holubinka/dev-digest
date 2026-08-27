import { closeSync, openSync, readFileSync, readSync, statSync } from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { AgentManifest } from '@devdigest/shared';

/** Where the generated bundle lives inside the target repository's checkout. */
export const BUNDLE_DIR = '.devdigest';

/** `.devdigest/memory.jsonl` ceilings (SPEC-05 § Non-functional requirements). */
export const MEMORY_MAX_BYTES = 64 * 1024;
export const MEMORY_MAX_LINES = 100;

/** A manifest above this is not a manifest; refusing early bounds what is held. */
export const MANIFEST_MAX_BYTES = 256 * 1024;

/** One skill body above this many bytes is truncated rather than refused. */
export const SKILL_MAX_BYTES = 20000;

export class ManifestError extends Error {
  constructor(
    readonly field: string,
    message: string,
  ) {
    super(message);
    this.name = 'ManifestError';
  }
}

const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * Resolve `<root>/.devdigest/<kind>/<slug><ext>`, refusing a slug that is not
 * a single path segment.
 *
 * The slug reaches us from the job env and from the manifest's `skills` list —
 * both live in a repository whose branch the PR author can write, so `../..`
 * has to be refused here rather than trusted upstream.
 */
export function resolveBundlePath(root: string, kind: string, slug: string, ext: string): string {
  if (!SLUG_RE.test(slug) || slug.includes('..')) {
    throw new ManifestError('<slug>', `not a usable slug: "${safeLabel(slug)}"`);
  }
  return path.join(root, BUNDLE_DIR, kind, `${slug}${ext}`);
}

/**
 * Read at most `maxBytes` from `file`, without ever holding more than that.
 *
 * `readFileSync` then `slice` would already have paid for the whole file, which
 * is the mistake `parseSkillArchive` avoids on the server side by budgeting
 * before it inflates.
 */
export function readCapped(file: string, maxBytes: number): { text: string; truncated: boolean } {
  const size = statSync(file).size;
  if (size <= maxBytes) return { text: readFileSync(file, 'utf8'), truncated: false };
  const fd = openSync(file, 'r');
  try {
    const buf = Buffer.alloc(maxBytes);
    const read = readSync(fd, buf, 0, maxBytes, 0);
    return { text: buf.subarray(0, read).toString('utf8'), truncated: true };
  } finally {
    closeSync(fd);
  }
}

/**
 * Read and validate `.devdigest/agents/<slug>.yaml`.
 *
 * Throws `ManifestError` naming the failing field — the runner prints it and
 * exits non-zero without calling a model (AC-58).
 */
export function readManifest(root: string, slug: string): AgentManifest {
  const file = resolveBundlePath(root, 'agents', slug, '.yaml');
  let text: string;
  try {
    text = readCapped(file, MANIFEST_MAX_BYTES).text;
  } catch (err) {
    throw new ManifestError('<file>', `cannot read ${path.relative(root, file)}: ${asMessage(err)}`);
  }

  let doc: unknown;
  try {
    // `maxAliasCount` is yaml@2's own guard against exponential alias expansion
    // (default 100); it is named here because the file is repository content in
    // someone else's tree, not ours.
    doc = parseYaml(text, { maxAliasCount: 100 });
  } catch (err) {
    throw new ManifestError('<yaml>', `not valid YAML: ${asMessage(err)}`);
  }

  const parsed = AgentManifest.safeParse(doc);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = issue && issue.path.length > 0 ? issue.path.join('.') : '<root>';
    throw new ManifestError(field, issue ? issue.message : 'does not match AgentManifest');
  }
  return parsed.data;
}

export interface SkillsRead {
  bodies: string[];
  notes: string[];
}

/** Resolve manifest skill slugs to `.devdigest/skills/<slug>.md` bodies. */
export function readSkillBodies(root: string, slugs: string[]): SkillsRead {
  const bodies: string[] = [];
  const notes: string[] = [];
  for (const slug of slugs) {
    let file: string;
    try {
      file = resolveBundlePath(root, 'skills', slug, '.md');
    } catch {
      notes.push(`skill skipped — "${safeLabel(slug)}" is not a usable slug`);
      continue;
    }
    try {
      const { text, truncated } = readCapped(file, SKILL_MAX_BYTES);
      bodies.push(text);
      if (truncated) notes.push(`skill "${slug}" truncated to ${SKILL_MAX_BYTES} bytes`);
    } catch {
      notes.push(`skill "${slug}" not found in the bundle — reviewing without it`);
    }
  }
  return { bodies, notes };
}

export interface MemoryRead {
  items: string[];
  notes: string[];
}

/**
 * Read `.devdigest/memory.jsonl` within its ceilings.
 *
 * Four branches, all of them reachable: absent file → no memory and no error
 * (AC-100); a line that is not JSON → skipped, its number named (AC-99); the
 * file over 64 KiB or 100 lines → the excess is not read (AC-97); otherwise the
 * parsed items. Wrapping them as untrusted text is `review.ts`'s job, not this
 * one's — this returns the raw items.
 */
export function readMemory(root: string): MemoryRead {
  const file = path.join(root, BUNDLE_DIR, 'memory.jsonl');
  let text: string;
  let truncated: boolean;
  try {
    ({ text, truncated } = readCapped(file, MEMORY_MAX_BYTES));
  } catch {
    return { items: [], notes: [] };
  }

  const notes: string[] = [];
  let lines = text.split('\n');
  if (truncated) {
    // The byte cut lands mid-line; that tail is not a line anyone wrote.
    lines.pop();
    notes.push(`memory.jsonl exceeds ${MEMORY_MAX_BYTES} bytes — the rest was not read`);
  }
  if (lines.length > MEMORY_MAX_LINES) {
    lines = lines.slice(0, MEMORY_MAX_LINES);
    notes.push(`memory.jsonl exceeds ${MEMORY_MAX_LINES} lines — the rest was not read`);
  }

  const items: string[] = [];
  lines.forEach((line, i) => {
    if (line.trim().length === 0) return;
    try {
      const value: unknown = JSON.parse(line);
      items.push(typeof value === 'string' ? value : JSON.stringify(value));
    } catch {
      notes.push(`memory.jsonl line ${i + 1} is not valid JSON — skipped`);
    }
  });
  return { items, notes };
}

/**
 * A foreign string reduced to something safe to print — the characters a slug
 * may legally hold, and nothing else.
 */
export function safeLabel(text: string): string {
  return [...text.replace(/[^A-Za-z0-9._/-]/g, '?')].slice(0, 60).join('');
}

function asMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
