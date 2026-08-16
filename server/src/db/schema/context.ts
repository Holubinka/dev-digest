import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  jsonb,
  timestamp,
  vector,
  index,
  uniqueIndex,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { workspaces } from './core';
import { repos } from './repos';
import { agents } from './agents';
import { skills } from './skills';

// ============================================================ Context & codebase

/**
 * `symbols.name` and `references.to_symbol` are btree-indexed
 * (`symbols_repo_name_idx`, `references_repo_decl_symbol_idx`). Postgres rejects
 * any index row larger than ~2704 bytes, so a pathological multi-KB "name" from
 * a bad parse (e.g. a whole expression captured as an identifier) crashes the
 * indexer with `index row size … exceeds btree version 4 maximum`. Real
 * identifiers are short, so clamp these values well under the limit before
 * insert. 255 chars ≤ ~1 KB even for 4-byte code points — comfortably safe.
 */
export const MAX_INDEXED_NAME_LEN = 255;
export const clampIndexedName = (s: string): string =>
  s.length > MAX_INDEXED_NAME_LEN ? s.slice(0, MAX_INDEXED_NAME_LEN) : s;

export const codeChunks = pgTable(
  'code_chunks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    repoId: uuid('repo_id')
      .notNull()
      .references(() => repos.id, { onDelete: 'cascade' }),
    path: text('path').notNull(),
    content: text('content').notNull(),
    embedding: vector('embedding', { dimensions: 1536 }),
    source: text('source', { enum: ['code', 'docs', 'spec'] }).notNull().default('code'),
  },
  (t) => ({ repoIdx: index('code_chunks_repo_idx').on(t.repoId) }),
);

/**
 * `symbols` — declared identifiers (functions/classes/methods/etc.) per repo.
 *
 * T2 extension: added `endLine`, `exported`, `signature`,
 * `contentHash`. The new columns are nullable / defaulted so existing inserts
 * (blast/service.ts `persistSymbols`) keep typechecking; the T2 indexer
 * pipeline will backfill them on the next `refreshIndex`.
 *
 * `line` carries the `start_line` semantics — kept as-is so existing
 * rows survive the migration. The composite UNIQUE prevents duplicate
 * (repo, path, name, kind, line) tuples once the indexer takes over.
 */
export const symbols = pgTable(
  'symbols',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    repoId: uuid('repo_id')
      .notNull()
      .references(() => repos.id, { onDelete: 'cascade' }),
    path: text('path').notNull(),
    name: text('name').notNull(),
    kind: text('kind').notNull(),
    line: integer('line'), // = start_line
    endLine: integer('end_line'), // [T2] NEW
    exported: boolean('exported').notNull().default(false), // [T2] NEW
    signature: text('signature'), // [T2] NEW
    contentHash: text('content_hash'), // [T2] NEW (nullable — backfilled by indexer)
  },
  (t) => ({
    lookupIdx: index('symbols_repo_path_idx').on(t.repoId, t.path),
    nameIdx: index('symbols_repo_name_idx').on(t.repoId, t.name),
    uq: uniqueIndex('symbols_repo_path_name_kind_line_uq').on(
      t.repoId,
      t.path,
      t.name,
      t.kind,
      t.line,
    ),
  }),
);

/**
 * `references` — call-sites / usages of symbols.
 *
 * T2 extension: added `declFile` (NULL = unresolved → feeds the
 * Phantom-gate) and `contentHash`. The legacy columns are untouched, so
 * blast/service.ts `persistReferences` keeps working.
 */
