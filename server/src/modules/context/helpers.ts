import { createHash } from 'node:crypto';
import type { ContextDocKind, ContextDocStatus, SpecFile } from '@devdigest/shared';
import { ContextDocKind as ContextDocKindEnum } from '@devdigest/shared';
import type {
  BoundSkillDocs,
  ContextAttachment,
  ContextDocRecord,
  ProjectContextDocResult,
} from './types.js';
import { DEVDIGEST_ROOT, MAX_PATH_LENGTH } from './constants.js';
import { sanitizeRelativePath, truncateCodePoints } from '../_shared/repo-paths.js';
import {
  selectWithinBudget,
  truncateToBudget,
  type BudgetCandidate as SharedBudgetCandidate,
  type BudgetSelection as SharedBudgetSelection,
} from '../_shared/budget.js';

/* Re-exported so the rest of this slice keeps importing from its own helpers:
   where the rule lives is `_shared/`'s business, not every call site's. */
export { truncateCodePoints };

/**
 * context — pure transforms. Nothing here calls anything, so the budget walk and
 * the path gate below are unit-testable with no filesystem and no database.
 */

/**
 * The path gate between a saved attachment and `GitClient.readFile`.
 *
 * The string rules live in `_shared/repo-paths.ts`, shared with `modules/intent`,
 * which needs the same gate for a path parsed out of a PR body. They were a
 * duplicate here until 2026-08-15 and had already drifted; `no-cross-module`
 * forbids the two slices importing each other, and the rule names `_shared/` as
 * the remedy. What stays local is the extension rule, which is not shared.
 *
 * Returns the normalised repo-relative path, or `null` when the input is not
 * one. `path.resolve` is deliberately NOT used: it would tie the answer to the
 * process CWD and stop this function being pure. The invariant the caller relies
 * on — "no `..` segment survives" — is decidable on the string alone. The
 * filesystem half of the defence (a symlink whose NAME ends in `.md` and whose
 * TARGET is `/etc/passwd`) is not decidable here at all, and lives in the git
 * adapter where the resolution happens.
 */
export function sanitizeDocPath(raw: string): string | null {
  const path = sanitizeRelativePath(raw, MAX_PATH_LENGTH);
  if (path === null) return null;
  // One extension, one parser, one attack surface.
  if (!path.toLowerCase().endsWith('.md')) return null;
  return path;
}

/**
 * The same gate for a path that names a FOLDER rather than a document.
 *
 * Everything `sanitizeDocPath` refuses is refused here — the two share one
 * implementation below, so a rule cannot be added to one and forgotten in the
 * other — and the `.md` rule is inverted rather than dropped. A directory named
 * `notes.md` would be walked by nothing, readable as no document, and
 * indistinguishable from one in any list that shows a path; refusing it outright
 * is cheaper than explaining it afterwards.
 */
export function sanitizeFolderPath(raw: string): string | null {
  const path = sanitizeRelativePath(raw, MAX_PATH_LENGTH);
  if (path === null) return null;
  if (path.toLowerCase().endsWith('.md')) return null;
  return path;
}

/**
 * One configured scan root, in the ONE form everything downstream compares
 * against. Returns null for a root that is not usable.
 *
 * Normalising once, here, is the whole point: `listFiles` resolves a root
 * through `path.join`, which normalises, while `rootFor` matches the walked path
 * against the CONFIGURED string. A root written `docs/` or `./docs` therefore
 * used to walk the right directory, yield `docs/a.md`, and then match nothing —
 * a successful scan with zero documents and no error anywhere.
 *
 * `.` and `` are dropped rather than kept: both resolve to the clone directory
 * itself and would walk the entire repository, and neither can ever label a
 * document afterwards.
 */
export function normalizeRoot(raw: string): string | null {
  const segments = raw
    .replaceAll('\\', '/')
    .split('/')
    .filter((segment) => segment !== '' && segment !== '.');
  if (segments.length === 0) return null;
  // A root that climbs out of the clone is refused outright, not clamped: there
  // is no reading of `../../etc` that this feature is supposed to serve.
  if (segments.includes('..')) return null;
  return segments.join('/');
}

/**
 * Which configured root a path belongs to — the LONGEST match, so a workspace
 * configuring both `docs` and `docs/adr` puts a document under the more specific
 * of the two and therefore in exactly ONE group.
 *
 * Lives here rather than in `scan-executor.ts`, where it started, because the
 * scan and the write path must give the same answer: the scan uses it to label a
 * row, the write path uses it to decide whether a save is inside a scanned root
 * at all, and a second implementation of "which root is this under" is how the
 * page's grouping and the server's zone check start to disagree.
 */
