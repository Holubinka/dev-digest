import type {
  AgentContextDocs,
  AttachedContextDoc,
  ContextDocsPage,
  ContextFolderCreated,
  ContextScanState,
  CreateContextDocBody,
  CreateContextFolderBody,
  InheritedContextDoc,
  SaveContextDocBody,
  SetContextDocsBody,
  SkillContextDocs,
  SpecFile,
} from '@devdigest/shared';
import { CloneReadError, CloneWriteError } from '@devdigest/shared';
import { AppError, NotFoundError } from '../../platform/errors.js';
import type {
  ContextContainer,
  ContextDocRecord,
  ContextRepo,
  ContextRepoRef,
  ProjectContextResolver,
  ProjectContextResult,
} from './types.js';
import {
  contentHash,
  dedupePaths,
  effectiveSet,
  isExcludedBundlePath,
  kindForRoot,
  renderDoc,
  rootFor,
  sanitizeDocPath,
  sanitizeFolderPath,
  selectWithinBudget,
  toDocDto,
  truncateCodePoints,
  writeZone,
  type BudgetCandidate,
  type WriteMode,
  type WriteZoneRefusal,
} from './helpers.js';
import { resolveContextSettings } from './settings.js';
import { ContextScanExecutor } from './scan-executor.js';
import {
  CONTEXT_SCAN_JOB_KIND,
  DEVDIGEST_ROOT,
  EXCLUDED_DEVDIGEST_SUBROOTS,
  MAX_DOC_BYTES,
  MAX_DOC_CHARS,
  MAX_DOC_FILE_BYTES,
  MAX_DOC_READ_BYTES,
  SCAN_CLAIM_STALE_MS,
} from './constants.js';

/**
 * Project Context — the use cases.
 *
 * Two audiences, one service: the editors and the page read and write
 * attachments, and the review path resolves an agent's effective set into prompt
 * blocks. They share this class because they share the ordering and de-duplication
 * rules, and a second implementation of "which documents does this agent
 * actually get" is how the editor's answer and the run's answer start to differ.
 */
export class ContextService implements ProjectContextResolver {
  constructor(
    private container: ContextContainer,
    private repo: ContextRepo,
  ) {}

  /**
   * Register the scan job handler once, at module registration.
   *
   * The runner stores the closure, not this instance, so registering from the
   * route plugin and reading through the container getter are the same thing —
   * the shape `repo-intel/routes.ts` already uses.
   */
  registerScanJobHandler(): void {
    const executor = new ContextScanExecutor(this.container, this.repo);
    this.container.jobs.register(CONTEXT_SCAN_JOB_KIND, async (payload) => {
      const { workspaceId, repoId } = payload as { workspaceId: string; repoId: string };
      await executor.run({ workspaceId, repoId });
    });
  }

  // -------------------------------------------------------------------------
  // The page
  // -------------------------------------------------------------------------

  /**
   * The Project Context page for one repo. NEVER walks the disk — every number
   * comes from the persisted scan, which is what keeps this a fast read.
   *
   * The four states are decided in one place and are mutually exclusive, because
   * on the client a disabled query reports `isLoading === false` and a state
   * inferred from three booleans there will eventually mask one of them.
   */
  async docsPage(workspaceId: string, repoId: string): Promise<ContextDocsPage> {
    const repo = await this.requireRepo(workspaceId, repoId);
    const { roots, budgetTokens } = await resolveContextSettings(this.container, workspaceId);
    const scan = await this.repo.scanFor(repoId);

    const empty = (state: ContextScanState): ContextDocsPage => ({
      state,
      roots,
      budget_tokens: budgetTokens,
      file_count: scan?.fileCount ?? 0,
      bounded: scan?.bounded ?? false,
      scanned_at: scan?.scannedAt?.toISOString() ?? null,
      last_error: scan?.lastError ?? null,
      last_error_at: scan?.lastErrorAt?.toISOString() ?? null,
      documents: [],
    });

    if (!repo.clonePath) return empty('no_clone');

    // The FIRST scan of a repo is enqueued lazily, here, on the first read of
    // its document list. Nothing else auto-scans: enqueuing from the clone job
    // would need `modules/repos` to name this slice's job kind, which is a
    // cross-module edge that would have to be frozen into the arch baseline —
    // and that baseline only shrinks.
    if (!scan) {
      await this.repo.markScanning(repoId, roots);
      await this.enqueueScan(workspaceId, repoId)
        // A read must not 500 because a job could not be queued. The row is
        // claimed either way and `rescan` is the user's retry.
        .catch(() => undefined);
      return { ...empty('scanning'), file_count: 0, bounded: false };
    }

    // A STRANDED claim is re-enqueued here for the same reason the first scan
    // is enqueued here: this read is the only thing that ever looks at the row.
    // `JobRunner` is an in-memory queue that recovers nothing on boot
    // (`platform/jobs.ts`), so an API restart between `markScanning` and the
    // handler finishing leaves a claim with no process behind it — routine under
    // `tsx watch`. Re-claiming first is what keeps this to one job per stale
    // window instead of one per page load.
    //
    // The state reported below is still derived from the row AS READ, so a first
    // scan that was stranded answers `failed` rather than a spinner that never
    // stops: the recovery is automatic, not a reason to claim a scan is running.
    if (claimIsStale(scan.scanningAt)) {
      await this.repo.markScanning(repoId, roots);
      await this.enqueueScan(workspaceId, repoId).catch(() => undefined);
    }

    const documents = await this.repo.docsFor(repoId);
    return { ...empty(scanState(scan)), documents: documents.map(toDocDto) };
  }

