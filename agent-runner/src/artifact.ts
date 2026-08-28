import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { CiResultArtifact } from '@devdigest/shared';

/** The one file the workflow uploads as the `devdigest-result` artifact (AC-54). */
export const ARTIFACT_FILE = 'devdigest-result.json';

/** A secret value shorter than this is not a secret; matching it would match everything. */
const MIN_LITERAL_LENGTH = 12;

/**
 * High-signal credential shapes, from `.claude/skills/security` § Secret
 * Detection plus the two providers this runner actually holds.
 *
 * Deliberately narrow. The artifact carries counts and runner-authored strings,
 * so this is the second line: the first is that `CiResultArtifact.parse` builds
 * the record from the schema's fields, which is why no prompt text and no diff
 * can be in it to begin with (AC-63).
 */
const SECRET_PATTERNS: { name: string; re: RegExp }[] = [
  { name: 'openrouter key', re: /sk-or-v1-[A-Za-z0-9]{16,}/ },
  { name: 'openai key', re: /sk-[A-Za-z0-9_-]{32,}/ },
  { name: 'github token', re: /gh[pousr]_[A-Za-z0-9]{20,}/ },
  { name: 'github pat', re: /github_pat_[A-Za-z0-9_]{20,}/ },
  { name: 'aws access key', re: /AKIA[0-9A-Z]{16}/ },
  { name: 'google api key', re: /AIza[0-9A-Za-z_-]{35}/ },
  { name: 'npm token', re: /npm_[A-Za-z0-9]{36}/ },
  { name: 'slack token', re: /xox[bpsa]-[0-9a-zA-Z-]{10,}/ },
  { name: 'private key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
];

/** Raised instead of writing an artifact that carries a credential. */
export class ArtifactSecretError extends Error {
  constructor(readonly detector: string) {
    super(`refusing to write ${ARTIFACT_FILE}: it contains a ${detector}`);
    this.name = 'ArtifactSecretError';
  }
}

/**
 * Name the first credential found in `text`, or null.
 *
 * `literals` are the values this process actually holds — the OpenRouter key
 * and the job's `GITHUB_TOKEN`. They are checked by equality, not by shape, so
 * a key in a form no pattern anticipates is still caught.
 */
export function scanForSecrets(text: string, literals: readonly string[]): string | null {
  for (const literal of literals) {
    const value = literal.trim();
    if (value.length >= MIN_LITERAL_LENGTH && text.includes(value)) return 'known secret value';
  }
  for (const { name, re } of SECRET_PATTERNS) {
    if (re.test(text)) return name;
  }
  return null;
}

/**
 * Validate, scan and write `devdigest-result.json`.
 *
 * The parse comes first and does two jobs: it is AC-62's validation, and it is
 * what strips every key the schema does not name — so a caller that put a
 * prompt or a diff on the object cannot write one. The scan then refuses the
 * file outright rather than redacting it: a truncated credential is still a
 * credential, and a file that was never written is the only honest failure.
 */
export function writeArtifact(
  dir: string,
  artifact: unknown,
  literals: readonly string[] = [],
): { file: string; artifact: CiResultArtifact } {
  const parsed = CiResultArtifact.parse(artifact);
  const serialised = `${JSON.stringify(parsed, null, 2)}\n`;
  const found = scanForSecrets(serialised, literals);
  if (found) throw new ArtifactSecretError(found);
  const file = path.join(dir, ARTIFACT_FILE);
  writeFileSync(file, serialised, 'utf8');
  return { file, artifact: parsed };
}