export function rootFor(path: string, roots: string[]): string | undefined {
  let best: string | undefined;
  for (const root of roots) {
    if (path === root || path.startsWith(`${root}/`)) {
      if (best === undefined || root.length > best.length) best = root;
    }
  }
  return best;
}

/** What a write is: a document under `.devdigest/`, a folder there, or a save. */
export type WriteMode = 'create' | 'folder' | 'save';

/** Why a write was refused before it reached the port. All of them are 400s. */
export type WriteZoneRefusal = 'outside_devdigest' | 'outside_roots';

/**
 * The zone rule, decided on the sanitised path alone. `null` means allowed.
 *
 * Two different rules, because they answer two different questions.
 *
 *   - `create` and `folder` may only ever land under `.devdigest/`. That is not
 *     tidiness: `.devdigest/` is untracked, so what is written there survives a
 *     `git reset --hard` and belongs to nobody's branch. Writing a NEW file
 *     anywhere else would create something the next resync deletes without ever
 *     having warned anyone, since there is no prior version to warn about.
 *   - `save` may touch any scanned root, because editing a document the
 *     repository already carries is the requirement (`AC-60`). The warning that
 *     a tracked edit is erased by the next resync is the editor's job, before
 *     the request; refusing the save here would refuse the feature.
 *
 * Strictly BELOW the root in both cases — `.devdigest` names the folder itself,
 * which is neither a document nor a folder anyone needs to create.
 */
export function writeZone(
  path: string,
  roots: string[],
  mode: WriteMode,
): WriteZoneRefusal | null {
  if (mode === 'save') {
    return rootFor(path, roots) === undefined ? 'outside_roots' : null;
  }
  return path.startsWith(`${DEVDIGEST_ROOT}/`) ? null : 'outside_devdigest';
}

/**
 * The text as saved, as a sha256 hex digest.
 *
 * A hash and not the text: this feature stores no document body anywhere but the
 * clone (`repo_docs` says so in the schema), and the only question the record has
 * to answer is "is what is on disk still what we wrote". `node:crypto` hashing is
 * side-effect free, which is what keeps this file in the pure ring —
 * `modules/reviews/prompt-log.ts` is the precedent.
 */
