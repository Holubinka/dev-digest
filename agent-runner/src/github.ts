import type { GitHubReviewPayload, RepoRef, UnifiedDiff } from '@devdigest/shared';
import { diffFromPatches } from '@devdigest/diff-parser';
import { withRetry } from './retry.js';

const API = 'https://api.github.com';
const FILES_PER_PAGE = 100;
const MAX_FILE_PAGES = 30;
const MAX_COMMENTS = 20;

/** Everything the review needs about the pull request, as GitHub reports it. */
export interface PrContext {
  title: string;
  body: string;
  branch: string;
  headSha: string;
  comments: string[];
}

export interface ChangedFile {
  path: string;
  patch: string | null;
}

export class GitHubError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
    message: string,
  ) {
    super(message);
    this.name = 'GitHubError';
  }
}

/**
 * The runner's GitHub client: plain `fetch` (a Node 20 global), no Octokit.
 *
 * The bundle is committed to someone else's repository and installs nothing
 * (AC-48, AC-56), so every byte of a dependency is a byte in the diff a human
 * has to merge. `globalThis.fetch` is read per request rather than captured, so
 * a test can stub it.
 */
export class GitHubApi {
  constructor(
    private readonly token: string,
    private readonly repo: RepoRef,
  ) {}

  private get base(): string {
    return `${API}/repos/${this.repo.owner}/${this.repo.name}`;
  }

  private async request<T>(url: string, init?: RequestInit): Promise<T> {
    return withRetry(async () => {
      const res = await globalThis.fetch(url, {
        ...init,
        headers: {
          accept: 'application/vnd.github+json',
          authorization: `Bearer ${this.token}`,
          'user-agent': 'devdigest-agent-runner',
          'x-github-api-version': '2022-11-28',
          ...(init?.body ? { 'content-type': 'application/json' } : {}),
          ...init?.headers,
        },
      });
      if (!res.ok) {
        // The body can echo the request; only the status and the path are
        // reported, so a token in a header can never reach a log.
        throw new GitHubError(res.status, url, `GitHub ${init?.method ?? 'GET'} ${url} → ${res.status}`);
      }
      return (await res.json()) as T;
    });
  }

  async pullRequest(n: number): Promise<PrContext> {
    const pr = await this.request<{
      title?: string | null;
      body?: string | null;
      head?: { ref?: string | null; sha?: string | null } | null;
    }>(`${this.base}/pulls/${n}`);
    return {
      title: pr.title ?? '',
      body: pr.body ?? '',
      branch: pr.head?.ref ?? '',
      headSha: pr.head?.sha ?? '',
      comments: [],
    };
  }

  async changedFiles(n: number): Promise<ChangedFile[]> {
    const out: ChangedFile[] = [];
    for (let page = 1; page <= MAX_FILE_PAGES; page++) {
      const batch = await this.request<{ filename?: string; patch?: string | null }[]>(
        `${this.base}/pulls/${n}/files?per_page=${FILES_PER_PAGE}&page=${page}`,
      );
      for (const f of batch) {
        if (f.filename) out.push({ path: f.filename, patch: f.patch ?? null });
      }
      if (batch.length < FILES_PER_PAGE) break;
    }
    return out;
  }

  /** Issue comments on the PR — the newest `MAX_COMMENTS`, oldest first. */
  async comments(n: number): Promise<string[]> {
    const list = await this.request<{ body?: string | null }[]>(
      `${this.base}/issues/${n}/comments?per_page=${MAX_COMMENTS}&sort=created&direction=desc`,
    );
    return list
      .map((c) => c.body ?? '')
      .filter((b) => b.trim().length > 0)
      .reverse();
  }

  async postReview(n: number, payload: GitHubReviewPayload): Promise<void> {
    await this.request(`${this.base}/pulls/${n}/reviews`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async postComment(n: number, body: string): Promise<void> {
    await this.request(`${this.base}/issues/${n}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body }),
    });
  }
}

/** The studio's own reconstruction, so both reviews ground on the same lines. */
export function diffFromFiles(files: ChangedFile[]): UnifiedDiff {
  return diffFromPatches(files);
}

/** Changed lines of a parsed diff — the figure the input ceiling is measured in. */
export function changedLines(diff: UnifiedDiff): number {
  return diff.files.reduce((n, f) => n + f.additions + f.deletions, 0);
}
