import type { z } from 'zod';
import type {
  LLMProvider,
  ModelInfo,
  CompletionRequest,
  CompletionResult,
  StructuredRequest,
  StructuredResult,
  Embedder,
  GitHubClient,
  RepoRef,
  PrMeta,
  PrDetail,
  GitHubReviewPayload,
  CreateReviewCommentInput,
  PrReviewComment,
  OpenPrPayload,
  CommitFilesPayload,
  IssueMeta,
  GitClient,
  CloneOptions,
  ClonedFile,
  CloneReadRefusal,
  CloneWriteRefusal,
  UnifiedDiff,
  BlameLine,
  GitCommit,
  CodeIndex,
  CodeMatch,
  CodeSymbol,
  CodeReference,
  AuthProvider,
  AuthUser,
  AuthWorkspace,
  SecretsProvider,
  SecretKey,
  SkillFetcher,
  FetchedMarkdown,
  PromptTemplates,
  WorkflowRunRef,
  WorkflowArtifactRef,
  RunnerBundle,
  RunnerBundleInfo,
} from '@devdigest/shared';
import { ValidationError } from '../platform/errors.js';
import { CloneReadError, CloneWriteError } from '@devdigest/shared';
import { parseUnifiedDiff } from './git/diff-parser.js';
import { refuseOversizedDownload, refuseUnusableArtifact } from './github/artifact-guard.js';
import { EXCLUDED_WALK_DIRS } from './git/constants.js';
import { byDepthThenPath } from './git/order.js';

/**
 * Deterministic MOCK adapters for tests/dev — NO real network. Each mirrors the
 * adapter interface. The mock LLM returns a caller-supplied fixture (or a default)
 * for completeStructured, so review/grounding flows can be tested end-to-end.
 */

// ---------- Mock LLM ----------
export interface MockLLMOptions {
  models?: ModelInfo[];
  /** Fixture returned by completeStructured (validated against the schema). */
  structured?: unknown;
  /**
   * Per-schemaName fixtures for multi-call flows (e.g. the conventions 2-step
   * dialogue: 'ConventionFileSelection' then 'ConventionExtraction'). Looked up
   * by req.schemaName; falls back to `structured` when no entry matches.
   */
  structuredBySchema?: Record<string, unknown>;
  completionText?: string;
  embedding?: number[];
}

export class MockLLMProvider implements LLMProvider {
  readonly id: 'openai' | 'anthropic';
  public calls: { method: string; req: unknown }[] = [];

  constructor(
    id: 'openai' | 'anthropic' = 'openai',
    private opts: MockLLMOptions = {},
  ) {
    this.id = id;
  }

  async listModels(): Promise<ModelInfo[]> {
    this.calls.push({ method: 'listModels', req: null });
    return (
      this.opts.models ?? [
        { id: 'gpt-4.1', provider: this.id === 'anthropic' ? 'anthropic' : 'openai' },
      ]
    );
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    this.calls.push({ method: 'complete', req });
    return {
      text: this.opts.completionText ?? 'mock completion',
      model: req.model,
      tokensIn: 100,
      tokensOut: 50,
      costUsd: 0.001,
    };
  }

  async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    this.calls.push({ method: 'completeStructured', req });
    const fixture = this.opts.structuredBySchema?.[req.schemaName] ?? this.opts.structured ?? {};
    const parsed = (req.schema as z.ZodType<T>).safeParse(fixture);
    if (!parsed.success) {
      throw new Error(`MockLLMProvider fixture failed schema: ${parsed.error.message}`);
    }
    return {
      data: parsed.data,
      model: req.model,
      tokensIn: 100,
      tokensOut: 50,
      costUsd: 0.001,
      raw: JSON.stringify(fixture),
      attempts: 1,
    };
  }

  async embed(texts: string[]): Promise<number[][]> {
    this.calls.push({ method: 'embed', req: texts });
    return texts.map(() => this.opts.embedding ?? new Array(1536).fill(0));
  }
}

// ---------- Mock Embedder ----------
export class MockEmbedder implements Embedder {
  readonly dims = 1536;
  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((_, i) => new Array(1536).fill(0).map((_, j) => (i + j) % 2));
  }
}