  /** Queue a rescan. Returns immediately; the page polls the scan state. */
  async rescan(workspaceId: string, repoId: string): Promise<{ status: 'scanning' }> {
    await this.requireRepo(workspaceId, repoId);
    const { roots } = await resolveContextSettings(this.container, workspaceId);
    await this.repo.markScanning(repoId, roots);
    await this.enqueueScan(workspaceId, repoId);
    return { status: 'scanning' };
  }

  /**
   * Enqueue the scan and CLAIM its eventual failure.
   *
   * `JobRunner.enqueue` hands back a `done` promise that rejects when the
   * handler ultimately fails, and the scan handler rethrows on purpose so the
   * runner records the job failed and retries it. Dropping `done` on the floor
   * therefore leaves an unhandled rejection behind every failed scan — which
   * Node reports as an unhandled error and some configurations turn into a
   * process exit. There is nothing to do with the failure here: it is already
   * on the `jobs` row and in `repo_doc_scans.last_error`, which is what the page
   * reads.
   */
  private async enqueueScan(workspaceId: string, repoId: string): Promise<void> {
    const job = await this.container.jobs.enqueue(workspaceId, CONTEXT_SCAN_JOB_KIND, {
      workspaceId,
      repoId,
    });
    job.done?.catch(() => undefined);
  }

  /**
   * One document's text, for the reading pane.
   *
   * Deny by default: the path must have a `repo_docs` row. This endpoint serves
   * SCANNED DOCUMENTS, not arbitrary clone paths, and the string gate alone
   * would happily read any `.md` in the repository — including one under a root
   * the workspace deliberately did not configure.
   *
   * A read that cannot produce content answers in the RUN's own three words, as
   * three different codes, because the reader is shown the reason instead of the
   * text and the three reasons are not the same news: `doc_missing` means the
   * file left the clone, `doc_refused` means the reader would have had to leave
   * the clone or enter `.git/` to get it — or that the file is larger than a
   * document may be — and `doc_binary` means what came back is not a document.
   * Collapsing them into one 404 — which is what this used to do — tells someone
   * whose symlinked document was refused that it is missing.
   *
   * WHOLE OR NOTHING. Unlike the scan and the run, this path does not truncate,
   * and that is a safety property rather than a convenience: what it returns is
   * seeded straight into the editor's draft, and a save writes that draft as the
   * ENTIRE file. A body cut here is therefore a tail deleted from disk at the
   * next save, with no git copy under `.devdigest/` and no history anywhere. It
   * used to cut at `MAX_DOC_CHARS`, so the 74 636-code-point document this repo
   * carries reached the editor as 40 000 and saved as 40 000.
   *
   * The two caps that stayed are the ones that make the promise keepable: the
   * read pulls one byte more than a document may be, so a file that grew past
   * `MAX_DOC_FILE_BYTES` since the scan is refused rather than served short.
   */
  async docContent(workspaceId: string, repoId: string, rawPath: string): Promise<SpecFile> {
    const repo = await this.requireRepo(workspaceId, repoId);
    const path = sanitizeDocPath(rawPath);
    if (!path) throw new AppError('invalid_path', 'Not a repo-relative .md path', 400);

    const record = await this.repo.docByPath(repoId, path);
    if (!record) throw new AppError('doc_missing', 'Document not found', 404);
    if (!repo.clonePath) throw new AppError('doc_missing', 'Repository clone is not ready', 404);

    let text: string;
    try {
      text = await this.container.git.readFile(
        { owner: repo.owner, name: repo.name },
        path,
        MAX_DOC_READ_BYTES,
      );
    } catch (err) {
      if (err instanceof CloneReadError && err.reason !== 'not_found') {
        throw new AppError('doc_refused', 'Document could not be read from the clone', 403);
      }
      throw new AppError('doc_missing', 'Document is no longer in the clone', 404);
    }
    // More came back than a document may hold, so the read hit its cap and what
    // is in `text` is a PREFIX. Refusing is the only honest answer: serving it
    // would put a prefix in front of an editor whose save replaces the file.
    if (Buffer.byteLength(text, 'utf8') > MAX_DOC_FILE_BYTES) {
      throw new AppError('doc_refused', 'Document is larger than DevDigest will read', 403);
    }
    // A body holding U+0000 is not a document, and it is not sendable either:
    // a NUL in a prompt has already failed a run in this repo once. The same
    // rule the run path applies, at the same point.
    if (text.includes('\u0000')) {
      throw new AppError('doc_binary', 'Document is not text', 415);
    }
    return { ...toDocDto(record), content: text };
  }