export const references = pgTable(
  'references',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    repoId: uuid('repo_id')
      .notNull()
      .references(() => repos.id, { onDelete: 'cascade' }),
    fromPath: text('from_path').notNull(), // = ref_file
    toSymbol: text('to_symbol').notNull(), // = symbol_name
    line: integer('line').notNull(), // = ref_line
    declFile: text('decl_file'), // [T2] NEW — NULL = unresolved (Phantom-gate)
    contentHash: text('content_hash'), // [T2] NEW
  },
  (t) => ({
    byDecl: index('references_repo_decl_symbol_idx').on(
      t.repoId,
      t.declFile,
      t.toSymbol,
    ),
    byFile: index('references_repo_from_idx').on(t.repoId, t.fromPath),
  }),
);

export const onboarding = pgTable('onboarding', {
  repoId: uuid('repo_id')
    .primaryKey()
    .references(() => repos.id, { onDelete: 'cascade' }),
  json: jsonb('json').notNull(),
  generatedAt: timestamp('generated_at', { withTimezone: true }).defaultNow().notNull(),
});

// ============================================================ Project Context (08)
//
// The four tables below belong to Project Context — the READ-ONLY view over the
// `.md` documents a repo's clone already carries, and the per-agent / per-skill
// attachments that put some of them into a review prompt.
//
// They share this file with the code-index tables above by domain name only:
// nothing here chunks, embeds or ranks anything, and `code_chunks.source` is not
// the same fact as `repo_docs.kind`.

/**
 * One `.md` document found by a scan of the repo's clone, under one of the
 * workspace's configured roots.
 *
 * Text is deliberately NOT stored: only the path, its provenance and its size.
 * The clone is the source of truth and a copy here would go stale the moment
 * `refresh()` re-clones. `tokens` is what the editor's budget footer sums and
 * what the run measures the budget with — one number, counted once, by one
 * counter, over the SAME rendered string the run assembles.
 */
export const repoDocs = pgTable(
  'repo_docs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    repoId: uuid('repo_id')
      .notNull()
      .references(() => repos.id, { onDelete: 'cascade' }),
    /** Repo-relative, posix separators. */
    path: text('path').notNull(),
    /** The configured root it was found under, verbatim. */
    root: text('root').notNull(),
    kind: text('kind', { enum: ['specs', 'docs', 'insights', 'other'] }).notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    tokens: integer('tokens').notNull(),
    modifiedAt: timestamp('modified_at', { withTimezone: true }),
    scannedAt: timestamp('scanned_at', { withTimezone: true }).defaultNow().notNull(),
    /**
     * sha256 of the text this row was written from. NULLABLE, because a scan
     * replaces this table wholesale and a row it produced from `listFiles`
     * metadata alone has nothing to hash — the column is filled by a write, and
     * by the rescan that follows one.
     *
     * Compared against `repo_doc_edits.content_hash` to answer `SpecFile.stale`:
     * "what is on disk is no longer the text DevDigest saved here".
     */
    contentHash: text('content_hash'),
  },
  (t) => ({
    uq: uniqueIndex('repo_docs_repo_path_uq').on(t.repoId, t.path),
    // Postgres does not index a foreign-key column for you, and every read of
    // this table starts from a repo.
    repoIdx: index('repo_docs_repo_idx').on(t.repoId),
  }),
);

/**
 * The state of one repo's document scan. One row per repo.
 *
 * `lastError` / `lastErrorAt` sit BESIDE `scannedAt` rather than over it: a
 * failed rescan must leave the previous count and time readable, so the failure
 * path writes a different set of columns instead of a status.
 *
 * `scanningAt` is the third fact, and it is a column rather than an inference
 * because "a scan is in flight" cannot be read off the other two: a RESCAN has
 * a previous success behind it, so `scanned_at` is set, and clearing it to mean
 * "scanning" would destroy the previous result a failed rescan is required to
 * leave intact. It is set when the job is enqueued and cleared by whichever of
 * the two outcomes lands.
 */