// ---------- Mock GitHub ----------
export interface MockGitHubOptions {
  pulls?: PrMeta[];
  detail?: Partial<PrDetail>;
  login?: string;
  /** Existing inline review comments returned by listReviewComments. */
  comments?: PrReviewComment[];
  /** Runs returned by `listWorkflowRuns` for any file not named below, newest first. */
  workflowRuns?: WorkflowRunRef[];
  /**
   * Per-file answers, keyed by workflow file name — `null` means the repository
   * has no such workflow, which is what the ingest reads as "this installation
   * cannot be confirmed" (AC-147).
   *
   * Needed because workflow files are per-agent (AC-135): a test with two agents
   * in one repository has to give two different answers to one mock.
   */
  runsByWorkflow?: Record<string, WorkflowRunRef[] | null>;
  /** Artifacts per workflow-run id; a run absent from the map has none. */
  runArtifacts?: Record<number, WorkflowArtifactRef[]>;
  /** Archive bytes per artifact id; an artifact absent from the map has none. */
  artifactZips?: Record<number, Uint8Array>;
  /**
   * Every Actions call throws this instead of answering — the "the token
   * cannot read this repository's Actions" path, which is the only way a
   * caller's failure handling can be exercised.
   */
  actionsError?: Error;
}

export class MockGitHubClient implements GitHubClient {
  public posted: { n: number; review: GitHubReviewPayload }[] = [];
  public openedPrs: OpenPrPayload[] = [];
  public committed: CommitFilesPayload[] = [];
  public createdComments: CreateReviewCommentInput[] = [];
  /** Workflow files whose runs were asked for, in order. */
  public polledWorkflows: { repo: string; workflowFile: string }[] = [];
  /** Artifact ids whose bytes were HANDED BACK — a refused download records nothing. */
  public downloadedArtifacts: number[] = [];

  constructor(private opts: MockGitHubOptions = {}) {}

  async listPullRequests(_repo: RepoRef): Promise<PrMeta[]> {
    return (
      this.opts.pulls ?? [
        {
          number: 482,
          title: 'Add rate limiting to public API endpoints',
          author: 'marisa.koch',
          branch: 'feat/rate-limit-public',
          base: 'main',
          head_sha: 'a1b2c3d4',
          additions: 247,
          deletions: 38,
          files_count: 9,
          status: 'open',
          opened_at: '2026-06-01T00:00:00Z',
          updated_at: '2026-06-01T03:00:00Z',
        },
      ]
    );
  }

  async getPullRequest(_repo: RepoRef, n: number): Promise<PrDetail> {
    const base: PrDetail = {
      number: n,
      title: 'Add rate limiting to public API endpoints',
      author: 'marisa.koch',
      branch: 'feat/rate-limit-public',
      base: 'main',
      head_sha: 'a1b2c3d4',
      additions: 247,
      deletions: 38,
      files_count: 9,
      status: 'open',
      body: 'Add rate limiting. Closes #471.',
      files: [
        {
          path: 'src/config.ts',
          additions: 4,
          deletions: 0,
          patch: '@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "sk_live_xxx",\n   redisUrl: x,',
        },
      ],
      commits: [
        { sha: 'a1b2c3d4', message: 'Add limiter', author: 'marisa.koch', committed_at: null },
      ],
      linked_issue: null,
    };
    return { ...base, ...this.opts.detail };
  }

  async postReview(_repo: RepoRef, n: number, review: GitHubReviewPayload): Promise<{ id: string }> {
    this.posted.push({ n, review });
    return { id: `mock-review-${n}` };
  }

  async listReviewComments(_repo: RepoRef, _n: number): Promise<PrReviewComment[]> {
    return this.opts.comments ?? [];
  }

  async createReviewComment(
    _repo: RepoRef,
    _n: number,
    input: CreateReviewCommentInput,
  ): Promise<PrReviewComment> {
    this.createdComments.push(input);
    return {
      id: this.createdComments.length,
      path: input.path,
      line: input.line,
      original_line: input.line,
      side: input.side ?? 'RIGHT',
      body: input.body,
      user: this.opts.login ?? 'mock-user',
      created_at: '2026-06-01T00:00:00Z',
      html_url: `https://github.com/mock/mock/pull/1#discussion_r${this.createdComments.length}`,
      in_reply_to_id: input.inReplyTo ?? null,
      is_outdated: false,
    };
  }