  // -------------------------------------------------------------------------
  // Authoring
  //
  // Four use cases, one order, and the order is the design:
  //
  //   tenancy → clone → path as a string → zone → size → the port → the row
  //
  // Tenancy is FIRST, before anything is parsed or measured, because a
  // cross-tenant write does not leak another workspace's document — it puts
  // this workspace's text into another one's review prompts, which is a worse
  // outcome than a read of the same shape and cannot be undone from the UI.
  //
  // Size is checked in BOTH code points and bytes, and both before the port
  // call. Code points are what the reader's cap is expressed in and what
  // `truncateCodePoints` counts; bytes are what an allocation and a filesystem
  // are measured in, and a 40 000-code-point document of emoji is 160 000 of
  // them. Neither number is the other one, so neither check replaces the other.
  // -------------------------------------------------------------------------

  /** Create a new document under `.devdigest/`. `AC-57`, `AC-67`, `AC-68`. */
  async createDoc(
    workspaceId: string,
    repoId: string,
    body: CreateContextDocBody,
  ): Promise<SpecFile> {
    const { repo, roots, path } = await this.prepareWrite(workspaceId, repoId, {
      rawPath: body.path,
      mode: 'create',
    });
    return this.persistWrite({
      repo,
      repoId,
      workspaceId,
      roots,
      path,
      content: body.content,
      overwrite: false,
      createdHere: true,
    });
  }

  /**
   * The same document, arriving as a multipart upload. `AC-58`.
   *
   * The client's filename is a NAME and never a path — `path.basename` is
   * applied by the route before this is reached, because a browser is entitled
   * to send `../../evil.md` and a multipart parser will hand it over verbatim.
   * The extension is allow-listed case-insensitively (`.MD` is a file people
   * commit), and the decoded text is refused outright if it carries `U+0000`: a
   * renamed `.exe` satisfies every extension rule there is, and that is the only
   * check which catches it.
   */
  async uploadDoc(
    workspaceId: string,
    repoId: string,
    file: { filename: string; bytes: Uint8Array },
  ): Promise<SpecFile> {
    const name = baseName(file.filename);
    if (!name.toLowerCase().endsWith('.md')) {
      throw new AppError('invalid_path', 'Upload a .md file', 400);
    }
    const content = new TextDecoder().decode(file.bytes);
    if (content.includes('\u0000')) {
      throw new AppError('binary_content', 'The uploaded file is not text', 400);
    }
    const { repo, roots, path } = await this.prepareWrite(workspaceId, repoId, {
      rawPath: `${DEVDIGEST_ROOT}/${name}`,
      mode: 'create',
    });
    return this.persistWrite({
      repo,
      repoId,
      workspaceId,
      roots,
      path,
      content,
      overwrite: false,
      createdHere: true,
    });
  }

