import { z } from 'zod';
import type {
  PrMeta,
  PrDetail,
  IssueMeta,
  PrReviewComment,
} from './contracts/platform.js';

/**
 * Adapter interfaces. ALL external calls go behind these interfaces.
 * Real implementations live in `apps/api/src/adapters/*`; mock implementations
 * live alongside for tests/dev (Services depend on the interface, not the impl).
 */

// ---------- LLM ----------
export const ModelInfo = z.object({
  id: z.string(),
  provider: z.enum(['openai', 'anthropic', 'openrouter']),
  label: z.string().nullish(),
  created: z.number().int().nullish(),
  /** Pricing in USD per 1M tokens (when the provider exposes it, e.g. OpenRouter). */
  pricing: z
    .object({ promptPerM: z.number(), completionPerM: z.number() })
    .nullish(),
  /** Max context window in tokens (when the provider exposes it). */
  contextLength: z.number().int().nullish(),
});
export type ModelInfo = z.infer<typeof ModelInfo>;

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CompletionRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}

export interface CompletionResult {
  text: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number | null;
}

/**
 * Structured-output request. `schema` is a Zod schema; `schemaName` names the
 * tool / json_schema. `maxRetries` controls reprompt-on-error.
 */
export interface StructuredRequest<T> {
  model: string;
  schema: z.ZodType<T>;
  schemaName: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  maxRetries?: number;
  /**
   * OpenRouter session id — groups related generations (e.g. all map-reduce
   * chunks of one review) into a session in the OpenRouter dashboard. Sent as
   * the `session_id` body field; ignored by providers that don't support it.
   */
  sessionId?: string;
  /**
   * Whether the model may spend reasoning tokens on this call. ABSENT BY
   * DEFAULT — omitting it leaves every existing call exactly as it was, and the
   * model's own default applies. Only `false` is acted on, and only on
   * OpenRouter (`reasoning: { enabled: false }`).
   *
   * Turn it off for a short extraction: reasoning tokens bill at the output
   * rate and buy nothing. Measured 2026-08-05 on the intent classifier —
   * 1078 completion tokens with reasoning on, 113 with it off, same answer.
   */
  reasoning?: boolean;
}

export interface StructuredResult<T> {
  data: T;
  model: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number | null;
  raw: string;
  attempts: number;
}

export interface LLMProvider {
  readonly id: 'openai' | 'anthropic' | 'openrouter';
  listModels(): Promise<ModelInfo[]>;
  complete(req: CompletionRequest): Promise<CompletionResult>;
  completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>>;
  embed(texts: string[]): Promise<number[][]>;
}

// ---------- Embedder ----------
export interface Embedder {
  /** OpenAI text-embedding-3-small → 1536 dims. */
  embed(texts: string[]): Promise<number[][]>;
  readonly dims: number;
}

// ---------- GitHub (Octokit REST, thin) ----------
export interface RepoRef {
  owner: string;
  name: string;
}

export interface GitHubReviewPayload {
  body: string;
  event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT';
  comments?: { path: string; line: number; body: string }[];
}

/** Create one standalone inline review comment (or a reply to a thread). */
export interface CreateReviewCommentInput {
  /** Head commit the comment pins to (GitHub requires commit_id). */
  commitId: string;
  path: string;
  line: number;
  side?: 'LEFT' | 'RIGHT';
  body: string;
  /** When set, post as a reply to that comment's thread instead of a new one. */
  inReplyTo?: number;
}

export interface OpenPrPayload {
  title: string;
  head: string;
  base: string;
  body: string;
}

/** A single file to write in a commit (path relative to repo root + UTF-8 text). */
export interface CommitFile {
  path: string;
  contents: string;
}

export interface CommitFilesPayload {
  /** Branch to create-or-update with the commit (e.g. "devdigest/ci"). */
  branch: string;
  /** Base branch to fork from when `branch` does not yet exist (e.g. "main"). */
  base: string;
  message: string;
  files: CommitFile[];
  /**
   * Paths removed by the SAME commit that writes `files` (AC-146).
   *
   * One commit and not two, so the repository is never briefly left with two
   * workflows for one agent or with none. A path that the parent commit does
   * not carry is skipped rather than refused: the caller asks for a state, not
   * for a diff, and it has no way to know what the target repository holds.
   */
  deletions?: string[];
}

