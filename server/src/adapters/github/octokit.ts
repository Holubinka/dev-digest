import { Octokit } from 'octokit';
import type {
  GitHubClient,
  RepoRef,
  PrMeta,
  PrDetail,
  PrStatus,
  GitHubReviewPayload,
  CreateReviewCommentInput,
  PrReviewComment,
  OpenPrPayload,
  CommitFilesPayload,
  IssueMeta,
  WorkflowRunRef,
  WorkflowArtifactRef,
} from '@devdigest/shared';
import { ValidationError } from '../../platform/errors.js';
import { httpStatusOf as statusOf, withRetry, withTimeout } from '../../platform/resilience.js';
import { refuseOversizedDownload, refuseUnusableArtifact } from './artifact-guard.js';

const TIMEOUT = 30_000;

/** GitHub's maximum for these list endpoints; asking for more is ignored. */
const PAGE_SIZE = 100;

/**
 * Caps on how far a PR is walked. GitHub itself stops at 3000 files and 250
 * commits, so these only bound the request count on a PR nobody would review
 * by hand anyway — 10 and 3 round trips at worst, inside `TIMEOUT`.
 *
 * They are NOT the reason a diff can be partial. Before 2026-08-03 a single
 * `per_page: 100` call was the whole import, so a PR of 161 files reached the
 * agents as its first 100 by GitHub's ordering — alphabetical, which on this
 * repo meant every `client/` file and not one `server/` file. The reviewer
 * then correctly reported a contract as "not changed in this diff" when it had
 * been changed in a file it was never shown.
 */
const MAX_PR_FILES = 1000;

const MAX_PR_COMMITS = 250;

/**
 * The row shapes, taken from the endpoint methods rather than hand-written.
 *
 * `paginate` has to be reached through `as never` — its overloads do not
 * resolve through a generic helper — and that erasure would otherwise take
 * Octokit's generated payload types with it, leaving the maps below asserting
 * a shape instead of checking one. A renamed field would then compile to
 * `path: undefined` on every file: the same silent loss of the diff this
 * pagination exists to stop. Derived from `Octokit` itself, not imported from
 * `@octokit/types`, which is a transitive dependency this package does not
 * declare.
 */
type ListedFile = Awaited<ReturnType<Octokit['rest']['pulls']['listFiles']>>['data'][number];
type ListedCommit = Awaited<ReturnType<Octokit['rest']['pulls']['listCommits']>>['data'][number];

function mapStatus(state: string, merged: boolean | undefined): PrStatus {
  if (merged) return 'merged';
  if (state === 'closed') return 'closed';
  return 'open';
}

/**
 * GitHubClient over Octokit REST — thin. PAT auth (fine-grained).
 * Reads PR list/detail/files/commits/issue; posts reviews; opens PRs.
 */
export class OctokitGitHubClient implements GitHubClient {
  private octokit: Octokit;

  /**
   * `octokit` is injectable so the pagination can be tested without a network;
   * production keeps building it from the token, so no call site changes.
   */
  constructor(token: string, octokit: Octokit = new Octokit({ auth: token })) {
    this.octokit = octokit;
  }

  /**
   * Walk every page of a list endpoint, stopping at `max` items.
   *
   * `paginate`'s map callback returns `[]` because the items are accumulated
   * here — returning them as well would double the memory for a large PR.
   */
  private async paginateUpTo<Item, Row>(
    route: Parameters<Octokit['paginate']>[0],
    params: Record<string, unknown>,
    max: number,
    map: (row: Row) => Item,
  ): Promise<Item[]> {
    const out: Item[] = [];
    await this.octokit.paginate(
      route as never,
      { ...params, per_page: PAGE_SIZE } as never,
      ((response: { data: Row[] }, done: () => void) => {
        for (const row of response.data) {
          out.push(map(row));
          if (out.length >= max) {
            done();
            break;
          }
        }
        return [];
      }) as never,
    );
    return out;
  }

  async listPullRequests(repo: RepoRef): Promise<PrMeta[]> {
    return withRetry(() =>
      withTimeout(
        (async () => {
          // Fetch open + recently merged/closed (most-recently-updated first) so
          // the list shows which PRs are merged vs still open — not just open.
          const res = await this.octokit.rest.pulls.list({
            owner: repo.owner,
            repo: repo.name,
            state: 'all',
            sort: 'updated',
            direction: 'desc',
            per_page: 50,
          });
          return res.data.map((pr) => ({
            number: pr.number,
            title: pr.title,
            author: pr.user?.login ?? 'unknown',
            branch: pr.head.ref,
            base: pr.base.ref,
            head_sha: pr.head.sha,
            additions: 0,
            deletions: 0,
            files_count: 0, // not present on the list payload; populated by getPullRequest
            status: mapStatus(pr.state, Boolean(pr.merged_at)) as PrStatus,
            opened_at: pr.created_at,
            updated_at: pr.updated_at,
          }));
        })(),
        TIMEOUT,
      ),
    );
  }