  /**
   * A folder under `.devdigest/`. `AC-59`.
   *
   * It returns its path and NOT a document list, because the honest answer is
   * that nothing changed in the list: a new folder holds no `.md`, so no scan
   * and no page can show it. Saying so positively is the requirement; handing
   * back an unchanged list and letting the UI wonder is what it forbids.
   */
  async createFolder(
    workspaceId: string,
    repoId: string,
    body: CreateContextFolderBody,
  ): Promise<ContextFolderCreated> {
    const repo = await this.requireRepo(workspaceId, repoId);
    this.requireClone(repo);
    const path = sanitizeFolderPath(body.path);
    if (!path) throw new AppError('invalid_path', 'Not a repo-relative folder path', 400);
    const { roots } = await resolveContextSettings(this.container, workspaceId);
    const refusal = writeZone(path, roots, 'folder');
    if (refusal) throw zoneError(refusal, 'folder');

    try {
      await this.container.git.makeDir({ owner: repo.owner, name: repo.name }, path);
    } catch (err) {
      throw writeError(err);
    }
    return { path };
  }

  /**
   * Overwrite a scanned document with new text. `AC-60`, `AC-63`, `AC-64`.
   *
   * Deny by default, exactly as the reading pane does: the path must already
   * carry a `repo_docs` row. Without that, this endpoint would write any `.md`
   * anywhere under a configured root — including one the scan has never seen and
   * therefore one nobody could have been looking at when they pressed save.
   */
  async saveDoc(
    workspaceId: string,
    repoId: string,
    body: SaveContextDocBody,
  ): Promise<SpecFile> {
    const { repo, roots, path } = await this.prepareWrite(workspaceId, repoId, {
      rawPath: body.path,
      mode: 'save',
    });
    const existing = await this.repo.docByPath(repoId, path);
    if (!existing) throw new AppError('not_found', 'Document not found', 404);

    return this.persistWrite({
      repo,
      repoId,
      workspaceId,
      roots,
      path,
      content: body.content,
      overwrite: true,
      createdHere: false,
    });
  }

  /**
   * Everything the four use cases do BEFORE they differ: tenancy, the clone, the
   * path as a string, and the zone.
   *
   * One function because each of these is a refusal, and a refusal that four
   * call sites each implement is a refusal three of them will eventually be
   * missing (`server/INSIGHTS.md` — "a cap applied on one path of a multi-path
   * method lets the contract lie on the others").
   */
  private async prepareWrite(
    workspaceId: string,
    repoId: string,
    input: { rawPath: string; mode: Exclude<WriteMode, 'folder'> },
  ): Promise<{ repo: ContextRepoRef; roots: string[]; path: string }> {
    const repo = await this.requireRepo(workspaceId, repoId);
    this.requireClone(repo);
    const path = sanitizeDocPath(input.rawPath);
    if (!path) throw new AppError('invalid_path', 'Not a repo-relative .md path', 400);
    const { roots } = await resolveContextSettings(this.container, workspaceId);
    const refusal = writeZone(path, roots, input.mode);
    if (refusal) throw zoneError(refusal, input.mode);
    return { repo, roots, path };
  }