/**
 * One GitHub Actions workflow run, as the ingest sees it.
 *
 * Every field an ingested `ci_runs` row is keyed or attributed by comes from
 * HERE, never from the artifact body: the artifact is written inside the target
 * repository and is not trusted to say which run, which commit or which PR it
 * belongs to.
 */
export interface WorkflowRunRef {
  id: number;
  head_sha: string;
  status: string;
  conclusion: string | null;
  /** The PR this run was triggered for, when GitHub reported one. */
  pr_number: number | null;
  html_url: string;
  run_started_at: string | null;
  updated_at: string | null;
  /** "owner/name", as GitHub reported it for the run. */
  repository: string;
}

/** One artifact attached to a workflow run. */
export interface WorkflowArtifactRef {
  id: number;
  name: string;
  size_in_bytes: number;
  expired: boolean;
}

export interface GitHubClient {
  listPullRequests(repo: RepoRef): Promise<PrMeta[]>;
  getPullRequest(repo: RepoRef, n: number): Promise<PrDetail>;
  postReview(repo: RepoRef, n: number, review: GitHubReviewPayload): Promise<{ id: string }>;
  /** List inline review comments on a PR (for the "Files changed" tab). */
  listReviewComments(repo: RepoRef, n: number): Promise<PrReviewComment[]>;
  /** Create one inline review comment (or reply) on a PR; returns the new comment. */
  createReviewComment(
    repo: RepoRef,
    n: number,
    input: CreateReviewCommentInput,
  ): Promise<PrReviewComment>;
  openPullRequest(repo: RepoRef, payload: OpenPrPayload): Promise<{ url: string }>;
  /**
   * Commit `files` onto `branch` as ONE atomic commit (Git Data API: blobs →
   * tree → commit → ref). Creates the branch from `base` if missing, else
   * fast-forwards it. Idempotent: re-publishing just adds a new commit.
   */
  commitFiles(repo: RepoRef, payload: CommitFilesPayload): Promise<{ branch: string }>;
  /** The open PR whose head is `branch`, if any (so re-publish reuses it). */
  findOpenPr(repo: RepoRef, branch: string): Promise<{ url: string } | null>;
  /**
   * Runs of ONE workflow file (e.g. "devdigest-review-security-reviewer.yml"),
   * newest first, or `null` when the repository has no such workflow.
   *
   * Scoping to the file is what keeps the ingest from reading runs of workflows
   * DevDigest did not generate. Since the file name carries the agent's slug
   * (AC-135) it also scopes the runs to ONE agent.
   *
   * `null` IS THE ANSWER, not a failure: "Actions does not know this workflow"
   * is what tells the CI tab that an installation cannot be confirmed (AC-147),
   * and it has to be distinguishable from "the token cannot read this
   * repository", which is a failed poll and must leave `last_polled_at` alone
   * (AC-129). An empty array is a third, different thing — the workflow exists
   * and has not run yet.
   */
  listWorkflowRuns(
    repo: RepoRef,
    workflowFile: string,
    opts?: { perPage?: number },
  ): Promise<WorkflowRunRef[] | null>;
  /** Artifacts attached to one workflow run. */
  listRunArtifacts(repo: RepoRef, runId: number): Promise<WorkflowArtifactRef[]>;
  /**
   * Download one artifact as its zip archive.
   *
   * `maxBytes` is a parameter and not the caller's business afterwards: the
   * implementation refuses an over-sized artifact BEFORE the bytes are held,
   * the way `parseSkillArchive` budgets inside fflate's filter. A caller that
   * downloaded first and measured second has already paid the memory.
   */
  downloadArtifact(repo: RepoRef, artifactId: number, maxBytes: number): Promise<Uint8Array>;
  getIssue(repo: RepoRef, n: number): Promise<IssueMeta>;
  /** GET /user — for "posting as @user". */
  currentLogin(): Promise<string>;
}

// ---------- Git (simple-git, heavy) ----------
export interface CloneOptions {
  depth?: number;
  branch?: string;
}