  async openPullRequest(_repo: RepoRef, payload: OpenPrPayload): Promise<{ url: string }> {
    this.openedPrs.push(payload);
    return { url: 'https://github.com/mock/mock/pull/1' };
  }

  async commitFiles(_repo: RepoRef, payload: CommitFilesPayload): Promise<{ branch: string }> {
    this.committed.push(payload);
    return { branch: payload.branch };
  }

  async findOpenPr(_repo: RepoRef, branch: string): Promise<{ url: string } | null> {
    const pr = this.openedPrs.find((p) => p.head === branch);
    return pr ? { url: 'https://github.com/mock/mock/pull/1' } : null;
  }

  async listWorkflowRuns(
    repo: RepoRef,
    workflowFile: string,
    opts: { perPage?: number } = {},
  ): Promise<WorkflowRunRef[] | null> {
    if (this.opts.actionsError) throw this.opts.actionsError;
    this.polledWorkflows.push({ repo: `${repo.owner}/${repo.name}`, workflowFile });
    const named = this.opts.runsByWorkflow?.[workflowFile];
    if (named === null) return null;
    const runs = named ?? this.opts.workflowRuns ?? [];
    return opts.perPage ? runs.slice(0, opts.perPage) : runs;
  }

  async listRunArtifacts(_repo: RepoRef, runId: number): Promise<WorkflowArtifactRef[]> {
    if (this.opts.actionsError) throw this.opts.actionsError;
    return this.opts.runArtifacts?.[runId] ?? [];
  }

  /**
   * Refuses exactly what the Octokit adapter refuses, through the same two
   * functions — a mock that handed the bytes over regardless would make a
   * caller that forgot the cap pass its tests, and a mock with its own copy of
   * the rule drifts from the adapter with nothing asserting either.
   */
  async downloadArtifact(_repo: RepoRef, artifactId: number, maxBytes: number): Promise<Uint8Array> {
    if (this.opts.actionsError) throw this.opts.actionsError;
    const declared = Object.values(this.opts.runArtifacts ?? {})
      .flat()
      .find((a) => a.id === artifactId);
    if (declared) refuseUnusableArtifact(artifactId, declared, maxBytes);
    const bytes = this.opts.artifactZips?.[artifactId] ?? new Uint8Array();
    refuseOversizedDownload(artifactId, bytes, maxBytes);
    this.downloadedArtifacts.push(artifactId);
    return bytes;
  }

  async getIssue(_repo: RepoRef, n: number): Promise<IssueMeta> {
    return { number: n, title: `Issue #${n}`, body: 'mock issue', state: 'open' };
  }

  async currentLogin(): Promise<string> {
    return this.opts.login ?? 'mock-user';
  }
}

// ---------- Mock Git ----------
export interface MockGitOptions {
  diff?: string;
  files?: Record<string, string>;
  /** Name-only diff result (drives the incremental indexer's "changed files since X" path). */
  diffNameOnly?: string[];
  /** Override `currentHead()` so tests can simulate "sha unchanged since last index". */
  head?: string;
  /** Head `currentHead()` returns AFTER `sync()` runs — simulates fetch+reset advancing HEAD. */
  syncedHead?: string;
  /**
   * The clone's file tree for `listFiles`: repo-relative path → content. Kept
   * separate from `files` so a test can express "this path is attached but no
   * longer on disk" — the `missing` status has no other way to arise.
   */
  tree?: Record<string, string>;
  /** `readFile` throws this refusal for the named paths (symlink-out, .git/, …). */
  refuse?: Record<string, CloneReadRefusal>;
  /**
   * `writeFile` / `makeDir` throw this refusal for the named paths. Separate
   * from `refuse` because the two vocabularies are different — a write can be
   * refused for `symlink` and `exists`, which a read has no opinion about.
   */
  refuseWrite?: Record<string, CloneWriteRefusal>;
  /** `listFiles` throws — the "no clone directory" case. */
  noClone?: boolean;
}