  /**
   * The write itself, and the two rows that record it.
   *
   * The order is: bound the size, call the port, then persist. Nothing is
   * written to the database until the file is on disk, so a failed write leaves
   * no row claiming a document that is not there — the inverse mistake, a row
   * without a file, is the one the whole read path is built to survive.
   *
   * `tokens` comes from `container.tokenizer.count(renderDoc(...))`, over the
   * SAME rendered string the run assembles, by the SAME counter it measures the
   * budget with. Anything else and a saved document's figure would drift from
   * the one the budget footer and the run agree on until the next rescan.
   */
  private async persistWrite(input: {
    repo: ContextRepoRef;
    repoId: string;
    workspaceId: string;
    roots: string[];
    path: string;
    content: string;
    overwrite: boolean;
    createdHere: boolean;
  }): Promise<SpecFile> {
    const { path, content } = input;
    if ([...content].length > MAX_DOC_CHARS) {
      throw new AppError('too_large', `A document is at most ${MAX_DOC_CHARS} characters`, 400);
    }
    if (Buffer.byteLength(content, 'utf8') > MAX_DOC_BYTES) {
      throw new AppError('too_large', `A document is at most ${MAX_DOC_BYTES} bytes`, 400);
    }

    let written: { size_bytes: number; modified_at: string };
    try {
      written = await this.container.git.writeFile(
        { owner: input.repo.owner, name: input.repo.name },
        path,
        content,
        { maxBytes: MAX_DOC_BYTES, overwrite: input.overwrite },
      );
    } catch (err) {
      throw writeError(err);
    }

    // `rootFor` cannot miss: `writeZone` has already established that the path
    // is under `.devdigest/` (a root of every repo) or under a scanned root.
    const root = rootFor(path, input.roots) ?? DEVDIGEST_ROOT;
    await this.repo.upsertDoc(input.workspaceId, input.repoId, {
      path,
      root,
      // The same derivation the scan uses, with the same two arguments: a write
      // and a rescan of what it wrote must label the document identically, or
      // the badge changes under the reader for no reason they can see.
      kind: kindForRoot(root, path),
      sizeBytes: written.size_bytes,
      tokens: this.container.tokenizer.count(renderDoc(path, content)),
      modifiedAt: parseIso(written.modified_at),
      contentHash: contentHash(content),
    });
    await this.repo.recordEdit(input.repoId, path, {
      createdHere: input.createdHere,
      contentHash: contentHash(content),
    });

    const record = await this.repo.docByPath(input.repoId, path);
    if (!record) throw new AppError('not_found', 'Document not found after writing', 500);
    return toDocDto(record);
  }

  /**
   * `409`, not a write error. With no clone there is nothing to write INTO, and
   * the page already knows how to say "preparing the clone" — answering with a
   * filesystem failure would describe a bug where there is only a wait.
   */
  private requireClone(repo: ContextRepoRef): void {
    if (!repo.clonePath) {
      throw new AppError('clone_not_ready', 'The repository clone is not ready yet', 409);
    }
  }

  // -------------------------------------------------------------------------
  // Attachments
  // -------------------------------------------------------------------------

  async agentDocs(
    workspaceId: string,
    agentId: string,
    repoId: string,
  ): Promise<AgentContextDocs> {
    await this.assertAgentAndRepo(workspaceId, agentId, repoId);
    const [own, bound, scanned] = await Promise.all([
      this.repo.agentAttachments(agentId, repoId),
      this.repo.boundSkillDocs(agentId, repoId),
      this.repo.docsFor(repoId),
    ]);
    const byPath = indexByPath(scanned);
    const ownPaths = new Set(own.map((a) => a.path));

    // Inherited rows are de-duplicated across skills the same way the effective
    // set is: the first binding wins, so one document does not appear three
    // times because three skills happen to attach it.
    const inherited: InheritedContextDoc[] = [];
    const seen = new Set<string>();
    for (const skill of [...bound].sort((a, b) => a.order - b.order)) {
      for (const attachment of [...skill.paths].sort((a, b) => a.position - b.position)) {
        if (seen.has(attachment.path)) continue;
        seen.add(attachment.path);
        inherited.push({
          path: attachment.path,
          tokens: byPath.get(attachment.path)?.tokens ?? null,
          skill_id: skill.skillId,
          skill_name: skill.skillName,
          // The agent attaches it too: its own attachment wins, this row is
          // read-only information, and the token footer counts it once.
          also_attached: ownPaths.has(attachment.path),
        });
      }
    }

    return {
      repo_id: repoId,
      attached: own.map((a, position) => toAttached(a.path, position, byPath)),
      inherited,
    };
  }

  async setAgentDocs(
    workspaceId: string,
    agentId: string,
    body: SetContextDocsBody,
  ): Promise<AgentContextDocs> {
    await this.assertAgentAndRepo(workspaceId, agentId, body.repo_id);
    await this.repo.setAgentAttachments(agentId, body.repo_id, this.cleanPaths(body.paths));
    return this.agentDocs(workspaceId, agentId, body.repo_id);
  }

  async skillDocs(
    workspaceId: string,
    skillId: string,
    repoId: string,
  ): Promise<SkillContextDocs> {
    await this.assertSkillAndRepo(workspaceId, skillId, repoId);
    const [own, scanned] = await Promise.all([
      this.repo.skillAttachments(skillId, repoId),
      this.repo.docsFor(repoId),
    ]);
    const byPath = indexByPath(scanned);
    return {
      repo_id: repoId,
      attached: own.map((a, position) => toAttached(a.path, position, byPath)),
    };
  }