  async getPullRequest(repo: RepoRef, n: number): Promise<PrDetail> {
    return withRetry(() =>
      withTimeout(
        (async () => {
          const { data: pr } = await this.octokit.rest.pulls.get({
            owner: repo.owner,
            repo: repo.name,
            pull_number: n,
          });
          const params = { owner: repo.owner, repo: repo.name, pull_number: n };
          const files = await this.paginateUpTo<PrDetail['files'][number], ListedFile>(
            this.octokit.rest.pulls.listFiles,
            params,
            MAX_PR_FILES,
            (f) => ({
              path: f.filename,
              additions: f.additions,
              deletions: f.deletions,
              patch: f.patch,
            }),
          );
          const commits = await this.paginateUpTo<PrDetail['commits'][number], ListedCommit>(
            this.octokit.rest.pulls.listCommits,
            params,
            MAX_PR_COMMITS,
            (c) => ({
              sha: c.sha,
              message: c.commit.message,
              author: c.commit.author?.name ?? c.author?.login ?? 'unknown',
              committed_at: c.commit.author?.date,
            }),
          );
          const linkedIssue = await this.resolveLinkedIssue(repo, pr.body ?? '');
          return {
            number: pr.number,
            title: pr.title,
            author: pr.user?.login ?? 'unknown',
            branch: pr.head.ref,
            base: pr.base.ref,
            head_sha: pr.head.sha,
            additions: pr.additions,
            deletions: pr.deletions,
            files_count: pr.changed_files,
            status: mapStatus(pr.state, Boolean(pr.merged_at)) as PrStatus,
            opened_at: pr.created_at,
            updated_at: pr.updated_at,
            body: pr.body,
            files,
            commits,
            linked_issue: linkedIssue,
          };
        })(),
        TIMEOUT,
      ),
    );
  }