export interface DiffHunk {
  file: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  /** Lines present in the *new* file covered by this hunk (for grounding). */
  newLineNumbers: number[];
}

export interface UnifiedDiff {
  raw: string;
  files: { path: string; additions: number; deletions: number; hunks: DiffHunk[] }[];
}

export interface BlameLine {
  line: number;
  sha: string;
  author: string;
  date: string;
  summary: string;
}

export interface GitCommit {
  sha: string;
  message: string;
  author: string;
  date: string;
}

/** One file found by a clone walk. `modified_at` is an ISO-8601 string. */
export interface ClonedFile {
  path: string;
  size_bytes: number;
  modified_at: string;
}

/** Why a bounded clone read produced nothing. */
export type CloneReadRefusal = 'outside_clone' | 'git_dir' | 'not_found';

/**
 * A clone read that did not happen, with the reason as DATA.
 *
 * Matching on an `Error` message to tell "this file is not in the clone" from
 * "the reader refused to leave the clone" is a distinction the next refactor
 * silently inverts, and the two are reported to a user as different statuses.
 * The class imports nothing, so `contracts-stay-pure` holds.
 */
export class CloneReadError extends Error {
  constructor(
    readonly reason: CloneReadRefusal,
    message: string,
  ) {
    super(message);
    this.name = 'CloneReadError';
  }
}

/**
 * Why a bounded clone WRITE did not happen.
 *
 * The first three are the read's refusals restated for a write, because a write
 * escapes the clone in exactly the same three ways. The last two are the write's
 * own: a create must not silently replace something (`exists`), and the size has
 * to be refused before anything is allocated or opened (`too_large`).
 */
export type CloneWriteRefusal = 'outside_clone' | 'git_dir' | 'symlink' | 'exists' | 'too_large';

/**
 * A clone write that did not happen, with the reason as DATA — the same shape
 * and the same argument as `CloneReadError`. The service maps each reason to a
 * different status code, and matching on a message to do that is a distinction
 * the next reword silently inverts.
 */
export class CloneWriteError extends Error {
  constructor(
    readonly reason: CloneWriteRefusal,
    message: string,
  ) {
    super(message);
    this.name = 'CloneWriteError';
  }
}