  async setSkillDocs(
    workspaceId: string,
    skillId: string,
    body: SetContextDocsBody,
  ): Promise<SkillContextDocs> {
    await this.assertSkillAndRepo(workspaceId, skillId, body.repo_id);
    await this.repo.setSkillAttachments(skillId, body.repo_id, this.cleanPaths(body.paths));
    return this.skillDocs(workspaceId, skillId, body.repo_id);
  }

  // -------------------------------------------------------------------------
  // The run path
  // -------------------------------------------------------------------------

  /**
   * The agent's effective set, resolved into prompt blocks for one run.
   *
   * FOUR ways out, and each one has to satisfy the contract on its own — a cap
   * or a note applied on one path of a multi-path method lets the contract lie on
   * the others (`server/INSIGHTS.md`). They are: nothing attached; attached, but
   * to another repository; the read path failed wholesale; and the normal walk.
   *
   * NO model call, NO network request and NO `node:fs`. Everything it reads
   * comes from the database and from `GitClient`.
   */
  async resolveForRun(input: {
    workspaceId: string;
    agentId: string;
    repoId: string;
    repo: { owner: string; name: string };
  }): Promise<ProjectContextResult> {
    const nothing = (note: string | undefined): ProjectContextResult => ({
      blocks: [],
      docs: [],
      includedPaths: [],
      note,
    });

    try {
      const [own, bound, total, scanned, settings] = await Promise.all([
        this.repo.agentAttachments(input.agentId, input.repoId),
        this.repo.boundSkillDocs(input.agentId, input.repoId),
        this.repo.agentAttachmentTotal(input.agentId),
        this.repo.scannedPaths(input.repoId),
        resolveContextSettings(this.container, input.workspaceId),
      ]);

      const set = effectiveSet(own, bound);
      if (set.length === 0) {
        // Attached, but to a DIFFERENT repository. No section, and a reason in
        // the log — never a same-named file from the repository being reviewed,
        // which is the substitution this branch exists to refuse.
        if (total > 0) {
          return nothing(
            `Project context: this agent attaches ${total} document(s), but none for ` +
              `${input.repo.owner}/${input.repo.name} — reviewing without the section`,
          );
        }
        return nothing(undefined);
      }

      const scannedPaths = new Set(scanned);
      const candidates: BudgetCandidate[] = [];
      for (const doc of set) {
        candidates.push(await this.readCandidate(input.repo, doc.path, scannedPaths));
      }

      const { blocks, results } = selectWithinBudget(candidates, settings.budgetTokens, (text) =>
        this.container.tokenizer.count(text),
      );
      const includedPaths = results
        .filter((r) => r.status === 'included' || r.status === 'truncated')
        .map((r) => r.path);

      return { blocks, docs: results, includedPaths, note: undefined };
    } catch (err) {
      // A whole-set read failure degrades the prompt; it never fails the run.
      return nothing(`Project context unavailable — ${(err as Error).message}`);
    }
  }

  /**
   * One document, read through the port, with the reason it could not be used
   * carried as DATA rather than as a message to be matched on later.
   *
   * Deny by default, the same rule `docContent` applies to the reading pane: an
   * attachment is readable only while the scan still holds it. Without this the
   * run would keep reading a document off disk after an admin narrowed
   * `context_scan_roots` away from it — the page and the editor would call it
   * gone while every review still sent it to the model.
   *
   * `missing` and not a dropped row: the spec requires an attachment whose
   * document is no longer there to STAY in the list and report itself, and
   * `missing` is the word the editor already uses for the same condition — a
   * saved path the current scan does not hold.
   *
   * The bundle refusal is here and not only in the scan because `AC-107` is a
   * property of the assembled prompt, not of `repo_docs`: a row under
   * `.devdigest/skills/` written before the exclusion existed, or by any writer
   * of that table added later, is still in `scannedPaths` and would still be
   * read. `refused` and not `missing`, because the file is there and the answer
   * is that this feature will not send it — the same word the sanitiser above
   * uses for the same kind of no.
   */
  private async readCandidate(
    repo: { owner: string; name: string },
    path: string,
    scannedPaths: ReadonlySet<string>,
  ): Promise<BudgetCandidate> {
    // The stored path was sanitised when it was saved; re-checking it here costs
    // one string scan and closes the gap left by any other writer of the table.
    if (!sanitizeDocPath(path)) return { path, failure: 'refused' };
    if (isExcludedBundlePath(path)) return { path, failure: 'refused' };
    if (!scannedPaths.has(path)) return { path, failure: 'missing' };
    let text: string;
    try {
      text = await this.container.git.readFile(repo, path, MAX_DOC_BYTES);
    } catch (err) {
      if (err instanceof CloneReadError) {
        return { path, failure: err.reason === 'not_found' ? 'missing' : 'refused' };
      }
      return { path, failure: 'missing' };
    }
    // A decoded body holding U+0000 is not a document. It also cannot be sent:
    // a NUL in a prompt has already failed a run in this repo once.
    if (text.includes('\u0000')) return { path, failure: 'binary' };
    // Truncate BEFORE the engine wraps it — never after. Reversing that order
    // eventually cuts the closing fence off and hands everything after it to
    // attacker-controlled text.
    return { path, rendered: renderDoc(path, truncateCodePoints(text, MAX_DOC_CHARS)) };
  }