export class MockGitClient implements GitClient {
  public cloned: { repo: RepoRef; url: string }[] = [];
  public syncs: { repo: RepoRef; branch: string }[] = [];
  /** Directories `makeDir` was asked for, in order. A folder holds no file. */
  public dirs: string[] = [];
  private syncedHead?: string;
  private tree: Record<string, string>;

  /**
   * `opts.tree` is COPIED, not held.
   *
   * `writeFile` mutates it, and a test's fixture is normally a module-level
   * constant shared by every case in the file. Holding the caller's object made
   * two clients constructed from the same fixture one clone with two names —
   * which silently broke the only test that needs them to differ ("a resync put
   * the branch's text back"), and made every later case in the file depend on
   * which earlier one had written.
   */
  constructor(private opts: MockGitOptions = {}) {
    this.tree = { ...(opts.tree ?? {}) };
  }

  clonePathFor(repo: RepoRef): string {
    return `/mock/clones/${repo.owner}/${repo.name}`;
  }
  async clone(repo: RepoRef, url: string, _opts?: CloneOptions): Promise<{ path: string }> {
    this.cloned.push({ repo, url });
    return { path: this.clonePathFor(repo) };
  }
  async fetchPullHead(): Promise<void> {}
  async sync(repo: RepoRef, branch: string): Promise<{ head: string }> {
    this.syncs.push({ repo, branch });
    // After a sync, HEAD advances to syncedHead (or stays at head if unset).
    this.syncedHead = this.opts.syncedHead ?? this.opts.head ?? 'a1b2c3d4';
    return { head: this.syncedHead };
  }
  async currentHead(): Promise<string> {
    return this.syncedHead ?? this.opts.head ?? 'a1b2c3d4';
  }
  async diffNameOnly(): Promise<string[]> {
    return this.opts.diffNameOnly ?? [];
  }
  async diff(): Promise<UnifiedDiff> {
    const raw =
      this.opts.diff ??
      'diff --git a/src/config.ts b/src/config.ts\n--- a/src/config.ts\n+++ b/src/config.ts\n@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "sk_live_xxx",\n   redisUrl: x,';
    return parseUnifiedDiff(raw);
  }
  async blame(): Promise<BlameLine[]> {
    return [{ line: 1, sha: 'a1b2c3d4', author: 'marisa.koch', date: '2026-06-01', summary: 'init' }];
  }
  async log(): Promise<GitCommit[]> {
    return [{ sha: 'a1b2c3d4', message: 'init', author: 'marisa.koch', date: '2026-06-01' }];
  }
  async readFile(_repo: RepoRef, path: string, maxBytes: number): Promise<string> {
    const refusal = this.opts.refuse?.[path];
    if (refusal) throw new CloneReadError(refusal, `mock refusal (${refusal}): ${path}`);
    const content = this.opts.files?.[path] ?? this.tree[path];
    // The real adapter cannot read a file that is not there, and the caller maps
    // that reason to its own status. A mock returning '' for a missing path is
    // how "the document vanished from the clone" becomes untestable.
    if (content === undefined) throw new CloneReadError('not_found', `not in the clone: ${path}`);
    // Honour the cap. A mock that hands back more than the real adapter would is
    // how an unbounded read passes every test and still allocates in production.
    return Buffer.from(content, 'utf8').subarray(0, maxBytes).toString('utf8');
  }