export interface GitClient {
  clone(repo: RepoRef, url: string, opts?: CloneOptions): Promise<{ path: string }>;
  fetchPullHead(repo: RepoRef, n: number): Promise<void>;
  /**
   * Resync an already-cloned repo to the tip of `branch`: fetch from origin and
   * advance the local working tree to `origin/<branch>`. Unlike `clone`'s bare
   * `fetch` (which only moves remote-tracking refs), this moves local HEAD so a
   * subsequent index reflects the latest code. Returns the new HEAD sha.
   */
  sync(repo: RepoRef, branch: string): Promise<{ head: string }>;
  currentHead(repo: RepoRef): Promise<string>;
  diff(repo: RepoRef, base: string, head: string): Promise<UnifiedDiff>;
  /**
   * Names of files changed between two commits (`git diff --name-only base..head`).
   * Two-dot form is intentional — we want files reachable from `head` but not `base`,
   * matching the incremental indexer's "what moved since last_indexed_sha?" semantics.
   * Returns an empty array when the two refs resolve to the same commit.
   */
  diffNameOnly(repo: RepoRef, base: string, head: string): Promise<string[]>;
  blame(repo: RepoRef, path: string): Promise<BlameLine[]>;
  log(repo: RepoRef, path?: string): Promise<GitCommit[]>;
  /**
   * Read one file out of the clone, bounded at `maxBytes` by the read itself.
   *
   * The bound is a required argument, not an option with a default. Every path
   * this port is handed names repo content, which is attacker-controlled for an
   * imported public repo, and a cap the caller applies to the returned string
   * runs only once the whole file is already in memory — too late for a repo
   * that committed a 400 MB `plan.md`. Bytes rather than characters because
   * bytes are what a read can bound; callers still truncate to their own
   * character budget afterwards.
   */
  readFile(repo: RepoRef, path: string, maxBytes: number): Promise<string>;
  /**
   * List files under `roots` inside the clone, bounded on every axis a walk over
   * attacker-controlled repo content can be unbounded on.
   *
   * Every bound is a required argument for the same reason `readFile`'s is: an
   * imported public repo decides how many files it commits, how deep it nests
   * them, and how large each one is. A root that does not resolve inside the
   * clone contributes nothing; a root that does not exist is not an error, it is
   * simply empty. `bounded` reports that `maxFiles` fired and the list is a
   * prefix of what is on disk.
   *
   * ORDER: shallowest first, then by path, posix-style throughout. Reproducible
   * across runs, which is what makes "first N when bounded" a stable answer —
   * and DEPTH FIRST because a plain alphabetical sort turns `maxFiles` into an
   * alphabetical slice. A repository with 65 `apps/aNNN/package.json` loses its
   * root `package.json` to a ceiling of 64, since `apps/` sorts before it;
   * raising the ceiling only moves that cut, while ordering by depth removes it.
   * What a ceiling drops is then the deepest, i.e. the least likely to be what a
   * caller asking a whole-clone question came for.
   *
   * `excludedDirs` names the directory names the walk refuses to descend. It is
   * RETURNED rather than exported as a constant because it is a fact only the
   * adapter knows: a caller that has to disclose where a scan did not look would
   * otherwise keep its own copy of the list, which nothing but a test can hold
   * straight.
   *
   * A missing clone directory THROWS — the caller maps that to "no clone yet",
   * which is a different answer from "the clone has no documents".
   */
  listFiles(
    repo: RepoRef,
    opts: {
      roots: string[];
      /** Lower-cased, dot-prefixed, e.g. `['.md']`. Matched case-insensitively. */
      extensions: string[];
      /**
       * Exact file NAMES, case-sensitive, e.g. `['package.json']`. A file matches
       * when its extension is in `extensions` OR its name is in `names`. Absent =
       * extensions only.
       *
       * It is a separate option because a manifest is a name, not an extension:
       * `package.json` has the extension `.json`, and asking for `.json` returns
       * `tsconfig.json`, `package-lock.json` and every JSON fixture the
       * repository committed — on a repo of any size the manifests are a handful
       * among hundreds. The match is case-sensitive because npm's is: a file
       * called `Package.json` is not a package manifest.
       */
      names?: string[];
      /**
       * Directory depth below each root that is still descended. 0 = the root
       * directory itself only. Absent = no limit, which is what every caller
       * before this had. Counted per root, so two roots do not share a budget.
       */
      maxDepth?: number;
      /**
       * Counts MATCHES, never files visited: the slice happens after the filter.
       *
       * A ceiling applied before the filter answers a different question. Twelve
       * files off a walk that has not filtered yet can be twelve `.json` fixtures
       * that sorted first and not one manifest, so a repository with five
       * packages reports zero.
       */
      maxFiles: number;
      maxFileBytes: number;
    },
  ): Promise<{ files: ClonedFile[]; bounded: boolean; excludedDirs: string[] }>;
  /**
   * Write one UTF-8 text file into the clone, refusing anything that resolves
   * outside it, into its git directory, or THROUGH a symbolic link.
   *
   * A write is not a read with the arrow reversed. A read that follows a symlink
   * out of the clone leaks a file; a write that follows one CREATES a file
   * wherever the link points — `.devdigest/x.md` → `../../.git/config` replaces
   * the remote URL that carries the stored PAT. So this refuses a symlinked
   * component outright rather than resolving it, which is the stance the walk in
   * `listFiles` already takes for every directory it descends.
   *
   * `maxBytes` is a required option for the same reason `readFile`'s bound is:
   * the caller's character cap runs one step too late for an allocation, and
   * bytes are what a write is measured in.
   *
   * `overwrite: false` is what makes a create atomic against a concurrent one —
   * the existence check and the creation are one syscall, so "does it exist?"
   * followed by "then write it" cannot interleave. `exists` comes back as a
   * refusal rather than as a silent replacement.
   *
   * Returns the size and mtime the write produced, so the caller can persist a
   * row without a second stat — which would otherwise be a second chance for the
   * path to have become something else.
   */
  writeFile(
    repo: RepoRef,
    path: string,
    content: string,
    opts: { maxBytes: number; overwrite: boolean },
  ): Promise<{ size_bytes: number; modified_at: string }>;
  /**
   * Create a directory inside the clone, parents included.
   *
   * The same containment walk as `writeFile`: a directory created through a
   * symlinked component lands outside the clone just as a file does. Creating
   * one that already exists is not an error — `mkdir -p` semantics — because the
   * caller's "already exists" answer is about the DOCUMENT list, and is decided
   * before this is reached.
   */
  makeDir(repo: RepoRef, path: string): Promise<void>;
  clonePathFor(repo: RepoRef): string;
}