  // -------------------------------------------------------------------------
  // Tenancy and input
  // -------------------------------------------------------------------------

  private async requireRepo(workspaceId: string, repoId: string): Promise<ContextRepoRef> {
    const repo = await this.repo.repoById(workspaceId, repoId);
    // 404, not 403: answering differently for a repo that exists elsewhere
    // confirms the id, which is the leak the scoping exists to close.
    if (!repo) throw new NotFoundError('Repository not found');
    return repo;
  }

  /**
   * Tenancy BEFORE any write. A link table's foreign key proves the agent and
   * the repo exist; it says nothing about whose workspace they are in, and a
   * cross-tenant attachment would put another workspace's document into this
   * one's prompts.
   */
  private async assertAgentAndRepo(
    workspaceId: string,
    agentId: string,
    repoId: string,
  ): Promise<void> {
    const [agent, repo] = await Promise.all([
      this.repo.agentInWorkspace(workspaceId, agentId),
      this.repo.repoInWorkspace(workspaceId, repoId),
    ]);
    if (!agent) throw new NotFoundError('Agent not found');
    if (!repo) throw new NotFoundError('Repository not found');
  }

  private async assertSkillAndRepo(
    workspaceId: string,
    skillId: string,
    repoId: string,
  ): Promise<void> {
    const [skill, repo] = await Promise.all([
      this.repo.skillInWorkspace(workspaceId, skillId),
      this.repo.repoInWorkspace(workspaceId, repoId),
    ]);
    if (!skill) throw new NotFoundError('Skill not found');
    if (!repo) throw new NotFoundError('Repository not found');
  }

  /**
   * Reject the WHOLE request on the first bad path, then de-duplicate.
   *
   * Rejecting wholesale rather than dropping the offender is the point: a save
   * that silently stores a different set from the one it was sent is a worse
   * outcome than an error, because the editor will show it as saved.
   */
  private cleanPaths(paths: string[]): string[] {
    const clean: string[] = [];
    for (const raw of paths) {
      const path = sanitizeDocPath(raw);
      if (!path) {
        throw new AppError('invalid_path', `Not a repo-relative .md path: ${raw}`, 400);
      }
      clean.push(path);
    }
    return dedupePaths(clean);
  }
}

/**
 * A scan in flight outranks both outcomes, then `failed` only when the failure
 * is NEWER than the last success.
 *
 * `scanningAt` is read first because a rescan is exactly the case where a
 * previous result is still on the row: reading the outcome columns first would
 * report `scanned` while a scan was running, which is the stale answer the page
 * must not show.
 *
 * A claim OLDER than `SCAN_CLAIM_STALE_MS` is ignored ENTIRELY — including by
 * the fallback, which is the case a previous success used to hide. Both outcomes
 * clear the column, so only a process that died mid-scan leaves one behind; a
 * repo whose FIRST scan died that way has no success to fall back on, and
 * answering `scanning` for it polled forever and kept the Rescan button
 * disabled, with no way out of the page at all.
 *
 * `failed` is what a stranded first scan reports instead. Nothing completed and
 * nothing ever will — no process is behind the claim — so the one thing the
 * state must not say is that a scan is running. `docsPage` enqueues a fresh one
 * when it sees the same row.
 */