  /**
   * Answers from the tree, filtered by root, extension and name, honouring BOTH
   * caps AND `maxDepth`. A mock that returns more than the real adapter would is
   * how an unbounded read passes every test — the same reasoning as `readFile`'s,
   * and a mock that ignores `maxDepth` is how a depth bug does the same.
   *
   * `maxFiles` is applied last, after every filter, because that is where the
   * real adapter applies it: it caps matches, not files visited. The order it
   * slices is `byDepthThenPath`, imported from the adapter rather than copied,
   * because which entries a ceiling drops is exactly the behaviour a caller
   * tests against this mock.
   *
   * ONE thing here is not the real walk: `EXCLUDED_WALK_DIRS` is not applied.
   * The tree is taken as given, so a fixture path under `node_modules/` or
   * `vendor/` comes back from this mock and never from a clone. It is still
   * REPORTED in `excludedDirs`, because that field is the port's disclosure of
   * which names a real walk refuses and a caller reads it as such. Assert the
   * exclusion itself against `SimpleGitClient` (`test/git-list-files.test.ts`),
   * and do not add a second exclusion list to a module to make a mock-backed
   * test pass.
   */
  async listFiles(
    _repo: RepoRef,
    opts: {
      roots: string[];
      extensions: string[];
      names?: string[];
      maxDepth?: number;
      maxFiles: number;
      maxFileBytes: number;
    },
  ): Promise<{ files: ClonedFile[]; bounded: boolean; excludedDirs: string[] }> {
    if (this.opts.noClone) throw new Error('ENOENT: no such file or directory');
    const wanted = opts.extensions.map((e) => e.toLowerCase());
    const names = new Set(opts.names ?? []);
    const all = Object.entries(this.tree)
      .filter(([path]) => this.depthUnderRoots(path, opts.roots, opts.maxDepth) !== undefined)
      .filter(
        ([path]) =>
          names.has(path.slice(path.lastIndexOf('/') + 1)) ||
          wanted.some((ext) => path.toLowerCase().endsWith(ext)),
      )
      .map(([path, content]) => ({
        path,
        size_bytes: Buffer.byteLength(content, 'utf8'),
        modified_at: '2026-08-13T00:00:00.000Z',
      }))
      .filter((f) => f.size_bytes <= opts.maxFileBytes)
      .sort(byDepthThenPath);
    const bounded = all.length > opts.maxFiles;
    return {
      files: bounded ? all.slice(0, opts.maxFiles) : all,
      bounded,
      excludedDirs: [...EXCLUDED_WALK_DIRS],
    };
  }

  /**
   * How far a posix tree path sits below the SHALLOWEST root that claims it, or
   * `undefined` when no root does or the depth is past `maxDepth`.
   *
   * The shallowest wins because the real walk runs each root separately and
   * de-duplicates afterwards: a file two levels under `.` is zero levels under a
   * root that names its own directory, and a depth of 0 must still find it.
   * `.` and `''` claim everything — `path.join(root, '.')` is the clone root, so
   * that is the root a whole-clone walk passes.
   */
  private depthUnderRoots(path: string, roots: string[], maxDepth?: number): number | undefined {
    let best: number | undefined;
    for (const root of roots) {
      const whole = root === '.' || root === '';
      if (!whole && path !== root && !path.startsWith(`${root}/`)) continue;
      const rel = whole ? path : path.slice(root.length + 1);
      const depth = rel.split('/').length - 1;
      if (best === undefined || depth < best) best = depth;
    }
    if (best === undefined) return undefined;
    if (maxDepth !== undefined && best > maxDepth) return undefined;
    return best;
  }

  /**
   * Writes into the copied tree, so a later `listFiles` and `readFile` see the
   * document exactly as a real clone would — "created, then in the list with no
   * rescan" has no other way to be tested.
   *
   * Every bound the real adapter enforces is enforced here too: the byte cap
   * BEFORE the tree is touched, `overwrite: false` refusing an existing path,
   * and the injected refusals. A mock that accepts more than the adapter would
   * is how an unbounded write passes every test and still lands in production —
   * the same reasoning `readFile`'s cap above is written down for.
   */
  async writeFile(
    _repo: RepoRef,
    path: string,
    content: string,
    opts: { maxBytes: number; overwrite: boolean },
  ): Promise<{ size_bytes: number; modified_at: string }> {
    const refusal = this.opts.refuseWrite?.[path];
    if (refusal) throw new CloneWriteError(refusal, `mock refusal (${refusal}): ${path}`);
    const bytes = Buffer.byteLength(content, 'utf8');
    if (bytes > opts.maxBytes) {
      throw new CloneWriteError('too_large', `document is ${bytes} bytes, over ${opts.maxBytes}`);
    }
    if (!opts.overwrite && this.tree[path] !== undefined) {
      throw new CloneWriteError('exists', `already in the clone: ${path}`);
    }
    this.tree[path] = content;
    return { size_bytes: bytes, modified_at: new Date().toISOString() };
  }