// ---------- CodeIndex (ripgrep + tree-sitter) ----------
export interface CodeMatch {
  path: string;
  line: number;
  text: string;
}

export interface CodeSymbol {
  path: string;
  name: string;
  kind: string;
  line: number;
}

export interface CodeReference {
  fromPath: string;
  toSymbol: string;
  line: number;
}

export interface CodeIndex {
  grep(repo: RepoRef, pattern: string): Promise<CodeMatch[]>;
  symbols(repo: RepoRef): Promise<CodeSymbol[]>;
  references(repo: RepoRef, symbol: string): Promise<CodeReference[]>;
}

// ---------- Auth (pluggable; MVP = LocalNoAuthProvider) ----------
export interface AuthUser {
  id: string;
  email: string;
  name: string;
}

export interface AuthWorkspace {
  id: string;
  name: string;
}

export interface AuthProvider {
  currentUser(req: unknown): Promise<AuthUser>;
  currentWorkspace(req: unknown): Promise<AuthWorkspace>;
}

// ---------- Secrets (pluggable; MVP = LocalSecretsProvider) ----------
export type SecretKey =
  | 'OPENAI_API_KEY'
  | 'ANTHROPIC_API_KEY'
  | 'GITHUB_TOKEN'
  | 'DATABASE_URL'
  | (string & {});

export interface SecretsProvider {
  get(key: SecretKey): Promise<string | undefined>;
  /**
   * Persist a secret (BYO key entered via the UI). Optional — read-only
   * providers (e.g. the env-only MVP backend) may omit it.
   */
  set?(key: SecretKey, value: string): Promise<void>;
}

// ---------- Skill fetch (importing a skill from a URL) ----------
export interface FetchedMarkdown {
  text: string;
  /** The URL actually read, after redirects — echoed into the import preview. */
  finalUrl: string;
  bytes: number;
}

export interface SkillFetcher {
  /**
   * GET a remote markdown document.
   *
   * The address is supplied by a user and fetched from inside the network, so
   * the implementation — not the caller — is responsible for refusing anything
   * that is not plainly public https text: private and link-local ranges,
   * redirects that leave public space, oversized bodies, and non-text replies.
   */
  fetchMarkdown(url: string): Promise<FetchedMarkdown>;
}

// ---------- Prompt templates (instruction text kept out of the code) ----------
export interface PromptTemplates {
  /**
   * Load the named instruction template and interpolate its `{{var}}`
   * placeholders in one step.
   *
   * A port because the implementation reads the filesystem, which a service may
   * not do. `no-fs-in-service` matches a direct `node:fs` edge only, so a
   * service reaching a loader module that reads for it passes the rule and still
   * breaks it — this port is the part the rule cannot see.
   *
   * `name` is a template filename, never user input.
   */
  render(name: string, vars: Record<string, string>): Promise<string>;
}

// ---------- Runner bundle (the generated `.devdigest/runner.mjs`) ----------
export interface RunnerBundleInfo {
  contents: string;
  /** Runner version, as the bundle's build stamped it. */
  version: string;
  /** Commit SHA the bundle was built from. */
  sourceSha: string;
  bytes: number;
}

/**
 * The built agent-runner bundle, read from disk.
 *
 * A port for the same reason `PromptTemplates` is one: the implementation reads
 * the filesystem and the service that needs the bytes may not, and
 * `no-fs-in-service` only sees a direct `node:fs` edge.
 */
export interface RunnerBundle {
  read(): Promise<RunnerBundleInfo>;
}