function scanState(
  scan: {
    scannedAt: Date | null;
    scanningAt: Date | null;
    lastErrorAt: Date | null;
  },
  now: number = Date.now(),
): ContextScanState {
  if (scan.scanningAt && !claimIsStale(scan.scanningAt, now)) return 'scanning';
  if (scan.lastErrorAt && (!scan.scannedAt || scan.lastErrorAt > scan.scannedAt)) return 'failed';
  return scan.scannedAt ? 'scanned' : 'failed';
}

/** A claim old enough that no process can still be behind it. */
function claimIsStale(scanningAt: Date | null, now: number = Date.now()): boolean {
  return scanningAt !== null && now - scanningAt.getTime() >= SCAN_CLAIM_STALE_MS;
}

function indexByPath(records: ContextDocRecord[]): Map<string, ContextDocRecord> {
  return new Map(records.map((record) => [record.path, record]));
}

/**
 * The last segment of a client-supplied filename, on either separator.
 *
 * `path.basename` is deliberately NOT used: it follows the platform separator,
 * so on POSIX it hands `..\..\evil.md` back unchanged — one string, no
 * directories, and a name a Windows client would then resolve as a path. A
 * browser decides what it puts in a `Content-Disposition` filename, so both
 * separators are stripped here. A name that is nothing but separators and dots
 * comes back empty and fails the `.md` check that follows.
 */
function baseName(filename: string): string {
  const segments = filename.replaceAll('\\', '/').split('/');
  const last = segments[segments.length - 1] ?? '';
  return last === '.' || last === '..' ? '' : last;
}

/** A zone refusal, in the words of the mode that produced it. Always a 400. */
function zoneError(refusal: WriteZoneRefusal, mode: WriteMode): AppError {
  switch (refusal) {
    case 'outside_devdigest':
      return new AppError(
        'invalid_path',
        `A new ${mode === 'folder' ? 'folder' : 'document'} must be under ${DEVDIGEST_ROOT}/`,
        400,
      );
    case 'ci_bundle':
      // Named, not generic: the folder exists and is writable, so "not under a
      // scan root" would be a lie and "already exists" would be a different
      // conversation. What is true is that an export owns these two folders.
      return new AppError(
        'invalid_path',
        `${bundleFolders()} hold the exported CI bundle, which DevDigest generates — a ` +
          'document there is not project context and no review reads it',
        400,
      );
    // No `default`: the declared return type is what makes a new refusal a
    // compile error here rather than a generic message in production.
    case 'outside_roots':
      return new AppError('invalid_path', 'That path is not under a configured scan root', 400);
  }
}

/**
 * A port refusal → the status the contract promises.
 *
 * Every reason maps to a DIFFERENT answer, and the mapping is here rather than
 * in the adapter because the adapter has no opinion about HTTP. `exists` is a
 * 409 and not a 400: the request was well formed and the caller may want to
 * choose another name, which is a different conversation from "that path is not
 * allowed". Anything that is not a `CloneWriteError` is rethrown untouched — an
 * EACCES or an ENOSPC is a server fault and must not be dressed up as the
 * caller's mistake.
 */
function writeError(err: unknown): unknown {
  if (!(err instanceof CloneWriteError)) return err;
  switch (err.reason) {
    case 'exists':
      return new AppError('already_exists', 'A file already exists at that path', 409);
    case 'too_large':
      return new AppError('too_large', 'The document is too large', 400);
    default:
      // `outside_clone`, `git_dir` and `symlink` are all the same news to the
      // caller: the path they named is not one this feature will write.
      return new AppError('invalid_path', 'That path cannot be written in this repository', 400);
  }
}

/** `.devdigest/skills/ and .devdigest/agents/`, from the one list that defines them. */
function bundleFolders(): string {
  return EXCLUDED_DEVDIGEST_SUBROOTS.map((sub) => `${DEVDIGEST_ROOT}/${sub}/`).join(' and ');
}

/** An ISO-8601 string from the port → a `Date`, or null if it is not one. */
function parseIso(iso: string): Date | null {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * `tokens` is null and `missing` true for a saved path the current scan does not
 * hold — an attachment survives a clone that is still in flight, and shows its
 * path without a size rather than disappearing.
 */
function toAttached(
  path: string,
  position: number,
  byPath: Map<string, ContextDocRecord>,
): AttachedContextDoc {
  const record = byPath.get(path);
  return {
    path,
    position,
    tokens: record?.tokens ?? null,
    missing: record === undefined,
  };
}