  async makeDir(_repo: RepoRef, path: string): Promise<void> {
    const refusal = this.opts.refuseWrite?.[path];
    if (refusal) throw new CloneWriteError(refusal, `mock refusal (${refusal}): ${path}`);
    this.dirs.push(path);
  }
}

// ---------- Mock CodeIndex ----------
export class MockCodeIndex implements CodeIndex {
  async grep(_repo: RepoRef, pattern: string): Promise<CodeMatch[]> {
    return [{ path: 'src/config.ts', line: 12, text: `match for ${pattern}` }];
  }
  async symbols(): Promise<CodeSymbol[]> {
    return [{ path: 'src/middleware/ratelimit.ts', name: 'rateLimit', kind: 'function', line: 25 }];
  }
  async references(_repo: RepoRef, symbol: string): Promise<CodeReference[]> {
    return [{ fromPath: 'src/api/public/index.ts', toSymbol: symbol, line: 23 }];
  }
}

// ---------- Mock Auth / Secrets ----------
export class MockAuthProvider implements AuthProvider {
  constructor(
    private user: AuthUser = { id: 'u1', email: 'you@local', name: 'You' },
    private workspace: AuthWorkspace = { id: 'w1', name: 'default' },
  ) {}
  async currentUser(): Promise<AuthUser> {
    return this.user;
  }
  async currentWorkspace(): Promise<AuthWorkspace> {
    return this.workspace;
  }
}

export class MockSecretsProvider implements SecretsProvider {
  constructor(private secrets: Partial<Record<string, string>> = {}) {}
  async get(key: SecretKey): Promise<string | undefined> {
    return this.secrets[key as string];
  }
}

// ---------- Mock skill fetcher ----------
/**
 * Serves canned documents by URL. A URL with no entry throws, so a test that
 * meant to stub a fetch and did not cannot silently pass on a default body.
 */
export class MockSkillFetcher implements SkillFetcher {
  constructor(private documents: Record<string, string> = {}) {}
  async fetchMarkdown(url: string): Promise<FetchedMarkdown> {
    const text = this.documents[url];
    if (text === undefined) throw new Error(`MockSkillFetcher has no document for ${url}`);
    return { text, finalUrl: url, bytes: Buffer.byteLength(text) };
  }
}

// ---------- Mock prompt templates ----------
/**
 * Serves canned instruction text by template name, and interpolates it the same
 * way the real loader does — a test that asserts on a rendered prompt would
 * otherwise be asserting on the mock's shortcut rather than on the contract.
 *
 * An unknown name yields a marker rather than throwing: unlike a fetched URL, a
 * template name is a constant in the code under test, so a missing entry means
 * the test did not care which instructions were used.
 */
export class MockPromptTemplates implements PromptTemplates {
  constructor(private templates: Record<string, string> = {}) {}
  async render(name: string, vars: Record<string, string>): Promise<string> {
    const template = this.templates[name] ?? `[mock prompt: ${name}]`;
    return template.replace(/\{\{(\w+)\}\}/g, (whole, key: string) =>
      key in vars ? (vars[key] ?? '') : whole,
    );
  }
}

// ---------- Mock runner bundle ----------
/**
 * Serves a fixed `.devdigest/runner.mjs` without a build having run.
 *
 * `bytes` is reported rather than measured from `contents`, so a test can state
 * a size the fixture text does not have — a bundle over the size ceiling has no
 * other way to be expressed without carrying megabytes of fixture.
 */
export class MockRunnerBundle implements RunnerBundle {
  constructor(private info: Partial<RunnerBundleInfo> = {}) {}
  async read(): Promise<RunnerBundleInfo> {
    const contents = this.info.contents ?? '// mock runner bundle\n';
    return {
      contents,
      version: this.info.version ?? '0.0.0-mock',
      sourceSha: this.info.sourceSha ?? 'deadbeef',
      bytes: this.info.bytes ?? Buffer.byteLength(contents),
    };
  }
}
