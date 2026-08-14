import { z } from 'zod';
import { ContextScanState, SpecFile } from './platform.js';

/**
 * Project Context — the composite shapes.
 *
 * The enums and `SpecFile` itself live in `./platform.js` so that file never has
 * to import this one; the dependency runs one way only, because a cycle between
 * two contract files is a `no-circular` error rather than a style problem.
 */

/**
 * The Project Context page in one document: the scan's own state and output,
 * plus the documents it found.
 *
 * `documents` carries `SpecFile` with `content` left null — the single-document
 * read returns the same shape with `content` populated, so there is one document
 * shape and not two.
 */
export const ContextDocsPage = z.object({
  state: ContextScanState,
  /** The workspace's configured scan roots, echoed so an empty state can name them. */
  roots: z.array(z.string()),
  budget_tokens: z.number().int(),
  file_count: z.number().int(),
  /** The scan hit its candidate cap and the list is a prefix of what is on disk. */
  bounded: z.boolean(),
  scanned_at: z.string().nullable(),
  /**
   * The LAST FAILED attempt, kept beside the last success rather than over it: a
   * failed rescan must leave the previous result readable.
   */
  last_error: z.string().nullable(),
  last_error_at: z.string().nullable(),
  documents: z.array(SpecFile),
});
export type ContextDocsPage = z.infer<typeof ContextDocsPage>;

/**
 * One document attached to an agent or a skill, in saved order.
 *
 * `tokens` is nullable because a saved path need not be in the current scan —
 * attachments show saved paths without sizes or tokens while a clone is in
 * flight. `missing` states that same fact positively.
 */
export const AttachedContextDoc = z.object({
  path: z.string(),
  position: z.number().int(),
  tokens: z.number().int().nullable(),
  missing: z.boolean(),
});
export type AttachedContextDoc = z.infer<typeof AttachedContextDoc>;

/** A document the agent reaches through one of its enabled bound skills. */
export const InheritedContextDoc = z.object({
  path: z.string(),
  tokens: z.number().int().nullable(),
  skill_id: z.string(),
  skill_name: z.string(),
  /** The agent attaches this path itself too: its own attachment wins and it counts once. */
  also_attached: z.boolean(),
});
export type InheritedContextDoc = z.infer<typeof InheritedContextDoc>;

export const AgentContextDocs = z.object({
  repo_id: z.string(),
  attached: z.array(AttachedContextDoc),
  inherited: z.array(InheritedContextDoc),
});
export type AgentContextDocs = z.infer<typeof AgentContextDocs>;

export const SkillContextDocs = z.object({
  repo_id: z.string(),
  attached: z.array(AttachedContextDoc),
});
export type SkillContextDocs = z.infer<typeof SkillContextDocs>;

/**
 * Replace the whole ordered set. Set semantics, so attaching, detaching and
 * reordering are all this one request.
 *
 * `.max(50)` REJECTS an oversized body rather than truncating it silently: a
 * request that saves a different set from the one it sent is worse than a 400.
 */
export const SetContextDocsBody = z.object({
  repo_id: z.string().uuid(),
  paths: z.array(z.string()).max(50),
});
export type SetContextDocsBody = z.infer<typeof SetContextDocsBody>;

/**
 * Code points one document may hold — the number every write is REFUSED on.
 *
 * In the contract rather than in `modules/context/constants.ts` because both
 * sides of the wire have to refuse on the same number. The server answers
 * `400 too_large` above it; the editor has to disable itself BEFORE the attempt,
 * since an Edit that can only ever end in a 400 is a worse answer than a
 * disabled one that explains itself. The server re-exports this from its own
 * constants file, so that file still reads as the one list of this feature's
 * caps.
 *
 * CODE POINTS, never UTF-16 units — `[...text].length`, not `text.length`
 * (`server/INSIGHTS.md`). The byte cap beside it on the server is this × 4,
 * UTF-8's maximum per code point, so it can only ever refuse what this refuses
 * already.
 */
export const MAX_DOC_CHARS = 40_000;

/**
 * The write shapes.
 *
 * `512` is a LITERAL, and deliberately not an import of
 * `modules/context/constants.ts`: `contracts-stay-pure` allows this folder to
 * import zod and itself and nothing else, so a shared constant would be a
 * dependency the rule refuses. The authoritative value is `MAX_PATH_LENGTH`
 * there; change one and change the other. It is a FIRST cut, not the rule — the
 * path is checked again on the server as a string (`sanitizeDocPath`) and a
 * third time after resolution, in the git adapter, because only resolution can
 * see a symlink.
 *
 * `content` carries NO `.max()`, and that is a decision rather than an omission.
 * A schema failure is answered `422 validation_error` by this app, while the
 * size of a document is `400 too_large` — a distinct code the client renders as
 * "this document is too big", not as a malformed request. So the bound lives
 * where it can say that: the service, which measures code points AND bytes
 * before the port is called. An abusive body is stopped long before either, by
 * Fastify's 1 MB `bodyLimit` (`app.ts`).
 */
export const CreateContextDocBody = z.object({
  /** Repo-relative, must be under `.devdigest/`, must end `.md`. */
  path: z.string().min(1).max(512),
  content: z.string(),
});
export type CreateContextDocBody = z.infer<typeof CreateContextDocBody>;

/** A folder under `.devdigest/`. No content: a folder holds no text. */
export const CreateContextFolderBody = z.object({
  path: z.string().min(1).max(512),
});
export type CreateContextFolderBody = z.infer<typeof CreateContextFolderBody>;

/**
 * Overwrite a scanned document with new text.
 *
 * `path` must already carry a scanned row: this endpoint saves DOCUMENTS, and
 * the string gate alone would happily write any `.md` under any root the
 * workspace deliberately did not configure.
 *
 * There is deliberately no `confirm_tracked` flag here. Warning before editing a
 * file the repository tracks — the next resync runs `git reset --hard` and the
 * edit is gone — is a UI act, and the server cannot render one; making the
 * server refuse an unconfirmed save was weighed as `## Recommendations` 1 of
 * `plans/09-project-context-authoring.md` and is not part of this contract.
 */
export const SaveContextDocBody = z.object({
  path: z.string().min(1).max(512),
  content: z.string(),
});
export type SaveContextDocBody = z.infer<typeof SaveContextDocBody>;

/**
 * A created folder. It carries no `SpecFile`, and that is the requirement: a new
 * folder holds no `.md`, so the document list cannot show it, and the caller is
 * told that positively rather than handed an unchanged list.
 */
export const ContextFolderCreated = z.object({
  path: z.string(),
});
export type ContextFolderCreated = z.infer<typeof ContextFolderCreated>;
