import { CI_ENV, type RepoRef } from '@devdigest/shared';

/** `post_as`, as the generated workflow writes it into the runner's env. */
export type PostAs = 'github_review' | 'pr_comment' | 'none';

/** The documented default input ceiling (SPEC-05 § Non-functional requirements). */
export const DEFAULT_MAX_DIFF_LINES = 50000;

export interface RunnerEnv {
  agent: string;
  repo: RepoRef;
  repoSlug: string;
  prNumber: number;
  postAs: PostAs;
  maxDiffLines: number;
  githubToken: string;
  openRouterKey: string;
}

export class EnvError extends Error {
  constructor(readonly variable: string, message: string) {
    super(message);
    this.name = 'EnvError';
  }
}

/**
 * The fork flag, read on its own and before anything else.
 *
 * A fork run has no secrets at all, so it must not be made to depend on the
 * variables the rest of the run validates (AC-52).
 */
export function isForkRun(env: NodeJS.ProcessEnv): boolean {
  return (env[CI_ENV.isFork] ?? '').trim().toLowerCase() === 'true';
}

/**
 * The agent slug as the ARTIFACT records it — never as a path component.
 *
 * `CiResultArtifact.agent` is a required string, and the fork path writes an
 * artifact without having read anything. Path safety is a separate concern and
 * lives at the join (`resolveBundlePath`), not here.
 */
export function agentLabel(env: NodeJS.ProcessEnv): string {
  const raw = (env[CI_ENV.agent] ?? '').trim();
  return raw.length > 0 ? raw : 'unknown';
}

/** The PR number if the job gave a usable one, else null. */
export function prNumberOrNull(env: NodeJS.ProcessEnv): number | null {
  const n = Number.parseInt((env[CI_ENV.prNumber] ?? '').trim(), 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** The ceiling in force for this run, whether or not the rest of the env is sound. */
export function maxDiffLinesOf(env: NodeJS.ProcessEnv): number {
  const n = Number.parseInt((env[CI_ENV.maxDiffLines] ?? '').trim(), 10);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_MAX_DIFF_LINES;
}

const REPO_RE = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

/**
 * Split `owner/name`, rejecting anything that would not survive being pasted
 * into a GitHub API path — a second slash, a space, or a `..` segment.
 */
export function parseRepoSlug(slug: string): RepoRef {
  const value = slug.trim();
  if (!REPO_RE.test(value) || value.split('/').some((part) => part === '.' || part === '..')) {
    throw new EnvError(CI_ENV.repository, `not an "owner/name" repository: "${value}"`);
  }
  const [owner, name] = value.split('/');
  return { owner: owner as string, name: name as string };
}

function postAsOf(raw: string | undefined): PostAs {
  const value = (raw ?? 'github_review').trim();
  if (value === 'github_review' || value === 'pr_comment' || value === 'none') return value;
  throw new EnvError(
    CI_ENV.postAs,
    `expected github_review | pr_comment | none, got "${value}"`,
  );
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = (env[name] ?? '').trim();
  if (value.length === 0) throw new EnvError(name, `${name} is empty — the job must provide it`);
  return value;
}

/**
 * Read the whole environment the review path needs. Called AFTER the fork
 * check, because a fork run legitimately has neither secret.
 */
export function readRunnerEnv(env: NodeJS.ProcessEnv): RunnerEnv {
  const repoSlug = required(env, CI_ENV.repository);
  const prNumber = prNumberOrNull(env);
  if (prNumber === null) {
    throw new EnvError(CI_ENV.prNumber, 'expected a positive pull-request number');
  }
  return {
    agent: agentLabel(env),
    repo: parseRepoSlug(repoSlug),
    repoSlug,
    prNumber,
    postAs: postAsOf(env[CI_ENV.postAs]),
    maxDiffLines: maxDiffLinesOf(env),
    githubToken: required(env, CI_ENV.githubToken),
    openRouterKey: required(env, CI_ENV.openRouterKey),
  };
}
