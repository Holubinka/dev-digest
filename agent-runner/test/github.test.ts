import { afterEach, describe, expect, it, vi } from 'vitest';
import { GitHubApi, GitHubError, changedLines, diffFromFiles } from '../src/github.js';
import { PATCH } from './helpers.js';

interface Call {
  url: string;
  init: RequestInit | undefined;
}

function stubFetch(handler: (url: string, init?: RequestInit) => unknown): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const body = handler(url, init);
    if (body instanceof Response) return body;
    return new Response(JSON.stringify(body), { status: 200 });
  });
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

const repo = { owner: 'acme', name: 'widgets' };

describe('GitHubApi', () => {
  it('reads the pull request from the repo path with a bearer token', async () => {
    const calls = stubFetch(() => ({
      title: 'Add handler',
      body: 'Adds a handler',
      head: { ref: 'feat/handler', sha: 'abc1234' },
    }));
    const pr = await new GitHubApi('ghs_token', repo).pullRequest(7);

    expect(calls[0]?.url).toBe('https://api.github.com/repos/acme/widgets/pulls/7');
    expect((calls[0]?.init?.headers as Record<string, string>).authorization).toBe(
      'Bearer ghs_token',
    );
    expect(pr).toEqual({
      title: 'Add handler',
      body: 'Adds a handler',
      branch: 'feat/handler',
      headSha: 'abc1234',
      comments: [],
    });
  });

  it('tolerates a pull request with a null body and no head', async () => {
    stubFetch(() => ({ title: null, body: null }));
    const pr = await new GitHubApi('t', repo).pullRequest(7);
    expect(pr.body).toBe('');
    expect(pr.branch).toBe('');
  });

  it('pages the changed files until a short page arrives', async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => ({ filename: `a${i}.ts`, patch: PATCH }));
    const calls = stubFetch((url) => (url.endsWith('page=1') ? page1 : [{ filename: 'z.ts' }]));
    const files = await new GitHubApi('t', repo).changedFiles(7);

    expect(calls.map((c) => c.url)).toEqual([
      'https://api.github.com/repos/acme/widgets/pulls/7/files?per_page=100&page=1',
      'https://api.github.com/repos/acme/widgets/pulls/7/files?per_page=100&page=2',
    ]);
    expect(files).toHaveLength(101);
    expect(files[100]).toEqual({ path: 'z.ts', patch: null });
  });

  it('reads the issue comments oldest first and drops the empty ones', async () => {
    const calls = stubFetch(() => [{ body: 'newest' }, { body: '   ' }, { body: 'oldest' }]);
    const comments = await new GitHubApi('t', repo).comments(7);
    expect(calls[0]?.url).toContain('/issues/7/comments?per_page=20');
    expect(comments).toEqual(['oldest', 'newest']);
  });

  it('posts a review to the reviews endpoint', async () => {
    const calls = stubFetch(() => ({ id: 1 }));
    await new GitHubApi('t', repo).postReview(7, { body: 'b', event: 'REQUEST_CHANGES' });
    expect(calls[0]?.url).toBe('https://api.github.com/repos/acme/widgets/pulls/7/reviews');
    expect(calls[0]?.init?.method).toBe('POST');
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      body: 'b',
      event: 'REQUEST_CHANGES',
    });
  });

  it('posts a comment to the issue comments endpoint', async () => {
    const calls = stubFetch(() => ({ id: 1 }));
    await new GitHubApi('t', repo).postComment(7, 'hello');
    expect(calls[0]?.url).toBe('https://api.github.com/repos/acme/widgets/issues/7/comments');
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ body: 'hello' });
  });

  it('does not retry a 404 and never puts the token in the error', async () => {
    const calls = stubFetch(() => new Response('{"message":"Not Found"}', { status: 404 }));
    await expect(new GitHubApi('ghs_secret_value', repo).pullRequest(7)).rejects.toThrow(
      GitHubError,
    );
    expect(calls).toHaveLength(1);
    await expect(new GitHubApi('ghs_secret_value', repo).pullRequest(7)).rejects.not.toThrow(
      /ghs_secret_value/,
    );
  });

  it('retries a 429 and returns the answer that follows', async () => {
    let n = 0;
    const calls = stubFetch(() => {
      n += 1;
      return n === 1 ? new Response('{}', { status: 429 }) : { title: 'ok' };
    });
    const pr = await new GitHubApi('t', repo).pullRequest(7);
    expect(pr.title).toBe('ok');
    expect(calls).toHaveLength(2);
  });
});

describe('diffFromFiles', () => {
  it('rebuilds the unified diff so the hunk carries the new-side line numbers', () => {
    const diff = diffFromFiles([{ path: 'src/handler.ts', patch: PATCH }]);
    expect(diff.files).toHaveLength(1);
    expect(diff.files[0]?.path).toBe('src/handler.ts');
    expect(diff.files[0]?.hunks[0]?.newLineNumbers).toEqual([9, 10, 11, 12]);
    expect(diff.raw).toContain('diff --git a/src/handler.ts b/src/handler.ts');
  });

  it('skips a file with no patch', () => {
    const diff = diffFromFiles([{ path: 'image.png', patch: null }]);
    expect(diff.files).toEqual([]);
  });

  it('counts changed lines as additions plus deletions', () => {
    expect(changedLines(diffFromFiles([{ path: 'src/handler.ts', patch: PATCH }]))).toBe(2);
  });
});