export const repoDocScans = pgTable('repo_doc_scans', {
  repoId: uuid('repo_id')
    .primaryKey()
    .references(() => repos.id, { onDelete: 'cascade' }),
  /** The roots this scan actually walked — the rows above were produced under them. */
  roots: jsonb('roots').$type<string[]>().notNull().default([]),
  fileCount: integer('file_count').notNull().default(0),
  /** The candidate cap fired: the document list is a prefix of what is on disk. */
  bounded: boolean('bounded').notNull().default(false),
  scannedAt: timestamp('scanned_at', { withTimezone: true }),
  /** A scan is enqueued or running. Null the moment it succeeds or fails. */
  scanningAt: timestamp('scanning_at', { withTimezone: true }),
  lastError: text('last_error'),
  lastErrorAt: timestamp('last_error_at', { withTimezone: true }),
});

/**
 * Documents one agent attaches, for one repo, in saved order.
 *
 * `position` IS the feature: it is the order the documents take in the assembled
 * `## Project context` section. A foreign key proves the agent and the repo
 * exist; it does not prove they belong to the caller's workspace, so the service
 * checks tenancy before every write.
 */
export const agentContextDocs = pgTable(
  'agent_context_docs',
  {
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    repoId: uuid('repo_id')
      .notNull()
      .references(() => repos.id, { onDelete: 'cascade' }),
    path: text('path').notNull(),
    position: integer('position').notNull().default(0),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.agentId, t.repoId, t.path] }),
    // The PK leads with `agent_id`, and the "used by N agents" count reads in
    // the opposite direction — from a (repo, path) to the agents holding it.
    // Exactly the gap `agent_skills_skill_idx` was added to close.
    repoPathIdx: index('agent_context_docs_repo_path_idx').on(t.repoId, t.path),
  }),
);

/**
 * What DevDigest itself wrote to one document — the durability record (09).
 *
 * It records TWO facts and stores no text.
 *
 *   - `createdHere` says the document was created or uploaded here rather than
 *     found in the repository, which is what the list and the right panel say
 *     out loud: it is not in the repository, another clone cannot see it, and a
 *     re-clone takes it away (`AC-66`).
 *   - `contentHash` is the text as saved. When `repo_docs.content_hash` stops
 *     matching it, a `git reset --hard` has returned a tracked file to the
 *     branch and the edit made here is gone (`AC-71`).
 *
 * The file is the durability mechanism, not this row: an untracked file under
 * `.devdigest/` survives `refresh()` and `resyncRepo()` on its own, and this
 * table would not bring one back. It exists so the two facts above can be told.
 *
 * Repo-keyed, not workspace-keyed, exactly like `repo_doc_scans`: every read
 * starts from a repo the service has already proved belongs to the caller's
 * workspace. The composite PK is also the upsert's `ON CONFLICT` target and the
 * only access path, so no further index is warranted — Postgres would not have
 * indexed the foreign key on its own, and the PK's leading column is it.
 */
export const repoDocEdits = pgTable(
  'repo_doc_edits',
  {
    repoId: uuid('repo_id')
      .notNull()
      .references(() => repos.id, { onDelete: 'cascade' }),
    /** Repo-relative, posix separators — the same string as `repo_docs.path`. */
    path: text('path').notNull(),
    createdHere: boolean('created_here').notNull().default(false),
    /** sha256 hex of the text last written through DevDigest. */
    contentHash: text('content_hash').notNull(),
    savedAt: timestamp('saved_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.repoId, t.path] }),
  }),
);

/** The same, for a skill. Every agent binding the skill inherits its documents. */
export const skillContextDocs = pgTable(
  'skill_context_docs',
  {
    skillId: uuid('skill_id')
      .notNull()
      .references(() => skills.id, { onDelete: 'cascade' }),
    repoId: uuid('repo_id')
      .notNull()
      .references(() => repos.id, { onDelete: 'cascade' }),
    path: text('path').notNull(),
    position: integer('position').notNull().default(0),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.skillId, t.repoId, t.path] }),
    repoPathIdx: index('skill_context_docs_repo_path_idx').on(t.repoId, t.path),
  }),
);