export function contentHash(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * The document's kind, from the root it was found under — except under
 * `.devdigest`, where the root is a container rather than a label and the
 * segment BELOW it decides.
 *
 * `other` is a REQUIREMENT, not a fallback: a workspace may configure a root
 * called `handbook`, and calling that document `docs` would be a label nobody
 * chose. The first segment is what decides, so `docs/adr` is still `docs`.
 *
 * `.devdigest` is the one root that names no family at all. It exists because
 * DevDigest has to write somewhere untracked (`AC-61`), not because anybody
 * chose it as a category, and every document written through this feature lives
 * under it. Deriving from the first segment there labelled ALL of them `other`
 * while the list row beside the badge read `specs/public-api.md` — the row and
 * the badge disagreeing about the same document, which is the contradiction
 * this increment exists to remove. So one level down is where the label is:
 *
 *   `.devdigest/specs/public-api.md` → `specs`     (the row reads `specs/public-api.md`)
 *   `.devdigest/docs/x.md`           → `docs`
 *   `.devdigest/insights/x.md`       → `insights`
 *   `.devdigest/adr/x.md`            → `other`     (a folder naming no family)
 *   `.devdigest/x.md`                → `other`     (no folder at all)
 *
 * `path` is optional because a caller holding only a root — every test of the
 * plain rule, and any future caller labelling a root rather than a document —
 * still gets the honest answer for it, which for `.devdigest` alone is `other`.
 */
export function kindForRoot(root: string, path?: string): ContextDocKind {
  const rootSegments = segmentsOf(root);
  if (rootSegments[0] === DEVDIGEST_ROOT && path !== undefined) {
    const below = segmentsOf(path).slice(rootSegments.length);
    // At least two: the first is only a FOLDER when something follows it.
    // `.devdigest/specs.md` is a document called `specs`, not a specs document.
    return below.length >= 2 ? namedKind(below[0]) : 'other';
  }
  return namedKind(rootSegments[0]);
}

/** A path or a root, split the one way everything here compares them. */
function segmentsOf(raw: string): string[] {
  return raw
    .replaceAll('\\', '/')
    .split('/')
    .filter((segment) => segment !== '' && segment !== '.');
}

/**
 * One segment → the kind it names, or `other`.
 *
 * `other` is excluded from the match on purpose: it is the answer for a segment
 * that names nothing, so a folder literally called `other` reaches it anyway and
 * a folder called `Other` must not take a different route to a different answer.
 */
function namedKind(segment: string | undefined): ContextDocKind {
  const name = segment?.toLowerCase() ?? '';
  return (ContextDocKindEnum.options as readonly string[]).includes(name) && name !== 'other'
    ? (name as ContextDocKind)
    : 'other';
}

/**
 * One document as it appears inside its `<untrusted>` wrapper.
 *
 * ONE function, TWO callers: the scanner counts tokens over its output, and the
 * run resolver builds the prompt blocks from it. That is the whole reason the
 * editor's number and the run's number agree for an unchanged clone — a second
 * rendering, however similar, would make them agree only approximately.
 *
 * The path is inside the wrapped content and never in `wrapUntrusted`'s label:
 * the label lands in `source="…"` unescaped, so a path containing a quote would
 * break out of the attribute.
 */
export function renderDoc(path: string, text: string): string {
  return `### ${path}\n\n${text}`;
}

/** Where one document of the effective set came from. */
export type EffectiveSource =
  | { kind: 'own' }
  | { kind: 'skill'; skillId: string; skillName: string };

export interface EffectiveDoc {
  path: string;
  source: EffectiveSource;
}

/**
 * The agent's effective set: its own documents in saved order, then each enabled
 * bound skill's documents in binding order, de-duplicated by path with the FIRST
 * occurrence winning.
 *
 * "First wins" is what makes an own attachment beat an inherited one and what
 * makes the same document count once in the token total, however many skills
 * also carry it.
 */
export function effectiveSet(own: ContextAttachment[], bySkill: BoundSkillDocs[]): EffectiveDoc[] {
  const out: EffectiveDoc[] = [];
  const seen = new Set<string>();
  const push = (path: string, source: EffectiveSource) => {
    if (seen.has(path)) return;
    seen.add(path);
    out.push({ path, source });
  };

  for (const attachment of [...own].sort((a, b) => a.position - b.position)) {
    push(attachment.path, { kind: 'own' });
  }
  for (const skill of [...bySkill].sort((a, b) => a.order - b.order)) {
    for (const attachment of [...skill.paths].sort((a, b) => a.position - b.position)) {
      push(attachment.path, {
        kind: 'skill',
        skillId: skill.skillId,
        skillName: skill.skillName,
      });
    }
  }
  return out;
}

/**
 * The budget walk moved to `_shared/budget.ts` on 2026-08-16, when
 * `modules/brief` needed the same one for its elastic spec inputs and
 * `no-cross-module` forbade it importing this file. The names are re-exported so
 * the rest of this slice keeps importing from its own helpers — where the rule
 * lives is `_shared/`'s business, not every call site's, exactly as
 * `truncateCodePoints` above.
 *
 * `ContextDocStatus`'s three failure members are what this slice binds the type
 * parameter to, so `BudgetSelection.results` is still `ProjectContextDocResult[]`
 * structurally and no caller here changed.
 */
export type ContextBudgetFailure = Extract<ContextDocStatus, 'missing' | 'refused' | 'binary'>;
export type BudgetCandidate = SharedBudgetCandidate<ContextBudgetFailure>;
export type BudgetSelection = SharedBudgetSelection<ContextBudgetFailure>;
export { selectWithinBudget, truncateToBudget };

/**
 * Row record → the wire DTO. A `*Row` never leaves this module.
 *
 * `local` and `stale` are always present on the wire even though the contract
 * makes them optional. Optional is there so a fixture written before documents
 * could be authored still parses; a response that simply omitted them would make
 * "false" and "this server is too old to know" the same value on the client.
 */
export function toDocDto(record: ContextDocRecord): SpecFile {
  return {
    path: record.path,
    // The list never carries text; the single-document read populates it.
    content: null,
    size: record.sizeBytes,
    updated_at: record.modifiedAt?.toISOString() ?? null,
    root: record.root,
    kind: record.kind,
    tokens: record.tokens,
    used_by_agents: record.usedByAgents,
    local: record.local,
    stale: record.stale,
  };
}

/**
 * De-duplicate a submitted set, keeping the FIRST occurrence's position.
 *
 * A repeated path saves one entry, where it first appeared — not where it last
 * appeared, and not twice. Order is the feature here, so "which one survives" is
 * a behaviour rather than an implementation detail.
 */
export function dedupePaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const path of paths) {
    if (seen.has(path)) continue;
    seen.add(path);
    out.push(path);
  }
  return out;
}
