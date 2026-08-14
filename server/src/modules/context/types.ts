import type { ContextDocKind, ContextDocStatus, GitClient } from '@devdigest/shared';
import type { SettingsReader } from '../_shared/feature-models.js';

/**
 * context — the ports this slice codes against.
 *
 * `Container` is deliberately NOT imported. `platform/container.ts` constructs
 * `ContextService` for its `projectContext` getter, so naming `Container` from
 * the service closes a two-file require cycle that `no-circular` rejects — the
 * same reason `intent/types.ts` and `blast/types.ts` are shaped this way. A
 * `Container` satisfies these shapes by construction, so the composition root
 * needs no adapter.
 *
 * Nothing here mentions `Db`: the repository is supplied by `container.ts`,
 * which is the one place allowed to name a concrete type.
 */

/** The slice of the composition root `ContextService` needs, stated structurally. */
export interface ContextContainer extends SettingsReader {
  readonly git: GitClient;
  /** The ONE counter the editor's figure and the run's budget decision share. */
  readonly tokenizer: { count(text: string): number };
  readonly jobs: {
    /**
     * `done` is optional in this port and required in `JobRunner`: a fake in a
     * test has nothing to resolve, while the real runner's rejection has to be
     * claimed by the caller or it becomes an unhandled rejection.
     */
    enqueue(
      workspaceId: string,
      kind: string,
      payload: unknown,
    ): Promise<{ id: string; done?: Promise<void> }>;
    register(
      kind: string,
      handler: (payload: unknown, ctx: { jobId: string }) => Promise<void>,
    ): void;
  };
}

/** The repo row this slice reads, as primitives. A `*Row` never leaves the module. */
export interface ContextRepoRef {
  id: string;
  workspaceId: string;
  owner: string;
  name: string;
  clonePath: string | null;
  defaultBranch: string;
}

/** One persisted document, plus the count of enabled agents whose set holds it. */
export interface ContextDocRecord {
  path: string;
  root: string;
  kind: ContextDocKind;
  sizeBytes: number;
  tokens: number;
  modifiedAt: Date | null;
  usedByAgents: number;
  /** Created or uploaded through DevDigest rather than found in the repository. */
  local: boolean;
  /**
   * The disk no longer holds the text DevDigest saved: a tracked file was edited
   * here and a later `git reset --hard` put the branch's version back.
   */
  stale: boolean;
}

/** The scan-state row. `scanningAt` set = a scan is enqueued or running. */
export interface ContextScanRecord {
  roots: string[];
  fileCount: number;
  bounded: boolean;
  scannedAt: Date | null;
  scanningAt: Date | null;
  lastError: string | null;
  lastErrorAt: Date | null;
}

/** One saved attachment, as stored. */
export interface ContextAttachment {
  path: string;
  position: number;
}

/** One enabled skill bound to an agent, with the documents it attaches for a repo. */
export interface BoundSkillDocs {
  skillId: string;
  skillName: string;
  /** `agent_skills.order` — the binding order the effective set walks in. */
  order: number;
  paths: ContextAttachment[];
}

/** One row written by a scan, or by a write that produced a document. */
export interface ScannedDoc {
  path: string;
  root: string;
  kind: ContextDocKind;
  sizeBytes: number;
  tokens: number;
  modifiedAt: Date | null;
  /**
   * sha256 of the text this row was produced from — the scan's truncated body,
   * or the text a save wrote. Compared against `repo_doc_edits.content_hash` to
   * decide `stale`, which is why both sides must hash the SAME string.
   */
  contentHash: string;
}

/**
 * The repository seam, declared as an INTERFACE rather than as the class.
 *
 * A class with a `private db` cannot be satisfied by an object literal, so a
 * fake needs a lying cast — and that, not the defaulted constructor parameter,
 * is why three services in this repo have no hermetic tests
 * (`server/INSIGHTS.md`). Declaring the methods here is what makes
 * `context-service.test.ts` possible without a database.
 */