  /** linked issue via regex on PR body (#123 / closes #123). */
  private async resolveLinkedIssue(repo: RepoRef, body: string): Promise<IssueMeta | undefined> {
    const m = body.match(/(?:closes|fixes|resolves)?\s*#(\d+)/i);
    if (!m?.[1]) return undefined;
    try {
      return await this.getIssue(repo, Number(m[1]));
    } catch {
      return undefined;
    }
  }

  async postReview(
    repo: RepoRef,
    n: number,
    review: GitHubReviewPayload,
  ): Promise<{ id: string }> {
    return withRetry(() =>
      withTimeout(
        (async () => {
          const res = await this.octokit.rest.pulls.createReview({
            owner: repo.owner,
            repo: repo.name,
            pull_number: n,
            body: review.body,
            event: review.event,
            comments: review.comments?.map((c) => ({
              path: c.path,
              line: c.line,
              body: c.body,
            })),
          });
          return { id: String(res.data.id) };
        })(),
        TIMEOUT,
      ),
    );
  }

  /** Shape an Octokit review-comment payload into our DTO. */
  private mapReviewComment(c: {
    id: number;
    path: string;
    line?: number | null;
    original_line?: number | null;
    side?: string | null;
    body: string;
    user: { login: string } | null;
    created_at: string;
    html_url: string;
    in_reply_to_id?: number;
  }): PrReviewComment {
    return {
      id: c.id,
      path: c.path,
      line: c.line ?? null,
      original_line: c.original_line ?? null,
      side: c.side === 'LEFT' ? 'LEFT' : 'RIGHT',
      body: c.body,
      user: c.user?.login ?? 'unknown',
      created_at: c.created_at,
      html_url: c.html_url,
      in_reply_to_id: c.in_reply_to_id ?? null,
      // GitHub drops `line` when the comment can no longer be placed on the diff.
      is_outdated: c.line == null,
    };
  }

  async listReviewComments(repo: RepoRef, n: number): Promise<PrReviewComment[]> {
    return withRetry(() =>
      withTimeout(
        (async () => {
          const res = await this.octokit.rest.pulls.listReviewComments({
            owner: repo.owner,
            repo: repo.name,
            pull_number: n,
            per_page: 100,
          });
          return res.data.map((c) => this.mapReviewComment(c));
        })(),
        TIMEOUT,
      ),
    );
  }

  async createReviewComment(
    repo: RepoRef,
    n: number,
    input: CreateReviewCommentInput,
  ): Promise<PrReviewComment> {
    return withRetry(() =>
      withTimeout(
        (async () => {
          if (input.inReplyTo != null) {
            const res = await this.octokit.rest.pulls.createReplyForReviewComment({
              owner: repo.owner,
              repo: repo.name,
              pull_number: n,
              comment_id: input.inReplyTo,
              body: input.body,
            });
            return this.mapReviewComment(res.data);
          }
          const res = await this.octokit.rest.pulls.createReviewComment({
            owner: repo.owner,
            repo: repo.name,
            pull_number: n,
            commit_id: input.commitId,
            path: input.path,
            line: input.line,
            side: input.side ?? 'RIGHT',
            body: input.body,
          });
          return this.mapReviewComment(res.data);
        })(),
        TIMEOUT,
      ),
    );
  }

  async openPullRequest(repo: RepoRef, payload: OpenPrPayload): Promise<{ url: string }> {
    return withRetry(() =>
      withTimeout(
        (async () => {
          const res = await this.octokit.rest.pulls.create({
            owner: repo.owner,
            repo: repo.name,
            title: payload.title,
            head: payload.head,
            base: payload.base,
            body: payload.body,
          });
          return { url: res.data.html_url };
        })(),
        TIMEOUT,
      ),
    );
  }

  async commitFiles(
    repo: RepoRef,
    payload: CommitFilesPayload,
  ): Promise<{ branch: string }> {
    return withRetry(() =>
      withTimeout(
        (async () => {
          const owner = repo.owner;
          const name = repo.name;
          const g = this.octokit.rest.git;

          // Parent commit: the target branch if it already exists, else the base.
          let parentSha: string;
          let branchExists = false;
          try {
            const ref = await g.getRef({ owner, repo: name, ref: `heads/${payload.branch}` });
            parentSha = ref.data.object.sha;
            branchExists = true;
          } catch {
            const baseRef = await g.getRef({ owner, repo: name, ref: `heads/${payload.base}` });
            parentSha = baseRef.data.object.sha;
          }

          // New tree layered on the parent's tree (so unrelated files are kept).
          const parentCommit = await g.getCommit({ owner, repo: name, commit_sha: parentSha });
          const removals = await this.presentPaths(repo, parentSha, payload.deletions ?? []);
          const tree = await g.createTree({
            owner,
            repo: name,
            base_tree: parentCommit.data.tree.sha,
            tree: [
              ...payload.files.map((f) => ({
                path: f.path,
                mode: '100644' as const,
                type: 'blob' as const,
                content: f.contents,
              })),
              // A tree entry whose `sha` is null removes the path from the base
              // tree — the only way to delete inside the commit that writes the
              // rest (AC-146), since the Contents API deletes in a commit of its
              // own. `sha: null` is not in Octokit's generated tree-entry type,
              // which models the create-a-blob half only.
              ...removals.map((path) => ({
                path,
                mode: '100644' as const,
                type: 'blob' as const,
                sha: null as unknown as string,
              })),
            ],
          });

          const commit = await g.createCommit({
            owner,
            repo: name,
            message: payload.message,
            tree: tree.data.sha,
            parents: [parentSha],
          });

          if (branchExists) {
            await g.updateRef({
              owner,
              repo: name,
              ref: `heads/${payload.branch}`,
              sha: commit.data.sha,
              force: true,
            });
          } else {
            await g.createRef({
              owner,
              repo: name,
              ref: `refs/heads/${payload.branch}`,
              sha: commit.data.sha,
            });
          }
          return { branch: payload.branch };
        })(),
        TIMEOUT,
      ),
    );
  }

  /**
   * Of `paths`, the ones the parent commit actually carries.
   *
   * WHY THIS READ EXISTS. `createTree` is asked for an end state, and the caller
   * — a pure generator that reads nothing — cannot know what the target
   * repository holds, so it asks for the legacy workflow to be gone whether or
   * not it was ever there. Whether GitHub accepts `sha: null` for a path that is
   * NOT in the base tree is undocumented and was not verifiable here; a 422
   * would fail every publication into every repository that never had the file,
   * which is most of them. One `getContent` per removal makes the outcome
   * independent of that answer.
   *
   * It reads one named path and never a tree, which is the cheap half of the
   * alternative SPEC-05 § D23 rejected ("delete only if unmodified" also needs
   * the file's CONTENT and a comparison against what DevDigest would generate).
   */
  private async presentPaths(repo: RepoRef, ref: string, paths: string[]): Promise<string[]> {
    const found: string[] = [];
    for (const path of paths) {
      try {
        await this.octokit.rest.repos.getContent({
          owner: repo.owner,
          repo: repo.name,
          path,
          ref,
        });
        found.push(path);
      } catch (err) {
        if (statusOf(err) !== 404) throw err;
      }
    }
    return found;
  }

  async findOpenPr(repo: RepoRef, branch: string): Promise<{ url: string } | null> {
    return withRetry(() =>
      withTimeout(
        (async () => {
          const res = await this.octokit.rest.pulls.list({
            owner: repo.owner,
            repo: repo.name,
            state: 'open',
            head: `${repo.owner}:${branch}`,
            per_page: 1,
          });
          const pr = res.data[0];
          return pr ? { url: pr.html_url } : null;
        })(),
        TIMEOUT,
      ),
    );
  }

  async listWorkflowRuns(
    repo: RepoRef,
    workflowFile: string,
    opts: { perPage?: number } = {},
  ): Promise<WorkflowRunRef[] | null> {
    return withRetry(() =>
      withTimeout(
        (async () => {
          let res;
          try {
            res = await this.octokit.rest.actions.listWorkflowRuns({
              owner: repo.owner,
              repo: repo.name,
              workflow_id: workflowFile,
              per_page: Math.min(opts.perPage ?? 20, PAGE_SIZE),
            });
          } catch (err) {
            if (statusOf(err) !== 404) throw err;
            // 404 HERE IS TWO DIFFERENT ANSWERS. GitHub returns it both for "no
            // workflow by that file name" and for "this token cannot see this
            // repository", with the same body. Only the first is an answer the
            // ingest may record as `workflow_present = false` (AC-147); the
            // second is a failed poll and owes the reader a named error
            // (AC-83), so the repository is asked for before the 404 is
            // believed. One extra call, and only on the 404 path.
            await this.octokit.rest.repos.get({ owner: repo.owner, repo: repo.name });
            return null;
          }
          return res.data.workflow_runs.map((run) => ({
            id: run.id,
            head_sha: run.head_sha,
            status: run.status ?? 'unknown',
            conclusion: run.conclusion ?? null,
            // GitHub lists every PR a run belongs to; a `pull_request` run has
            // exactly one, and an empty list means the run was not a PR's.
            pr_number: run.pull_requests?.[0]?.number ?? null,
            html_url: run.html_url,
            run_started_at: run.run_started_at ?? null,
            updated_at: run.updated_at ?? null,
            repository: run.repository.full_name,
          }));
        })(),
        TIMEOUT,
      ),
    );
  }

  async listRunArtifacts(repo: RepoRef, runId: number): Promise<WorkflowArtifactRef[]> {
    return withRetry(() =>
      withTimeout(
        (async () => {
          const res = await this.octokit.rest.actions.listWorkflowRunArtifacts({
            owner: repo.owner,
            repo: repo.name,
            run_id: runId,
            per_page: PAGE_SIZE,
          });
          return res.data.artifacts.map((a) => ({
            id: a.id,
            name: a.name,
            size_in_bytes: a.size_in_bytes,
            expired: a.expired,
          }));
        })(),
        TIMEOUT,
      ),
    );
  }

  /**
   * The size is checked TWICE, against two numbers GitHub reports separately.
   *
   * `getArtifact` is what makes the refusal free: an over-sized archive is
   * never requested, so its bytes are never held — the same order
   * `parseSkillArchive` gets from fflate's filter. The second check is not
   * redundant, because the declared size is metadata and the body is what
   * actually arrived; only the first one is cheap.
   *
   * A refusal is a `ValidationError` and not an `ExternalServiceError` on
   * purpose: `withRetry` retries a 5xx, and downloading a too-large artifact
   * three more times is the opposite of refusing it.
   */
  async downloadArtifact(repo: RepoRef, artifactId: number, maxBytes: number): Promise<Uint8Array> {
    return withRetry(() =>
      withTimeout(
        (async () => {
          const meta = await this.octokit.rest.actions.getArtifact({
            owner: repo.owner,
            repo: repo.name,
            artifact_id: artifactId,
          });
          refuseUnusableArtifact(artifactId, meta.data, maxBytes);

          const res = await this.octokit.rest.actions.downloadArtifact({
            owner: repo.owner,
            repo: repo.name,
            artifact_id: artifactId,
            archive_format: 'zip',
          });
          const bytes = new Uint8Array(res.data as ArrayBuffer);
          refuseOversizedDownload(artifactId, bytes, maxBytes);
          return bytes;
        })(),
        TIMEOUT,
      ),
    );
  }

  async getIssue(repo: RepoRef, n: number): Promise<IssueMeta> {
    const res = await withRetry(() =>
      withTimeout(
        this.octokit.rest.issues.get({ owner: repo.owner, repo: repo.name, issue_number: n }),
        TIMEOUT,
      ),
    );
    return {
      number: res.data.number,
      title: res.data.title,
      body: res.data.body,
      state: res.data.state,
    };
  }

  async currentLogin(): Promise<string> {
    const res = await withRetry(() =>
      withTimeout(this.octokit.rest.users.getAuthenticated(), TIMEOUT),
    );
    return res.data.login;
  }
}
