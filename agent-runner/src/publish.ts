import type { GitHubReviewPayload } from '@devdigest/shared';
import type { GitHubApi } from './github.js';
import type { PostAs } from './env.js';

/**
 * Publish the review the way `post_as` says, and only that way (AC-64).
 *
 * `none` is a real choice, not a failure: the artifact is still written and the
 * check still passes or fails on the gate.
 */
export async function publish(
  api: GitHubApi,
  prNumber: number,
  payload: GitHubReviewPayload,
  postAs: PostAs,
): Promise<string> {
  switch (postAs) {
    case 'github_review':
      await api.postReview(prNumber, payload);
      return `posted a GitHub review (${payload.event})`;
    case 'pr_comment':
      await api.postComment(prNumber, payload.body);
      return 'posted a pull-request comment';
    case 'none':
      return 'not published (post_as: none)';
  }
}