export interface ContextReads {
  repoById(workspaceId: string, repoId: string): Promise<ContextRepoRef | undefined>;
  scanFor(repoId: string): Promise<ContextScanRecord | undefined>;
  docsFor(repoId: string): Promise<ContextDocRecord[]>;
  /** One document's persisted row — the deny-by-default gate on the content read. */
  docByPath(repoId: string, path: string): Promise<ContextDocRecord | undefined>;
  /**
   * Every scanned path for a repo — the same gate, on the RUN path.
   *
   * A separate read from `docsFor` because the run needs membership and nothing
   * else, and `docsFor` pays for the "used by N agents" aggregate to answer it.
   */
  scannedPaths(repoId: string): Promise<string[]>;
  agentAttachments(agentId: string, repoId: string): Promise<ContextAttachment[]>;
  /**
   * How many attachments this agent has across ALL repos.
   *
   * Read in the same round trip as the set for one repo so the run path can tell
   * "nothing attached" from "attached, but to a different repository" — two
   * facts that produce different answers and would otherwise need two queries.
   */
  agentAttachmentTotal(agentId: string): Promise<number>;
  skillAttachments(skillId: string, repoId: string): Promise<ContextAttachment[]>;
  /** The agent's ENABLED bound skills, in binding order, with their attachments. */
  boundSkillDocs(agentId: string, repoId: string): Promise<BoundSkillDocs[]>;
  agentInWorkspace(workspaceId: string, agentId: string): Promise<boolean>;
  skillInWorkspace(workspaceId: string, skillId: string): Promise<boolean>;
  repoInWorkspace(workspaceId: string, repoId: string): Promise<boolean>;
}

export interface ContextWrites {
  setAgentAttachments(agentId: string, repoId: string, paths: string[]): Promise<void>;
  setSkillAttachments(skillId: string, repoId: string, paths: string[]): Promise<void>;
  replaceDocs(
    workspaceId: string,
    repoId: string,
    docs: ScannedDoc[],
    scan: { roots: string[]; bounded: boolean },
  ): Promise<void>;
  recordScanFailure(repoId: string, roots: string[], message: string): Promise<void>;
  markScanning(repoId: string, roots: string[]): Promise<void>;
  /**
   * Insert or update ONE document row, and bring `repo_doc_scans.file_count`
   * back into agreement with the rows behind it, in one transaction.
   *
   * A written document is an ordinary scan result from the moment it lands
   * (`AC-62`), which is what makes it appear in the list with no rescan. Writing
   * the row without the count leaves the page's footer saying "3 documents"
   * above a list of four — the one output of this feature nobody can debug, and
   * the reason `replaceDocs` is a transaction too.
   */
  upsertDoc(workspaceId: string, repoId: string, doc: ScannedDoc): Promise<void>;
  /**
   * Record what DevDigest wrote to a path: whether it created the document, and
   * the hash of the text it saved.
   *
   * `createdHere` is STICKY — a later save of a document created here must not
   * demote it to an ordinary repository file, and there is no delete to undo it
   * with.
   */
  recordEdit(
    repoId: string,
    path: string,
    edit: { createdHere: boolean; contentHash: string },
  ): Promise<void>;
}

export type ContextRepo = ContextReads & ContextWrites;

/** One document of the effective set, resolved for a run. */
export interface ProjectContextDocResult {
  path: string;
  tokens: number;
  status: ContextDocStatus;
}

export interface ProjectContextResult {
  /** One rendered document each, its path inside, in block order. */
  blocks: string[];
  docs: ProjectContextDocResult[];
  /** `specs_read`, in block order. */
  includedPaths: string[];
  /** The run-log line when the section was skipped or degraded; undefined when it was not. */
  note: string | undefined;
}

/**
 * The port `platform/container.ts` exposes to the review path.
 *
 * `modules/reviews/**` may not import `modules/context/**` (`no-cross-module`),
 * so the executor reaches this interface as `container.projectContext` with no
 * import statement at all — the route `container.intentService` already takes.
 */
export interface ProjectContextResolver {
  resolveForRun(input: {
    workspaceId: string;
    agentId: string;
    repoId: string;
    repo: { owner: string; name: string };
  }): Promise<ProjectContextResult>;
}
